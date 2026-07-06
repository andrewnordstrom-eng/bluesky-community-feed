# Corgi Ingestion And Voting Validation Lab Journal

Date: 2026-07-05
Issue: PROJ-1551
Branch: `dev/PROJ-1551-corgi-validation`
Runtime test checkout: `f2310a036cb668a9e7419ee8419a2cbe44dc9920` plus the uncommitted PROJ-1551 validation diff

This entry records local quantitative validation for the July 15 RecSys demo packet. It is deliberately narrow: it proves what was run on an isolated local worktree and identifies what remains unproven. It does not claim production ingestion throughput or live voting-scale readiness.

## Objective

Answer three questions with receipts:

1. Does the existing test suite pass on a clean, current branch?
2. Does the governance/voting simulation harness exercise the real aggregation and epoch machinery quantitatively?
3. Do the available ingestion-adjacent and feed-serving stress tests expose obvious write-safety, latency, or backpressure failures?

## Safety Boundary

- No production or staging endpoint was load-tested.
- No production, staging, or existing local database was used for destructive stress tests.
- Real credentials were not used. Required config values were set to non-production dummy values.
- Destructive stress testing was run only against fresh Testcontainers Postgres and Redis instances.
- The current dirty demo worktree was not reused.

## Methodology

The validation used the repo's existing test surfaces instead of inventing a one-off benchmark:

- Default suite: `npm test -- --run`
- Focused ingestion/Jetstream sweep: targeted Vitest files for Jetstream, queue saturation, engagement ingestion, embedding ingestion, and post filtering
- Governance harness: `npm run sim:core`, which starts real `postgres:16` and `redis:7-alpine` Testcontainers, runs the real migrations, and exercises the production aggregation/scoring paths
- Feed-serving stress: `tests/stress/feed-skeleton.stress.ts` against ephemeral Redis
- Concurrent-write stress: `tests/stress/concurrent-writes.stress.ts` against fresh migrated Postgres plus ephemeral Redis

The first default-suite attempt failed in a clean worktree because required config env vars were absent. A second sandboxed attempt also showed local IPC/loopback restrictions. The final receipt used dummy env values plus local IPC/loopback access so the tests could exercise the code instead of the sandbox.

## Environment

- Node dependencies installed via `npm ci`
- Install result: 531 packages added, 534 audited, 0 vulnerabilities
- Docker runtime available: 29.4.3
- Testcontainers images used: `postgres:16`, `redis:7-alpine`
- App runtime env: `NODE_ENV=test` plus the dummy local config values below.

Dummy env used for the default regression suite:

```text
NODE_ENV=test
LOG_LEVEL=warn
BOT_ENABLED=false
TOPIC_EMBEDDING_ENABLED=false
FEEDGEN_SERVICE_DID=did:plc:corgisimharness00000000000
FEEDGEN_PUBLISHER_DID=did:plc:corgisimharnesspublisher0
FEEDGEN_HOSTNAME=sim-harness.local.test
JETSTREAM_URL=wss://sim-harness.local.test/subscribe
JETSTREAM_FALLBACK_URL=wss://sim-harness.local.test/subscribe-fallback
JETSTREAM_COLLECTIONS=app.bsky.feed.post
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/corgi_dummy_test
REDIS_URL=redis://127.0.0.1:6379
BSKY_IDENTIFIER=sim-harness.test
BSKY_APP_PASSWORD=sim-harness-not-a-real-password
```

## Receipt Summary

| Surface | Command | Result | What It Proves |
| --- | --- | --- | --- |
| Dependency install | `npm ci` | Pass, 0 vulnerabilities | Lockfile can install cleanly in the isolated worktree. |
| Full local verification gate | `npm run verify` | Pass, 97 files / 840 tests | Root TypeScript build, default Vitest suite, CLI build, MCP-local skip check, SDK build, SDK fixture, Vite lint/build, and Next static build are green on the current `origin/main` base after refreshing `web` and `web-next` lockfile installs and applying post-review fixes. |
| Default regression suite | `npm test -- --run` | Pass, 97 files / 840 tests | Existing mocked/unit/route-level test surfaces are green on current `origin/main` base with dummy local config and local IPC/loopback access. |
| Focused hardening sweep | Targeted Vitest closeout files | Pass, 7 files / 83 tests plus follow-up 2 files / 24 tests, 5 files / 65 tests, 4 files / 35 tests, and 3 files / 39 tests | Request tracking, snapshot cache, lab artifacts, stress harness setup, preflight failure JSON, HTTP load accounting, engagement attribution, Jetstream cursor/error handling, abort-aware feed tracking, queue saturation observability, private-mode tracking DID reuse, subscriber redaction, Jetstream duplicate-cursor safety, artifact provenance, and replay aggregate-state verification pass. |
| Governance/voting harness | `npm run sim:core` | Pass, 17 files / 178 tests | Real migrations, real Postgres/Redis, real aggregation, scoring, epoch transitions, and synthetic voters are coherent. |
| Simulation preflight | `npm --silent run sim:preflight` | Pass, 4/4 checks | Docker, Testcontainers, migrations, harness files, and sim scripts are available locally; stdout is parseable JSON. |
| Campaign manifest | `npm run sim:campaign -- --dry-run --max-stage S1` | Pass, 4 planned runs | The campaign ladder emits strict scenario configs without touching DB/Redis. |
| Simulated epoch campaign S2 | `npx tsx scripts/sim-campaign.ts --ephemeral --stage S2` | Pass, 3 seeds | 500-user / 2,000-post runs execute end-to-end in throwaway Postgres/Redis. |
| Simulated epoch campaign S3 | `npx tsx scripts/sim-campaign.ts --ephemeral --stage S3` | Pass, 3 seeds | 2,000-user / 5,000-post runs execute end-to-end in throwaway Postgres/Redis. |
| Simulated epoch campaign S4 | `npx tsx scripts/sim-campaign.ts --ephemeral --stage S4` | Pass, 2 seeds | 5,000-user / 20,000-post stretch runs execute end-to-end locally. |
| Simulated epoch campaign S5 | `npx tsx scripts/sim-campaign.ts --ephemeral --stage S5` | Pass, 2 seeds | 10,000-user / 50,000-post target-ceiling runs execute end-to-end locally. |
| Feed-serving stress | Ephemeral Redis runner for `feed-skeleton` | Pass, 20,000 total requests | Local feed skeleton endpoint stays below p95 target with 100 connections and no errors/timeouts. |
| Concurrent write stress | Ephemeral Postgres/Redis runner for `concurrent-writes` | Pass, 50 concurrent likes | Like writes and attribution updates did not duplicate or undercount under this local concurrency case. |
| Recorded Jetstream replay gate | `npm run lab:jetstream-replay -- --ephemeral --events 1200` | Pass, 1,200 events | Production Jetstream message-processing path handled the synthetic recorded mix with 0 queue drops, 0 handler errors, 0 state mismatches, and measured cursor lag/handler latency. |
| Real HTTP voting load gate | `npm run lab:vote-load -- --ephemeral --valid-requests 8000 --users 500 --connections 100` | Pass, 8,000 vote POSTs | The real Fastify route, session lookup, rate limit, wide vote row, long-table rows, and audit log reconciled exactly in local ephemeral infra. |
| Process-isolated memory gate | `npm run lab:memory-isolated -- --ephemeral --runs 5 --amount 10000 --connections 100` | Pass after fix | Fresh server child processes stayed within after-GC RSS and peak RSS ceilings with tracker, Redis, heap, external memory, and socket diagnostics recorded. |
| Compiled prod-parity memory gate | `npm run lab:memory-prod-parity -- --ephemeral --runs 5 --amount 10000 --connections 100` | Pass | The memory gate also passed with compiled `dist-lab` runner/server code and child runtime `node --expose-gc --max-old-space-size=896 --max-semi-space-size=16`. |

