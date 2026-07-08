/**
 * Normalize a client-supplied AT Protocol `createdAt` into a trustworthy,
 * STABLE timestamp for storage.
 *
 * Two constraints, both load-bearing after the PROJ-917 partitioning rebuild:
 *
 *   1. **Stability / dedup.** likes/reposts/follows/posts are now keyed on
 *      `(uri, created_at)` and writers use `ON CONFLICT (uri, created_at)`.
 *      A Jetstream redelivery of the *same* record must therefore produce the
 *      *same* `created_at`, or the conflict misses and a duplicate row is
 *      inserted (double-counting engagement). So the returned value must be a
 *      pure function of the record — never `Date.now()`, which differs per
 *      delivery.
 *   2. **Sane partition routing / ranking.** Records carry a client-set
 *      `createdAt` that cannot be trusted (prod has values dated 2030/2038/
 *      2056). A far-future value would land in the DEFAULT partition and never
 *      age out (retention only drops `created_at < cutoff`), and would max the
 *      recency score, letting a client pin a post to the top of the feed.
 *
 * Resolution order (all deterministic given the record):
 *   a. The client `createdAt`, iff present, parseable, and not in the future —
 *      the normal case, stable across redelivery.
 *   b. Otherwise the timestamp encoded in the record key (rkey): AT Protocol
 *      rkeys are TIDs, which embed the record's real creation time. This is
 *      immutable per-URI, so it satisfies both constraints — and it recovers a
 *      real time for future-dated / missing / garbage `createdAt` records.
 *   c. Last resort (rkey is not a TID and `createdAt` is unusable — very rare):
 *      the Unix epoch, a fixed deterministic sentinel that ages out on the next
 *      retention pass rather than churning like `Date.now()`.
 */

// crockford-ish base32-sortable alphabet used by AT Protocol TIDs.
const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';

/** Decode an AT Protocol TID rkey to epoch milliseconds, or null if it is not a
 *  well-formed 13-char TID. A TID is a 64-bit int `(micros << 10) | clockid`. */
function tidToMillis(rkey: string): number | null {
  if (rkey.length !== 13) return null;
  let value = 0n;
  for (const ch of rkey) {
    const idx = TID_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = value * 32n + BigInt(idx);
  }
  const micros = value >> 10n;
  const millis = Number(micros / 1000n);
  if (!Number.isFinite(millis) || millis <= 0) return null;
  return millis;
}

/** The record key is the final path segment of an `at://did/collection/rkey` URI. */
function rkeyFromUri(uri: string | undefined | null): string | null {
  if (!uri) return null;
  const idx = uri.lastIndexOf('/');
  if (idx === -1 || idx === uri.length - 1) return null;
  return uri.slice(idx + 1);
}

/** Whether a raw timestamp resolves to the same instant regardless of the
 *  parsing host's timezone. `Date.parse` reads a date-only string as UTC, but a
 *  datetime WITHOUT an explicit zone as *local* time — so a zone-less datetime
 *  would normalize the same record to different instants across workers and
 *  break `ON CONFLICT (uri, created_at)` dedup. Trust only date-only values and
 *  datetimes that carry `Z` or an explicit ±HH[:MM] offset. */
function isDeterministicTimestamp(raw: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return true;
  return /[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
}

export function normalizeCreatedAt(
  raw: string | undefined | null,
  uri: string | undefined | null,
  nowMs: number = Date.now()
): string {
  // (a) trust a present, parseable, non-future client timestamp — but only if
  // it is timezone-unambiguous (see isDeterministicTimestamp); a zone-less
  // datetime parses as local time and would break cross-worker dedup.
  if (raw && isDeterministicTimestamp(raw)) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed) && parsed <= nowMs) {
      return new Date(parsed).toISOString();
    }
  }

  // (b) fall back to the record key's embedded creation time (stable per-URI).
  const tidMillis = tidToMillis(rkeyFromUri(uri) ?? '');
  if (tidMillis !== null && tidMillis <= nowMs) {
    return new Date(tidMillis).toISOString();
  }

  // (c) deterministic sentinel — stable, and old enough to age out immediately.
  return new Date(0).toISOString();
}
