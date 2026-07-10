# Birders Who Code Feed Readiness Packet

Status: disabled/private feed-readiness substrate, not a published Bluesky feed.
Issue: PROJ-1431.
Branch: `dev/PROJ-1431-recsys-reviewer-demo-path-tells-the-corgi-loop-end-to-end`.
Last updated: 2026-07-10T00:40Z.

## Scope

This packet records the first readiness track for a real Birders Who Code feed. The
implementation proves a safe path for scouting and materializing a second feed
bucket without changing the existing `community-gov` feed.

The feed remains disabled and private by default. No Bluesky feed record was
published, no production governance rows were written, and the public
`community-gov` skeleton behavior remains unchanged.

## Implemented Substrate

- Added a code-first community registry with:
  - `community-gov`: enabled, public, production rkey `community-gov`, existing Redis keys.
  - `birders_who_code`: disabled, private, planned rkey `birders-who-code`, namespaced Redis keys.
- Added Birders terms for birding plus code/data bridge discovery.
- Added a Birders scout/materializer that:
  - reads recent non-deleted `posts`;
  - joins active-epoch `post_scores`;
  - reweights stored score components with static Birders seed weights;
  - reports corpus health before any publication decision;
  - writes only `feed:community:birders_who_code:*` keys when explicitly run with `--materialize`.
- Added feed-rkey dispatch:
  - `community-gov` still reads from `feed:current`;
  - disabled Birders requests are rejected clearly;
  - disabled/private feeds are hidden from `describeFeedGenerator`.
- Added `npm run feed:birders-scout`:
  - default mode is read-only scout;
  - `--json` emits machine-readable metrics;
  - `--materialize` writes only the namespaced Birders bucket.

## Readiness Thresholds

These are scout thresholds for deciding whether a feed is worth qualitative
review and possible publication. They are not proof of feed quality by
themselves.

| Metric | Threshold |
| --- | ---: |
| Candidate posts per day | 100 |
| Unique authors per day | 30 |
| Strong bridge/high-relevance posts per day | 10 |

## Production Read-Only Scout

Production host: `corgi-vps`.
Checkout path: `/opt/bluesky-feed`.
Database access: read-only transaction with `ROLLBACK`.
Window: 72 hours.
Active production epoch: 2.

The first broad read-only scout used the same broad term model as the v1
materializer: Birders terms OR code/data bridge terms. It completed after the
SQL was reshaped to filter matching posts before joining active-epoch scores.

| Metric | Value |
| --- | ---: |
| Sample timestamp | 2026-07-10T00:33:28.29665+00:00 |
| Candidate posts | 22,449 |
| Candidate posts per day | 7,483.00 |
| Unique authors | 12,935 |
| Unique authors per day | 4,311.67 |
| Bridge-post share | 75.18% |
| Top-author concentration | 3.44% |
| Strong bridge/high-relevance posts | 1,649 |
| Strong bridge/high-relevance posts per day | 549.67 |
| Scout status | ready |

Interpretation: broad supply is not the bottleneck. This query is deliberately
wide, so it overstates Birders Who Code specificity because generic terms such
as `api`, `script`, and `github` are common on Bluesky.

## Stricter Split Scout

To avoid fooling ourselves with broad OR supply, a second read-only split query
bucketed the same 72-hour scored production window.

Sample timestamp: 2026-07-10T00:35:48.833196+00:00.

| Bucket | Candidate posts | Candidates/day | Unique authors | Authors/day | Relevance >= 0.65/day | Strict strong/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| broad_or | 22,440 | 7,480.00 | 12,931 | 4,310.33 | 570.00 | 4.67 |
| bird_only | 5,732 | 1,910.67 | 4,153 | 1,384.33 | 25.00 | 4.67 |
| bridge_only | 16,870 | 5,623.33 | 9,377 | 3,125.67 | 549.67 | 4.67 |
| bird_and_bridge | 162 | 54.00 | 136 | 45.33 | 4.67 | 4.67 |

Interpretation: birding-only supply is healthy, and the strict bird+code bridge
bucket has enough volume for review fixtures and demo examples. It does not yet
meet the original 10/day strong bridge/high-relevance threshold. Before
publishing a public Birders feed, tune the terms/scoring threshold and do a
human precision audit against hydrated public posts.

## Safety Boundaries

The readiness code must not mutate:

- `feed:current`
- `feed:epoch`
- `governance_votes`
- `governance_epochs`
- `governance_audit_log`
- production snapshots
- research exports

The materializer writes only:

- `feed:community:birders_who_code:current`
- `feed:community:birders_who_code:epoch`
- `feed:community:birders_who_code:health`
- `feed:community:birders_who_code:snapshot_generation`
- `feed:community:birders_who_code:current_snapshot_id`

## Verification Receipts

- Focused Birders/feed slice passed after the zero-candidate active-epoch guard:
  5 files / 50 tests.
- `npm run feed:birders-scout -- --help` exited cleanly and documented default
  read-only behavior.
- `npm run build` passed.
- Full `npm run verify` passed: root build, default suite 117 files / 1,045
  Vitest tests, CLI build, MCP-local skip, SDK build, SDK fixture, legacy
  `web` lint/build, and `web-next` static build.
- Production broad scout and stricter split scout both ran inside read-only
  transactions and rolled back.

## Recommendation

Do not publish `birders-who-code` yet. The next responsible step is to run the
materializer in a disabled/private mode, hydrate a sample through Bluesky
AppView, and manually inspect precision, diversity, and safety. If that review
looks good, then publishing the feed record becomes a product decision rather
than an infrastructure blocker.