## Quantitative Results

### Default Suite

- Full `npm run verify`: pass after current-main fast-forward, frontend lockfile installs, and post-review fixes, including root TypeScript build, 97-file / 840-test Vitest pass, CLI/SDK builds, Vite lint/build, and Next static build
- Final pass: 97 test files, 840 tests
- Initial missing-env run: 44 files / 422 tests ran before config import failures
- Sandbox-only failure mode: `listen EPERM` on local loopback and `tsx` IPC pipe creation
- Interpretation: the suite is green when run with required non-production config and local IPC/loopback access. The clean worktree lacks a checked-in `.env.test` style harness, which makes the first-run developer experience brittle.

### Focused Hardening Sweep

Command targets:

- `tests/jetstream-message-processing.test.ts`
- `tests/feed-snapshot-cache.test.ts`
- `tests/harness/lab-artifacts.test.ts`
- `tests/stress/feed-skeleton.stress.ts`
- `tests/sim-preflight.test.ts`
- `tests/http-load.test.ts`
- `tests/feed-request-tracker.test.ts`
- `tests/engagement-attribution.test.ts`

Result: Vitest reported 7 files, 83 tests passed.

Follow-up feed tracking slice: `npx vitest tests/feed-skeleton-tracking.test.ts tests/feed-request-tracker.test.ts --run` passed 2 files / 24 tests after adding coverage that a stalled tracking Redis read honors the request tracker timeout, releases its slot, reports `timedOut=1`, leaves `inFlight=0` and `queued=0`, and does not proceed to the Redis write pipeline after the abort.

Follow-up CLI/load-accounting slice: `npx vitest tests/http-load.test.ts tests/engagement-ingestion-filter.test.ts tests/jetstream-message-processing.test.ts tests/sim-preflight.test.ts tests/vote-load-cli.test.ts --run` passed 5 files / 65 tests after hardening the standalone load-test process exit path, expected-status accounting coverage, repo-local `tsx` CLI loading, and explicit subprocess test timeouts.

Follow-up queue/redaction slice: `npx vitest tests/feed-request-tracker.test.ts tests/feed-skeleton-tracking.test.ts tests/feed-skeleton-auth.test.ts tests/subscribers-log-redaction.test.ts --run` passed 4 files / 35 tests after adding rate-limited tracking queue saturation warnings, concurrent drain waiter edge coverage, private-mode verified-DID reuse for tracking, and subscriber log-redaction coverage for string, null, and non-string-property rejection values.

Post-review critical/provenance slice: `npx vitest tests/jetstream-message-processing.test.ts tests/harness/lab-artifacts.test.ts tests/feed-snapshot-cache.test.ts --run` passed 3 files / 39 tests after fixing duplicate in-flight Jetstream cursor accounting, by-ID snapshot cache invalidation, lab-artifact symlink/untracked/checksum provenance, and aggregate replay state verification.

Receipt-integrity hardening slice: `npx vitest tests/feed-request-tracker.test.ts tests/jetstream-message-processing.test.ts tests/jetstream-replay-harness.test.ts tests/harness/lab-artifacts.test.ts tests/memory-isolated-cli.test.ts tests/vote-load-cli.test.ts --run` passed 6 files / 71 tests after fixing timeout classification for abort-aware tracking tasks, monotonic Jetstream cursor UPSERTs, replay expected-delta validation, manifest schema validation, lab guard ordering, cleanup failure propagation, and bounded memory CLI arguments.

Interpretation: focused closeout behavior is intact after CodeRabbit hardening. This is not a throughput benchmark and does not prove live Jetstream replay, event-loss accounting, cursor recovery under real network churn, or production DB write saturation.

### Governance And Voting Harness

`npm run sim:core` ran the harness suite against real Testcontainers-backed Postgres and Redis. Migrations `001_initial_schema.sql` through `022_governance_weights_longtable.sql` applied successfully before tests. Current closeout result: 17 files / 178 tests passed.

Key measured coverage:

- Fast-check normalization invariants: 200 generated runs for sum-to-one behavior
- Trimmed-mean bounds invariant: 200 generated runs
- Real `aggregateVotes` idempotency: 10 generated async runs against Postgres
- Multi-epoch cycle: 6 real aggregate -> transition -> score rounds, 12 votes per round, CSV and audit-log artifacts verified
- Convergence: 20 rounds with 60 homogeneous voters; last-10-round variance under `5e-3`
- Strategyproofness sweep: population sizes 6, 8, 10, 15, 20, 30, 50 with trim counts pinned to the real rule
- Strategyproofness seed fixture at n=10: sincere L1 approximately 0.302, strategic L1 approximately 0.236; manipulation payoff is directionally positive for the documented population
- Baseline comparison: 60 voters, 200-post corpus, topK 50 across no-governance, engagement-only, and community-governed regimes
- Baseline ranking churn: normalized displacement and Kendall tau distance both asserted greater than 0.02 between engagement-only and community-governed
- Baseline quality tradeoff: governed author concentration is asserted no higher than engagement-only; distortion ratio is asserted between 0.5 and 1

Interpretation: synthetic voting mechanism evidence is strong for the local harness. It exercises production aggregation, long-table vote reads/writes, epoch transitions, scoring, and feed-space metrics. It still does not prove the live HTTP voting route under production-like session, auth, rate-limit, proxy, and browser traffic.

### Executable Simulated Epoch Campaign

This pass added an executable campaign ladder around the existing real governance/scoring harness:

- `npm --silent run sim:preflight` verifies harness files, package scripts, Docker, Testcontainers, and migrations with JSON-only stdout. Migration progress is emitted on stderr.
- `npm run sim:campaign -- --dry-run --max-stage S1` prints the planned scenario manifest without touching DB/Redis.
- `npm run sim:campaign -- --ephemeral --stage S5` starts throwaway `postgres:16` and `redis:7-alpine`, applies migrations, runs the selected campaign stage, writes artifacts, then tears the containers down.
- `npm run lab:jetstream-replay -- --ephemeral --events 1200` starts throwaway Postgres/Redis, runs migrations, drives synthetic recorded Jetstream frames through the production message-processing path, measures event mix, events/sec, handler p50/p95/p99, durable state mutations/sec, cursor lag, queue drops, parse errors, handler errors, state mismatches, and optional scoring delay.
- `npm run lab:vote-load -- --ephemeral --valid-requests 8000 --users 500 --connections 100` starts the full Fastify server, seeds 500 Redis-backed governance sessions and active subscribers, POSTs to the real `/api/governance/vote` route, reconciles wide votes, long-table votes, audit log rows, duplicate/upsert behavior, status buckets, p95/p99/max latency, and runs a separate per-DID 429 rate-limit phase.
- `npm run lab:memory-isolated -- --ephemeral --runs 5 --amount 10000 --connections 100` spawns fresh `node --expose-gc` child processes per feed-serving mode, samples RSS externally with `ps`, records heap/RSS before and after forced GC, and gates median/p95/max after-GC deltas plus peak RSS.

