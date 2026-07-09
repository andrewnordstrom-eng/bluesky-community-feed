import { describe, expect, it } from 'vitest';
import { normalizeCreatedAt } from '../src/ingestion/normalize-timestamp.js';

const NOW = Date.parse('2026-07-08T00:00:00.000Z');

// Encode epoch-ms into a valid AT Protocol TID rkey (inverse of the decoder),
// so tests can exercise the rkey-fallback path with a real TID.
const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';
function millisToTid(ms: number): string {
  let value = (BigInt(ms) * 1000n) << 10n; // micros << 10, clockid 0
  let s = '';
  for (let i = 0; i < 13; i++) {
    s = TID_ALPHABET[Number(value % 32n)] + s;
    value /= 32n;
  }
  return s;
}
const TID_MS = Date.parse('2026-06-20T12:00:00.000Z');
const uriWithTid = (ms: number) => `at://did:plc:abc/app.bsky.feed.like/${millisToTid(ms)}`;

describe('normalizeCreatedAt', () => {
  it('passes through a valid past client timestamp (canonical ISO)', () => {
    expect(normalizeCreatedAt('2026-07-01T12:00:00.000Z', uriWithTid(TID_MS), NOW)).toBe(
      '2026-07-01T12:00:00.000Z'
    );
  });

  it('normalizes a non-canonical but valid past date to canonical ISO', () => {
    expect(normalizeCreatedAt('2026-07-01', uriWithTid(TID_MS), NOW)).toBe('2026-07-01T00:00:00.000Z');
  });

  it('does NOT trust a timezone-less datetime (Date.parse reads it as local time) — falls back to the rkey', () => {
    // "2026-07-05T12:00:00" has no Z/offset, so different workers/timezones
    // would resolve it to different instants and miss ON CONFLICT dedup. Must
    // resolve deterministically from the record key instead.
    expect(normalizeCreatedAt('2026-07-05T12:00:00', uriWithTid(TID_MS), NOW)).toBe(
      new Date(TID_MS).toISOString()
    );
  });

  it('falls back to the record-key TID for a far-future createdAt (2056)', () => {
    // Not the 2056 value, not now — the record key's real creation time.
    expect(normalizeCreatedAt('2056-01-01T00:00:00.000Z', uriWithTid(TID_MS), NOW)).toBe(
      new Date(TID_MS).toISOString()
    );
  });

  it('falls back to the record-key TID for a missing createdAt', () => {
    expect(normalizeCreatedAt(undefined, uriWithTid(TID_MS), NOW)).toBe(new Date(TID_MS).toISOString());
  });

  it('is STABLE across redelivery — same (raw, uri) yields the same value regardless of now', () => {
    // The dedup-safety property: ON CONFLICT (uri, created_at) only works if a
    // redelivered event resolves to the identical created_at each time.
    const later = NOW + 5 * 60_000;
    const uri = uriWithTid(TID_MS);
    expect(normalizeCreatedAt('2056-01-01T00:00:00.000Z', uri, NOW)).toBe(
      normalizeCreatedAt('2056-01-01T00:00:00.000Z', uri, later)
    );
    expect(normalizeCreatedAt(undefined, uri, NOW)).toBe(normalizeCreatedAt(undefined, uri, later));
  });

  it('uses a deterministic epoch sentinel when both createdAt and rkey are unusable', () => {
    const uri = 'at://did:plc:abc/app.bsky.feed.like/self'; // rkey is not a TID
    expect(normalizeCreatedAt(undefined, uri, NOW)).toBe('1970-01-01T00:00:00.000Z');
    expect(normalizeCreatedAt('not-a-date', uri, NOW)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('keeps a genuinely old client timestamp (retention ages it out, not the clamp)', () => {
    expect(normalizeCreatedAt('2013-01-01T00:00:00.000Z', uriWithTid(TID_MS), NOW)).toBe(
      '2013-01-01T00:00:00.000Z'
    );
  });
});