Campaign ladder:

| Stage | Users | Posts | Seeds | Classification |
| --- | ---: | ---: | ---: | --- |
| S0 smoke | 30 | 50 | 1 | gate |
| S1 small | 100 | 500 | 3 | gate |
| S2 medium | 500 | 2,000 | 3 | gate |
| S3 legacy ceiling | 2,000 | 5,000 | 3 | gate |
| S4 stretch | 5,000 | 20,000 | 2 | capacity |
| S5 target ceiling | 10,000 | 50,000 | 2 | capacity |

Preflight result:

- harness files: 17 runnable test/sim files found
- package scripts: `sim:core`, `sim:preflight`, and `sim:campaign` present
- Docker server: 29.4.3
- Testcontainers/migrations: `postgres:16` and `redis:7-alpine` started; migrations 001 through 022 applied
- One current-head preflight attempt at `2026-07-05T22:17:06.673Z` failed because Testcontainers port binding exceeded the 10s preflight window; the immediate retry at `2026-07-05T22:17:23.244Z` passed all 4 checks with migrations applied in 1.667s.

Dry-run manifest result:

- `--max-stage S1` emitted 4 planned runs: S0 seed 42 plus S1 seeds 42, 1337, and 20260705.
- No DB/Redis connection was required.

Executed campaign results:

| Stage | Seeds Run | Users | Posts | Vote Count Per Run | Score Rows Per Run | Redis Feed Count Per Run | Top Posts Fetched | Total Duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| S0 | 1 | 30 | 50 | 24 | 13 | 12 | 13 | 2.041s |
| S2 | 3 | 500 | 2,000 | 400 | 2,000 | 1,000 | 50 | 6.861s |
| S3 | 3 | 2,000 | 5,000 | 1,600 | 5,000 | 1,000 | 50 | 14.417s |
| S4 | 2 | 5,000 | 20,000 | 4,000 | 10,000 | 1,000 | 50 | 19.561s |
| S5 | 2 | 10,000 | 50,000 | 8,000 | 10,000 | 1,000 | 50 | 22.562s |

Interpretation:

- The simulated epoch mechanism can now be run as a reproducible campaign, not only as scattered harness tests.
- S2 directly answers the "few hundred fake users" question: 500 synthetic users with persona-driven interests voted across three seeds and the real aggregate -> transition -> score path completed.
- S5 confirms the requested 10,000-user / 50,000-post synthetic ceiling can execute locally under direct harness seeding.
- This is still governance/scoring campaign evidence, not Jetstream replay evidence. The campaign seeds synthetic rows into the harness, then drives production aggregation/scoring. It does not replay live Jetstream frames through `processEvent`.
- `scoreRowCount`, `redisFeedCount`, and `topPostsFetched` are intentionally recorded separately because they measure different surfaces: database score rows, served Redis feed capacity, and artifact top-K sample size. S0 showed 13 score rows and 12 Redis feed rows; larger stages published the configured 1,000-row feed cap.

### Lab Artifact Protocol

New lab-phase runners write durable local receipts under:

```text
artifacts/lab/PROJ-1551/<run-id>/
```

Tracked protocol files:

- `artifacts/lab/README.md`
- `artifacts/lab/manifest.schema.json`

Each run directory must include `manifest.json`, `checksums.sha256`, and one phase subdirectory such as `jetstream-replay/`, `vote-load/`, or `memory-isolated/`. The manifest records issue, branch, git head/base/dirty files, diff SHA-256, sanitized env digests, runtime, command argv/cwd/exit code, artifacts with SHA-256 checksums, thresholds, and claims. Bulky run payloads are ignored by git; the protocol files are tracked.

Current runner verification:

- `npm run lab:jetstream-replay -- --dry-run --events 19 --skip-scoring`: pass; emitted a PROJ-1551 run directory receipt.
- `npm run lab:vote-load -- --dry-run --valid-requests 40 --users 4 --connections 2`: pass; emitted a PROJ-1551 run directory receipt.
- `npm run lab:memory-isolated -- --dry-run --runs 1 --amount 100 --connections 2`: pass; emitted a PROJ-1551 run directory receipt.
- Small Jetstream replay smoke: `npm run lab:jetstream-replay -- --ephemeral --events 19 --skip-scoring`
  - Manifest: `artifacts/lab/PROJ-1551/2026-07-05T13-14-44-020Z/manifest.json`
  - Summary: `artifacts/lab/PROJ-1551/2026-07-05T13-14-44-020Z/jetstream-replay/summary.json`
  - Result: pass; 19 events, 19 expected outcomes observed, 577.92 events/sec, handler p95 2.48 ms, durable state mutations 12, queue drops 0, handler errors 0, state mismatches 0.
- Small HTTP voting smoke: `npm run lab:vote-load -- --ephemeral --valid-requests 40 --users 4 --connections 4`
  - Manifest: `artifacts/lab/PROJ-1551/2026-07-05T13-15-17-377Z/manifest.json`
  - Summary: `artifacts/lab/PROJ-1551/2026-07-05T13-15-17-377Z/vote-load/summary.json`
  - Result: pass; 40/40 valid vote POSTs returned 200, errors 0, timeouts 0, unexpected statuses 0, p95 20.37 ms, p99 21.69 ms, vote rows 4/4, audit rows 40/40, long-table rows 20/20, rate-limit phase 20 accepted and 5 `429`.
- Small process-isolated memory smoke: `npm run lab:memory-isolated -- --ephemeral --runs 1 --amount 100 --connections 4`
  - Manifest: `artifacts/lab/PROJ-1551/2026-07-05T13-24-17-206Z/manifest.json`
  - Summary: `artifacts/lab/PROJ-1551/2026-07-05T13-24-17-206Z/memory-isolated/summary.json`
  - Result: pass; normal mode p95 3.24 ms, after-GC RSS delta 15.52 MB, peak RSS 170.02 MB; no-op mode p95 3.37 ms, after-GC RSS delta 17.22 MB, peak RSS 158.28 MB.

Dry-runs prove CLI parsing, artifact path creation, and guard math only. The small `--ephemeral` smokes prove end-to-end runner wiring against throwaway Postgres/Redis.

Full gate receipts:

- Jetstream replay full gate: `npm run lab:jetstream-replay -- --ephemeral --events 1200`
  - Manifest: `artifacts/lab/PROJ-1551/2026-07-06T19-37-49-725Z/manifest.json`
  - Summary: `artifacts/lab/PROJ-1551/2026-07-06T19-37-49-725Z/jetstream-replay/summary.json`
  - Result: pass; 1,200 events, 3,105.67 events/sec, handler latency p50 0.27 ms / p95 0.76 ms / p99 1.02 ms / max 5.13 ms, 569 durable state mutations, 1,472.61 durable mutations/sec, queue depth max 0, dropped events 0, handler errors 0, state mismatches 0, outcome mismatches 0, duplicate no-ops 253, untracked ignores 126, cursor lag 793 microseconds.
  - Parse-path coverage: 63 intentionally malformed fixture frames produced 63 parse errors. These are counted as expected parse-error outcomes, not lost events.
  - Scoring follow-through: scoring delay 5.9 ms and 1 score row. This proves the replay can trigger scoring, but it is not a broad scoring-volume benchmark because most fixture posts are deleted within each replay cycle.
  - Post-review negative control: `artifacts/lab/PROJ-1551/2026-07-05T17-29-06-589Z/manifest.json` exited 1 because replay processing passed but the scoring claim failed with 0 score rows. That receipt is intentionally retained as evidence that replay and scoring claims are independently gated.
  - Superseded local receipt: `artifacts/lab/PROJ-1551/2026-07-06T19-05-07-506Z/manifest.json` passed before the replay runner's expected-delta validation was hardened. The `19-37-49Z` receipt above is the current replay receipt for this diff.
- HTTP voting full gate: `npm run lab:vote-load -- --ephemeral --valid-requests 8000 --users 500 --connections 100`
  - Manifest: `artifacts/lab/PROJ-1551/2026-07-06T19-38-04-859Z/manifest.json`
  - Summary: `artifacts/lab/PROJ-1551/2026-07-06T19-38-04-859Z/vote-load/summary.json`
  - Result: pass; 8,000/8,000 valid vote POSTs returned `200`, errors 0, timeouts 0, non-2xx 0, unexpected statuses 0, p50 33.14 ms, p95 48.18 ms, p99 101.06 ms, p999 263.02 ms, max 319.53 ms.
  - Reconciliation: 500 subscriber rows, 500 wide vote rows, 500 distinct voters, 8,000 audit rows, 500 `vote_cast` rows, 7,500 `vote_updated` rows, 2,500 long-table weight rows.
  - Rate-limit phase: 25 requests from one DID produced 20 accepted `200` responses and 5 `429` responses, with 1 final vote row and 20 audit rows for that DID.
  - Aggregate rate-limit check: post-rate-limit aggregate rows matched expected values exactly: 501 vote rows, 8,020 audit rows, and 2,505 long-table rows. The 5 rejected `429` requests did not mutate aggregate vote state beyond the 20 accepted updates.
  - Cleanup check: ordered shutdown completed with `cleanupFailures: []`, and the manifest exit code was written after cleanup.
  - Repeatability warning: the immediately preceding post-review 100-connection attempt `artifacts/lab/PROJ-1551/2026-07-06T17-44-14-781Z/manifest.json` failed with 7,903/8,000 valid `200` responses, 97 timeouts, p95 121.55 ms, 7,960/8,000 expected audit rows, and route logs showing PostgreSQL pool connection timeouts. A 50-connection discriminator passed (`artifacts/lab/PROJ-1551/2026-07-06T18-25-11-074Z/manifest.json`), then the 100-connection rerun above passed. Treat the current pass as local evidence, not proof of shared-environment saturation headroom.
- Process-isolated memory initial failing gate: `npm run lab:memory-isolated -- --ephemeral --runs 5 --amount 10000 --connections 100`
  - Manifest: `artifacts/lab/PROJ-1551/2026-07-05T13-24-30-526Z/manifest.json`
  - Summary: `artifacts/lab/PROJ-1551/2026-07-05T13-24-30-526Z/memory-isolated/summary.json`
  - Result: fail; all 10 child processes exited 0 and the load phases stayed responsive, but RSS thresholds failed after forced GC.
  - Normal mode: 5 runs, median after-GC RSS delta 374.68 MB, p95 385.27 MB, max 385.27 MB, max peak RSS 525.77 MB, max event-loop delay p95 24.71 ms.
  - No-op request logging mode: 5 runs, median after-GC RSS delta 370.43 MB, p95 387.58 MB, max 387.58 MB, max peak RSS 529.11 MB, max event-loop delay p95 24.22 ms.
  - Attribution finding: later diagnostics showed heap-used deltas near 1 MB, tracker drops 0, remaining server connections 0, external/array-buffer growth eliminated after the route fix, and Redis `snapshot:*` count held at 1. The main avoidable allocation was cursor-page JSON parsing of the full Redis snapshot on every request.
- Process-isolated memory no-old-space negative control: `npm run lab:memory-isolated -- --ephemeral --runs 5 --amount 10000 --connections 100 --diagnostic`
  - Manifest: `artifacts/lab/PROJ-1551/2026-07-05T17-38-00-846Z/manifest.json`
  - Summary: `artifacts/lab/PROJ-1551/2026-07-05T17-38-00-846Z/memory-isolated/summary.json`
  - Runtime difference: this negative control used the tsx child without the explicit `--max-old-space-size=896 --max-semi-space-size=16` runtime bound used by the fixed gates below.
  - Result: fail under the tsx child with default Node old-space; normal median/p95 after-GC RSS delta 113.61 MB / 127.00 MB and no-op 72.16 MB / 75.83 MB. Heap-used deltas were about 0.6 MB and sockets/tracker drained, so the failure was resident runtime headroom rather than a retained JS-object leak.
- Process-isolated memory fixed full gate: `npm run lab:memory-isolated -- --ephemeral --runs 5 --amount 10000 --connections 100`
  - Manifest: `artifacts/lab/PROJ-1551/2026-07-06T19-38-23-532Z/manifest.json`
  - Summary: `artifacts/lab/PROJ-1551/2026-07-06T19-38-23-532Z/memory-isolated/summary.json`
  - Child runtime: `node --expose-gc --max-old-space-size=896 --max-semi-space-size=16 --import tsx`
  - Result: pass; all 10 child processes exited 0, load phases stayed responsive, tracker drops were 0, and remaining server connections were 0.
  - Normal mode: 5 runs, median after-GC RSS delta 44.75 MB, p95 50.27 MB, max 50.27 MB, max peak RSS 251.34 MB, max event-loop delay p95 21.59 ms.
  - No-op request logging mode: 5 runs, median after-GC RSS delta 42.94 MB, p95 51.09 MB, max 51.09 MB, max peak RSS 234.20 MB, max event-loop delay p95 21.54 ms.
  - Threshold comparison: declared gates were max after-GC delta <= 128 MB per run, median <= 64 MB per mode, p95 <= 96 MB per mode, max peak RSS <= 512 MB per mode, dropped tracking = 0, remaining connections = 0, child exit code 0, and a 1,000-request external warmup before the baseline snapshot. Both modes passed all gates.
- Superseded tsx memory heap-snapshot receipt: `npm run lab:memory-isolated -- --ephemeral --runs 1 --amount 10000 --connections 100 --diagnostic --heap-snapshots`
  - Manifest: `artifacts/lab/PROJ-1551/2026-07-05T14-35-09-768Z/manifest.json`
  - Summary: `artifacts/lab/PROJ-1551/2026-07-05T14-35-09-768Z/memory-isolated/summary.json`
  - Heap snapshots: `artifacts/lab/PROJ-1551/2026-07-05T14-35-09-768Z/memory-isolated/heaps/normal-run-0-before.heapsnapshot`, `normal-run-0-after-gc.heapsnapshot`, `noop-run-0-before.heapsnapshot`, and `noop-run-0-after-gc.heapsnapshot`.
  - Result: pass; normal after-GC RSS delta 6.32 MB, no-op after-GC RSS delta 5.48 MB, tracker drops 0, remaining connections 0. This receipt is retained as historical attribution evidence; the current compiled heap-snapshot receipt below supersedes it. Heap snapshots are diagnostic artifacts and are not used as the primary gate because `v8.writeHeapSnapshot()` itself changes process RSS and blocks the event loop.
- Compiled prod-parity memory full gate: `npm run lab:memory-prod-parity -- --ephemeral --runs 5 --amount 10000 --connections 100`
  - Manifest: `artifacts/lab/PROJ-1551/2026-07-06T19-42-01-707Z/manifest.json`
  - Summary: `artifacts/lab/PROJ-1551/2026-07-06T19-42-01-707Z/memory-isolated/summary.json`
  - Child runtime: `node --expose-gc --max-old-space-size=896 --max-semi-space-size=16 dist-lab/tests/stress/feed-skeleton-memory-server.js`
  - Result: pass; all 10 compiled child processes exited 0, load phases stayed responsive, tracker drops were 0, and remaining server connections were 0.
  - Normal mode: 5 runs, median after-GC RSS delta 36.43 MB, p95 39.49 MB, max 39.49 MB, max peak RSS 215.92 MB, max event-loop delay p95 21.74 ms.
  - No-op request logging mode: 5 runs, median after-GC RSS delta 30.14 MB, p95 40.10 MB, max 40.10 MB, max peak RSS 215.70 MB, max event-loop delay p95 21.63 ms.
  - Threshold comparison: declared gates were max after-GC delta <= 128 MB per run, median <= 64 MB per mode, p95 <= 96 MB per mode, max peak RSS <= 512 MB per mode, dropped tracking = 0, remaining connections = 0, child exit code 0, and a 1,000-request external warmup before the baseline snapshot. Both modes passed all gates.
- Compiled prod-parity heap-snapshot receipt: `npm run lab:memory-prod-parity -- --ephemeral --runs 1 --amount 10000 --connections 100 --diagnostic --heap-snapshots`
  - Manifest: `artifacts/lab/PROJ-1551/2026-07-05T17-42-12-174Z/manifest.json`
  - Summary: `artifacts/lab/PROJ-1551/2026-07-05T17-42-12-174Z/memory-isolated/summary.json`
  - Heap snapshots: `artifacts/lab/PROJ-1551/2026-07-05T17-42-12-174Z/memory-isolated/heaps/normal-run-0-before.heapsnapshot`, `normal-run-0-after-gc.heapsnapshot`, `noop-run-0-before.heapsnapshot`, and `noop-run-0-after-gc.heapsnapshot`.
  - Result: pass; normal/no-op after-GC RSS deltas 2.91 MB / 3.45 MB, peak RSS 329.14 MB / 340.02 MB, heap-used deltas -0.83 MB / -0.76 MB, external memory 3.98 MB -> 3.98 MB for normal and 3.96 MB -> 3.97 MB for no-op, array buffers 0.22 MB -> 0.22 MB for normal and 0.19 MB -> 0.21 MB for no-op, tracker drops 0, remaining connections 0. Heap snapshots remain diagnostic only because `v8.writeHeapSnapshot()` changes RSS and blocks the event loop.

### Implemented Follow-Up Gates

Jetstream replay pass criteria:

- queue drops = 0
- handler errors = 0
- state mismatches = 0
- outcome mismatches = 0
- optional scoring run produces score rows when enabled
- summary records event count, event mix, events/sec, handler latency p50/p95/p99, durable state mutations/sec, max input cursor, last processed cursor, persisted cursor, cursor lag, duplicate no-ops, untracked ignores, parse errors, outcome mismatches, and sample event results

HTTP voting pass criteria:

- valid phase: 8,000 expected `200` responses by default, 0 errors, 0 timeouts, 0 unexpected statuses, 0 5xx
- latency: p95 < 250 ms, p99 < 1000 ms, max < 5000 ms
- reconciliation: 500 active voters by default, exactly one wide vote row per voter/epoch, exactly 8,000 vote audit rows for the valid phase, exactly 5 long-table weight rows per voter
- rate-limit phase: 25 requests from one DID yields 20 accepted and 5 `429`, exactly one final vote row for that DID, and exactly 20 audit rows

Process-isolated memory pass criteria:

- every child exits 0 and reports forced-GC snapshots
- baseline snapshot is taken after a 1,000-request external warmup and drain, so the gate measures steady-state stress delta rather than first-touch runtime allocation
- default child runtime records `--expose-gc`, `--max-old-space-size=896`, and `--max-semi-space-size=16`
- compiled prod-parity child runtime records `--expose-gc`, `--max-old-space-size=896`, `--max-semi-space-size=16`, and compiled `dist-lab` entrypoints
- max after-GC RSS delta per run <= 128 MB
- median after-GC RSS delta per mode <= 64 MB
- p95 after-GC RSS delta per mode <= 96 MB
- max externally sampled peak RSS per mode <= 512 MB

Staging or production saturation remains explicitly out of scope for this lab entry. It requires a separate approved target, abort thresholds, and blast-radius plan before any external traffic or shared database load is attempted.

### [PLAN DRAFT] Staging Runtime And Saturation Gate

Stop condition: runtime/service changes and shared-environment load are outside the PROJ-1551 local-lab boundary. The repo contract identifies this repo as a production service deployed through systemd on the VPS, and the tracked unit `ops/bluesky-feed.service` is the runtime surface that would be touched. No systemd unit, deploy script, credential, DNS, production database, staging database, or external traffic target may be mutated until this plan is explicitly approved.

Evidence basis for the plan:

- Local compiled prod-parity memory receipt `artifacts/lab/PROJ-1551/2026-07-06T19-42-01-707Z/manifest.json` passed 5 runs per mode at 10,000 requests and 100 connections with `node --expose-gc --max-old-space-size=896 --max-semi-space-size=16`, normal/no-op median after-GC RSS deltas 36.43 MB / 30.14 MB, p95 deltas 39.49 MB / 40.10 MB, max peak RSS 215.92 MB / 215.70 MB, tracker drops 0, and remaining connections 0.
- Compiled heap-snapshot receipt `artifacts/lab/PROJ-1551/2026-07-05T17-42-12-174Z/manifest.json` attributed the fixed route to flat heap/external/socket behavior: normal/no-op after-GC RSS deltas 2.91 MB / 3.45 MB, heap-used deltas -0.83 MB / -0.76 MB, external memory 3.98 MB -> 3.98 MB and 3.96 MB -> 3.97 MB.
- The tracked systemd unit already includes `Environment=NODE_OPTIONS=--max-old-space-size=896`, `MemoryHigh=768M`, and `MemoryMax=1G`; the lab-proven runtime adds the missing `--max-semi-space-size=16` bound. The next target should verify that exact full runtime outside the lab child before any DB saturation or external voting load.

Approval fields required before execution:

- Approved target hostname/service name, explicitly non-production or isolated shadow production.
- Approved data target, with proof it is isolated from production writes. Destructive tests require a staging clone or disposable database/Redis, not the production database.
- Approved operator, time window, and abort authority.
- Approved traffic source IPs and maximum request rate.
- Approved rollback command and known-good service revision.
- Approved artifact destination for receipts, either `artifacts/lab/PROJ-1551/<run-id>/` or an external receipt store with checksum manifest.

Phase 0, read-only baseline:

- Record git SHA, service command, `NODE_OPTIONS`, `MemoryHigh`, `MemoryMax`, service active state, restart count, cgroup RSS/current memory, DB pool size, Redis memory, feed count, readiness, and public health.
- Pass gate: health and readiness both return 2xx, restart count is stable, no OOM or watchdog kill appears in the current journal window, and no secrets are printed.
- Abort: any failed health check, unknown target identity, missing rollback command, production write target, or unredacted secret exposure.

Phase 1, runtime adoption on the approved target:

- Proposed runtime: `NODE_OPTIONS=--max-old-space-size=896 --max-semi-space-size=16`.
- Apply only to the approved staging/shadow service surface, then restart that service.
- Pass gate: readiness returns within 90 seconds, restart count does not increase after the successful start, no OOM/watchdog kill, steady RSS stays below 512 MB for 10 minutes, and cgroup memory remains below `MemoryHigh=768M`.
- Abort: readiness failure for 90 seconds, any 5xx health response after startup, restart count increment after the first intended restart, RSS above 768 MB, cgroup OOM event, or operator concern.
- Rollback: restore the previous `NODE_OPTIONS`/service file, `systemctl daemon-reload`, restart the service, and re-run Phase 0 baseline. If rollback does not restore health inside 90 seconds, follow `docs/runbooks/incident-response.md`.

Phase 2, deployed feed-serving memory verification:

- Run the feed skeleton load shape against the approved target only: 10,000 requests, 100 connections, `limit=50`, the approved feed URI, and 30 second request timeout.
- Sample process RSS/cgroup memory before load, after warmup, after load, and 5 minutes after load. Record latency p50/p95/p99/max, status buckets, errors, timeouts, non-2xx, restart count, journal OOM/watchdog lines, and Redis feed count.
- Pass gate: p95 < 100 ms, errors 0, timeouts 0, non-2xx 0, 5xx 0, restart count unchanged, cgroup memory below 768 MB, steady RSS below 512 MB after the 5 minute drain, and no OOM/watchdog lines.
- Abort: p95 >= 250 ms for two consecutive samples, any 5xx burst above 1% in a 60 second window, any timeout rate above 1%, any restart/OOM/watchdog line, RSS above 768 MB, or operator concern.

Phase 3, Jetstream and scoring observation:

- Do not increase firehose traffic. Observe the approved target under normal Jetstream subscription for one scoring interval plus 10 minutes.
- Record raw received event count if available, processed event count, queue depth, cursor advance, cursor lag, handler errors, DB writes/sec, scoring start/end, scoring delay, score rows, and feed publish time.
- Pass gate: cursor advances monotonically, handler errors remain 0 or explained by expected parse rejects, queue drains between intervals, scoring completes, and feed snapshot remains readable.
- Abort: cursor stalls for 5 minutes while the socket is connected, queue depth grows for 5 consecutive minutes, handler errors exceed 0.1% without a known fixture cause, scoring exceeds 2 consecutive intervals, or feed snapshot read fails.

Phase 4, real HTTP voting under external traffic:

- Run only after Phases 1-3 pass on the approved isolated target.
- Use staging/shadow fake users and sessions, not real users, with the same reconciliation fields as `lab:vote-load`: expected status buckets, duplicate/upsert behavior, rate-limit behavior, wide vote rows, long-table rows, and audit rows.
- Start at 500 users / 8,000 vote POSTs / 100 connections. Increase only after each rung passes: 1,000 users / 16,000 POSTs / 150 connections, then 2,000 users / 32,000 POSTs / 200 connections.
- Pass gate per rung: expected 2xx and 429 buckets only, errors 0, timeouts 0, 5xx 0, p95 < 250 ms, p99 < 1000 ms, exact vote/audit/long-table reconciliation, duplicate-vote prevention preserved, and rate-limit rejects do not mutate vote aggregates beyond accepted updates.
- Abort: any 5xx, timeout rate above 0.5%, p95 >= 500 ms for two consecutive samples, audit/vote reconciliation mismatch, unexpected 2xx/4xx bucket, DB connections above 80% pool capacity, or operator concern.

Phase 5, DB saturation rehearsal:

- Run only after Phases 1-4 pass and only against an isolated staging database with restore point/backup verified.
- Gradually increase ingestion/scoring write pressure. Record DB writes/sec, transaction latency, lock waits, connection saturation, WAL growth, Redis latency, scoring delay, and feed publish delay.
- Pass gate: no failed migrations, no write loss, no duplicate key storm, no connection starvation, p95 DB write latency within the approved target, scoring delay under one scoring interval, and rollback rehearsal succeeds.
- Abort: DB CPU above 85% for 5 minutes, pool usage above 80% for 5 minutes, lock waits above the approved threshold, replication/backup lag above the approved threshold, scoring misses two intervals, or any production blast-radius ambiguity.

This plan is ready for approval, but it is not permission to execute. The next executable action is Phase 0 on an explicitly approved target.

### Feed-Skeleton Stress

Scenario: `feed-skeleton-load`

- Setup: ephemeral Redis, 2,000 seeded feed posts
- Request mix: 6 request profiles, including unauthenticated, authenticated, cursor, and malformed-JWT cases
- Load: 10,000 requests with normal Redis request logging and 10,000 requests with request logging no-op'd
- Connections: 100
- Timeout: 30 seconds

Normal logging:

- p50: 18.19 ms
- p95: 26.22 ms
- p99: 46.53 ms
- average: 18.99 ms
- max: 263.94 ms
- request rate average: 5,248.53 req/s
- total requests: 10,000
- errors: 0
- timeouts: 0
- status buckets: 8,334 2xx, 1,666 4xx, 0 5xx
- RSS delta: +439.09 MB

No-op request logging:

- p50: 16.65 ms
- p95: 23.21 ms
- p99: 26.40 ms
- average: 16.12 ms
- max: 43.66 ms
- request rate average: 6,179.77 req/s
- total requests: 10,000
- errors: 0
- timeouts: 0
- status buckets: 8,334 2xx, 1,666 4xx, 0 5xx
- RSS delta: +17.86 MB from the already-warmed process

Derived:

- Async logging p95 delta: 3.01 ms
- Async logging overhead: 12.97%
- p95 assertions passed for both modes under the 100 ms threshold

Interpretation: local feed serving is comfortably under the p95 target in this scenario. The large RSS increase during the first pass should be rerun in process isolation with heap snapshots before treating it as either benign warmup or a leak.

### Concurrent Write Stress

Scenario: `concurrent-write-safety`

- Setup: fresh migrated Postgres and ephemeral Redis
- Destructive table scope: local ephemeral `likes`, `post_engagement`, `posts`, `engagement_attributions`
- Concurrency: 50 parallel `handleLike` calls
- Duration: 595 ms

Metrics:

- `likeCount`: 50
- `likesTotal`: 50
- `likesDistinct`: 50
- `engagedTotal`: 50
- `duplicateLikeUris`: 0

Assertions:

- `like_count_exact_50`: pass
- `no_duplicate_likes`: pass
- `attribution_not_double_counted`: pass

Interpretation: the like ingestion write path handled this local concurrent-write case exactly. It does not cover reposts, replies, deletes, unlikes, out-of-order event delivery, replay, or sustained high-rate event ingestion.

### Read-Only Production Corpus Snapshot

This snapshot was collected after the local lab gates, from production in read-only mode on 2026-07-05 around 19:15 UTC. It is included as production corpus evidence for website/demo-paper wording. It is not a load test and does not mutate production.

Provenance:

- Host checkout: `/opt/bluesky-feed`, commit `f2310a0`
- Service state: `bluesky-feed` active, `ExecMainPID=2082916`, `NRestarts=0`
- Public feed generator DID: `did:plc:amzyknmm4auxijvykyfgznw2`
- Feed URI: `at://did:plc:amzyknmm4auxijvykyfgznw2/app.bsky.feed.generator/community-gov`
- Data source: production PostgreSQL aggregate reads, Redis counter reads, and public `GET /api/transparency/stats`
- Safety: no secrets printed; table-wide totals use `pg_stat_user_tables` planner statistics instead of expensive exact `COUNT(*)` scans.

Production config values observed:

- `JETSTREAM_COLLECTIONS=app.bsky.feed.post,app.bsky.feed.like,app.bsky.feed.repost,app.bsky.graph.follow`
- `SCORING_WINDOW_HOURS=72`
- `SCORING_CANDIDATE_LIMIT=2500`
- `FEED_MAX_POSTS=1000`
- `FEED_MIN_RELEVANCE=0.25`
- `INGESTION_GATE_ENABLED=true`
- `INGESTION_MIN_RELEVANCE=0.10`
- `INGESTION_MIN_TEXT_FOR_MEDIA=10`
- `TOPIC_EMBEDDING_ENABLED=false`
- `JETSTREAM_MAX_CONCURRENT=20`
- `JETSTREAM_MAX_PENDING=10000`

Table-size estimates from `pg_stat_user_tables`:

| Table | Estimated live rows | Estimated dead rows | Analyze freshness |
| --- | ---: | ---: | --- |
| `posts` | 6,185,961 | 7,085 | manual analyze at 2026-07-05T19:06:15Z |
| `post_engagement` | 6,181,906 | 1,128,182 | autoanalyze at 2026-07-05T17:01:29Z |
| `post_scores` | 6,176,236 | 641,133 | autoanalyze at 2026-07-05T17:28:27Z |
| `post_score_components` | 30,900,088 | 628,877 | autoanalyze at 2026-07-05T12:48:23Z |
| `likes` | 45,822,835 | 21,797 | manual analyze at 2026-07-05T19:06:19Z |
| `reposts` | 8,228,498 | 3,339 | manual analyze at 2026-07-05T19:06:23Z |
| `follows` | 12,569,801 | 17,841 | manual analyze at 2026-07-05T19:06:25Z |

Recent exact post-ingestion window counts:

| Window | Count |
| --- | ---: |
| Posts indexed in last 15 minutes | 2,550 |
| Posts indexed in last 1 hour | 9,715 |
| Posts indexed in last 24 hours | 313,656 in the first query; 313,983 in the later classification query |
| Active non-deleted posts with `created_at > now() - interval '72 hours'` | 530,683 |
| Active non-deleted posts in the same 72-hour lower-bound window excluding future `created_at` rows | 530,589 |
| Distinct authors in active 72-hour lower-bound window | 199,624 |

Current ranking/serving snapshot:

- Public stats endpoint returned HTTP 200 with epoch 2 active, 3,323 scored posts, 2,950 authors, 0 votes, median total score 0.5439370090593838.
- `system_status.current_scoring_run` recorded `posts_scored=3323`, `posts_filtered=0`, and `duration_ms=150504` for run `b6c1fddd-b00b-449f-ae92-5d0d03e56b02`.
- Redis recorded `feed:epoch=2`, `feed:count=1000`, `ZCARD feed:current=1000`, and `feed:updated_at=2026-07-05T19:14:24.214Z`.
- `getFeedSkeleton` with the real feed URI returned 100 posts and a cursor for `limit=100`.

Current classification/relevance shape:

- Public content rules reported 0 include keywords and 14 exclude keywords: `spam`, `nsfw`, `onlyfans`, `porn`, `hentai`, `xxx`, `erotic`, `bdsm`, `fetish`, `kink`, `bondage`, `chastity`, `nude`, `nudity`.
- Public topic catalog reported 26 topics, vote count 0, epoch 2.
- Recent production rows were keyword classified: 313,983 posts indexed in the last 24 hours had `classification_method=keyword`, with 0 empty `topic_vector` rows in that recent slice.
- The current scored run classification sample returned 3,290 rows with `classification_method=keyword` at query time. This was read after the current-run status row and may lag or differ slightly from the 3,323 public stats count because the query was scoped by the current run id while scoring/serving state can move.

Future-dated row note:

- 94 rows had `created_at > now()`.
- 4 rows had `created_at > now() + interval '1 day'`.
- 4 rows had `created_at > now() + interval '7 days'`.
- Maximum observed `created_at` was 2026-08-03T20:30:00Z.
- The production snapshot commit used a lower-bound cutoff (`created_at > cutoff`), so these rows were small but real candidate-window noise at snapshot time. The current PROJ-1551 local diff adds `created_at <= NOW()` guards to full scoring, incremental scoring, and Redis feed-write selection; deployed staging/production adoption remains unverified.

Interpretation:

- Production is collecting and retaining a substantial corpus: millions of posts, tens of millions of likes, millions of reposts, and millions of follows.
- The public "posts scored" and served feed counts are intentionally bounded by quality gates, a 72-hour scoring window, `SCORING_CANDIDATE_LIMIT`, relevance floor, and `FEED_MAX_POSTS=1000`; they are not a raw-firehose volume counter.
- This snapshot supports careful wording such as: "production had indexed approximately 6.19M posts, 45.8M likes, 8.23M reposts, and 12.57M follows, with roughly 314K posts indexed in the prior 24 hours, before scoring a bounded recent candidate set and serving a top-1,000 feed snapshot."
- This snapshot still does not prove live firehose completeness, rejection-rate attribution by gate, event-loss rate, or production DB saturation limits. Those need explicit instrumentation and/or an approved live capture/replay plan.

## Confirmed Claims

- The clean branch can install dependencies with `npm ci` and no audit findings.
- The default test suite is green when required dummy env and local IPC/loopback access are present.
- The governance harness passes against real migrated Postgres and Redis containers.
- Synthetic governance voting works in the local harness across multi-epoch, convergence, strategyproofness, and baseline-comparison tests.
- The executable simulated epoch campaign can run locally against throwaway Postgres/Redis through the requested 10,000-user / 50,000-post ceiling.
- Local feed-skeleton serving handled 20,000 mixed requests with 0 errors, 0 timeouts, and p95 under 100 ms.
- The concurrent like write path handled 50 parallel writes exactly in a fresh migrated database.
- The Jetstream replay, real HTTP voting, and process-isolated memory runners each passed a small end-to-end ephemeral smoke and wrote lab manifests.
- The 1,200-event recorded Jetstream replay gate passed locally with 3,105.67 events/sec, handler p95 0.76 ms, 569 durable state mutations, 0 queue drops, 0 handler errors, 0 state mismatches, 0 outcome mismatches, and 793 microseconds cursor lag.
- The current 8,000-request real HTTP voting gate passed locally with 500 users, 100 connections, 8,000/8,000 valid `200` responses, p95 48.18 ms, exact vote/audit/long-table reconciliation, correct 20 accepted plus 5 rate-limited responses in the per-DID phase, exact post-rate-limit aggregate rows, and cleanup failures 0. One preceding 100-connection attempt failed with 97 timeouts and PostgreSQL pool connection timeouts, so repeatability and DB pool headroom remain staging-gate concerns.
- The process-isolated feed memory gate now passes locally after caching cursor-page snapshots by ID, adding a 1,000-request external warmup baseline, and bounding the lab child V8 old-space/semi-space at 896 MB / 16 MB: normal mode median/p95 after-GC RSS deltas 44.75 MB / 50.27 MB, no-op mode 42.94 MB / 51.09 MB, max peak RSS 251.34 MB / 234.20 MB, tracker drops 0, and remaining connections 0.
- The compiled prod-parity memory gate also passes locally with `--max-old-space-size=896` and `--max-semi-space-size=16`: normal mode median/p95 after-GC RSS deltas 36.43 MB / 39.49 MB, no-op mode 30.14 MB / 40.10 MB, max peak RSS 215.92 MB / 215.70 MB, tracker drops 0, and remaining connections 0.
- A read-only production corpus snapshot on 2026-07-05 measured approximately 6.19M posts, 45.8M likes, 8.23M reposts, 12.57M follows, roughly 314K posts indexed in the prior 24 hours, 530K active lower-bound 72-hour candidate-window posts, a 3,323-post current scored set, and a 1,000-row Redis served feed snapshot.

## Blocked Or Unverified Claims

- Live Jetstream ingestion throughput is not quantified by these receipts. The recorded replay uses synthetic fixture frames in local ephemeral infra, not a live Jetstream socket.
- The production corpus snapshot measures stored rows, recent indexed rows, scoring status, and Redis feed size; it does not quantify raw live Jetstream events received, gate-by-gate rejection rates, or loss/drop rates.
- Cursor lag and replay correctness are quantified for the local recorded fixture mix; recovery time under real network churn is not measured.
- Production DB write saturation, DB pool headroom, and scoring-delay behavior are not measured.
- Live HTTP voting at production scale is not measured. The 8,000-request route-level receipt is local ephemeral infra, not staging or production.
- The executable campaign is direct harness seeding, not live HTTP voting or Jetstream replay.
- Session lookup and per-DID rate limiting are measured in the local HTTP voting gate. Proxy, browser, CDN, and external network behavior are not measured.
- Production/staging process memory is not yet proven. The local process-isolated gate passes under both the tsx lab runtime and the compiled prod-parity runtime, but the production systemd runtime was not changed in this issue because systemd/host mutation is outside PROJ-1551 scope without a separate approved plan.
- The default suite needs a reproducible local test-env wrapper so a clean worktree does not first fail on missing config.
- Checked-in golden snapshots for campaign outputs do not exist yet; the current evidence is command-output and artifact based.
- Keyword-only vote exclusion is covered in harness aggregation, but route-level keyword-only behavior under concurrent HTTP voting load is not measured.

## Blind Spots

1. Memory ceiling now has a failing baseline receipt, a fixed local tsx pass, and a fixed local compiled prod-parity pass. The remaining blind spot is adoption and verification of the same runtime memory control in staging or production under an approved ops plan.
2. Campaign evidence needs checked-in golden snapshots or rerun into `artifacts/lab/PROJ-1551/<run-id>/` so durable manifests replace `/private/tmp` provenance.
3. Recorded Jetstream replay covers the production message-processing path for the fixture mix, but not a live socket, backfill from a real cursor, network reconnect churn, or production DB saturation.
4. HTTP voting load covers the real local route/session/rate-limit/storage path, but not browser automation, reverse proxy/CDN behavior, cross-region clients, or staging/production database saturation.
5. Current stress coverage is still narrow: feed skeleton and likes are covered; repost/reply/delete/unlike ingestion and mixed event storms are not fully stress-tested.
6. Synthetic voter populations are useful for mechanism evidence, but they do not prove real electorate behavior, Sybil resistance, personhood, or abuse resistance.

## July 15 Submission Guidance

Safe wording:

- "We built and ran a local quantitative governance simulation harness backed by real migrations, Postgres, Redis, aggregation, epoch transition, and scoring code."
- "A local recorded Jetstream replay fixture ran 1,200 events through the production message-processing path at 3,105.67 events/sec with 0 drops, 0 handler errors, 0 state mismatches, 0 outcome mismatches, handler p95 0.76 ms, 569 durable state mutations, and cursor lag 793 microseconds."
- "A local real-route voting load ran 8,000 POSTs across 500 synthetic users with 8,000/8,000 `200` responses, p95 48.18 ms, exact database/audit reconciliation, exact aggregate rows after the 429 phase, cleanup failures 0, and correct per-DID 429 behavior. A preceding local 100-connection attempt failed and is retained as a staging-repeatability warning."
- "Local feed-serving stress handled 20,000 mixed requests with p95 below 100 ms and no errors/timeouts."
- "The local process-isolated feed memory gate passed 5 runs per mode at 10,000 requests and 100 connections, after a 1,000-request warmup baseline, with normal median/p95 after-GC RSS deltas 44.75 MB / 50.27 MB, no-op 42.94 MB / 51.09 MB, max peak RSS 251.34 MB / 234.20 MB, and 0 tracker drops or remaining connections."
- "The local compiled prod-parity memory gate also passed 5 runs per mode using `node --max-old-space-size=896 --max-semi-space-size=16`, after a 1,000-request warmup baseline, with normal median/p95 after-GC RSS deltas 36.43 MB / 39.49 MB and no-op 30.14 MB / 40.10 MB."
- "A local concurrent-like write stress test preserved exact counts and attribution under 50 parallel writes."

Do not claim yet:

- "The ingestion pipeline has been benchmarked end-to-end on live Jetstream."
- "Voting has been proven at production or staging scale."
- "The deployed production or staging feed route has passed memory-ceiling validation."
- "Production can sustain a specific events/sec or votes/sec target."
- "The local 100-connection voting load proved repeatable staging or production DB pool headroom."

## Recommended Follow-Up Work

1. Prepare a separate ops/staging plan to adopt and verify `NODE_OPTIONS=--max-old-space-size=896 --max-semi-space-size=16` outside the lab child. Do not edit systemd units or run staging/prod saturation without explicit approval, abort thresholds, and rollback.
2. Add a checked-in test-env command or documented `.env.test` recipe for repeatable local suite runs.
3. Add S0-S5 campaign output to CI or a manually triggered workflow once runtime cost and container availability are acceptable.
4. Extend recorded replay to a live Jetstream capture file with explicit event-count, collection mix, cursor provenance, and replay checksum.
5. Add mixed ingestion storm coverage for reposts, replies, deletes, unlikes, duplicate events, and out-of-order delivery.
6. Propose a staging saturation plan with target host/database, traffic ceiling, abort thresholds, rollback path, and explicit confirmation that production is outside blast radius before any shared-environment load.
7. Keep the RecSys demo paper language tied to the confirmed local/synthetic evidence until staging or production receipts exist.
