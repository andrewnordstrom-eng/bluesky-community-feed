# RecSys Validation Evidence

Status: local quantitative validation, not production-scale proof.
Canonical lab journal: `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`
Issue: PROJ-1551

This file is a summary index for RecSys/demo planning. It is not the canonical
lab record; detailed methods, receipts, quantitative results, interpretations,
and blocked claims live in the lab journal above.

## Current Evidence

- Full local verification gate: `npm run verify` passed on current `origin/main` base after refreshing `web` and `web-next` lockfile installs; this included root TypeScript build, 97 files / 840 Vitest tests, CLI build, MCP-local skip check, SDK build, SDK fixture, Vite lint/build, and Next static build.
- Default regression suite: 97 files / 840 tests passed on current `origin/main` base with non-production dummy config and local IPC/loopback access.
- Post-review closeout slice: 7 files / 88 tests passed after fixing the valid CodeRabbit major/minor findings for manifest claim semantics, background tracking DB-pool headroom, vote-load DB-pool sizing, `FEED_MAX_POSTS` bounds, subscriber digest config, by-ID snapshot cache eviction, soft-deleted engagement subjects, and stress snapshot cleanup.
- Focused hardening sweep: 7 files / 83 tests passed, plus follow-up feed-tracking, CLI/load-accounting, queue/redaction, and critical/provenance slices with 2 files / 24 tests, 5 files / 65 tests, 4 files / 35 tests, and 3 files / 39 tests passed.
- Receipt-integrity hardening slice: 6 files / 71 tests passed after fixing abort-aware timeout classification, monotonic Jetstream cursor persistence, replay expected-delta validation, manifest schema validation, lab guard ordering, cleanup failure propagation, and bounded memory CLI arguments.
- Governance simulation harness: 17 files / 178 tests passed against real migrations, ephemeral Postgres, and ephemeral Redis.
- Simulation preflight: Docker 29.4.3, Testcontainers Postgres/Redis, migrations 001-022, harness files, and sim scripts verified. One current-head attempt timed out waiting for Testcontainers port binding after 10s, then the immediate retry passed all 4 checks with migrations applied in 1.667s.
- Executable simulated epoch campaign:
  - S2: 500 users / 2,000 posts, 3 seeds, 400 votes per run, 2,000 score rows per run, 1,000 Redis feed rows per run.
  - S3: 2,000 users / 5,000 posts, 3 seeds, 1,600 votes per run, 5,000 score rows per run, 1,000 Redis feed rows per run.
  - S4: 5,000 users / 20,000 posts, 2 seeds, 4,000 votes per run, 10,000 score rows per run, 1,000 Redis feed rows per run.
  - S5: 10,000 users / 50,000 posts, 2 seeds, 8,000 votes per run, 10,000 score rows per run, 1,000 Redis feed rows per run.
- Feed-skeleton stress: 20,000 mixed local requests, 100 connections, 0 errors, 0 timeouts, p95 26.22 ms with normal request logging.
- Concurrent-write stress: 50 parallel like events, exact `like_count=50`, `likesTotal=50`, `likesDistinct=50`, `engagedTotal=50`, `duplicateLikeUris=0`.
- Lab artifact protocol: `artifacts/lab/README.md` and `artifacts/lab/manifest.schema.json` define durable manifests, checksums, thresholds, and claim receipts.
- Implemented follow-up runners:
  - `npm run lab:jetstream-replay -- --ephemeral --events 1200`
  - `npm run lab:vote-load -- --ephemeral --valid-requests 8000 --users 500 --connections 100`
  - `npm run lab:memory-isolated -- --ephemeral --runs 5 --amount 10000 --connections 100`
  - `npm run lab:memory-prod-parity -- --ephemeral --runs 5 --amount 10000 --connections 100`
- Small end-to-end ephemeral smoke receipts:
  - Jetstream replay smoke: 19 events, 577.92 events/sec, handler p95 2.48 ms, 0 drops, 0 handler errors, 0 state mismatches; manifest `artifacts/lab/PROJ-1551/2026-07-05T13-14-44-020Z/manifest.json`.
  - HTTP voting smoke: 40/40 valid POSTs returned 200, p95 20.37 ms, vote rows/audit rows/long-table rows reconciled exactly, rate-limit phase 20 accepted + 5 `429`; manifest `artifacts/lab/PROJ-1551/2026-07-05T13-15-17-377Z/manifest.json`.
  - Process-isolated memory smoke: 1 run per mode, 100 requests per mode, normal/no-op p95 3.24 ms / 3.37 ms, after-GC RSS deltas 15.52 MB / 17.22 MB; manifest `artifacts/lab/PROJ-1551/2026-07-05T13-24-17-206Z/manifest.json`.
- Full lab gate receipts:
  - Recorded Jetstream replay: 1,200 synthetic recorded events, 3,105.67 events/sec, handler p95 0.76 ms, p99 1.02 ms, 569 durable state mutations, 1,472.61 durable mutations/sec, 0 queue drops, 0 handler errors, 0 state mismatches, 0 outcome mismatches, 253 duplicate no-ops, 126 untracked ignores, cursor lag 793 microseconds; manifest `artifacts/lab/PROJ-1551/2026-07-06T19-37-49-725Z/manifest.json`.
  - Real HTTP voting load: 8,000/8,000 valid vote POSTs returned `200`, 500 users, 100 connections, errors 0, timeouts 0, unexpected statuses 0, p95 48.18 ms, p99 101.06 ms, max 319.53 ms, exact wide-vote/audit/long-table reconciliation, rate-limit phase 20 accepted + 5 `429`, exact post-rate-limit aggregate rows 501 / 8,020 / 2,505, cleanup failures 0; manifest `artifacts/lab/PROJ-1551/2026-07-06T19-38-04-859Z/manifest.json`.
  - One post-review 100-connection vote-load attempt failed before the current pass: `artifacts/lab/PROJ-1551/2026-07-06T17-44-14-781Z/manifest.json` recorded 7,903/8,000 valid `200` responses, 97 timeouts, 7,960/8,000 expected audit rows, and PostgreSQL pool connection timeouts. A 50-connection discriminator passed, and the repeated 100-connection gate above passed; staging follow-up should instrument DB pool utilization and repeatability instead of treating one local pass as production saturation proof.
  - Process-isolated memory gate: initial 5-run gate failed RSS ceilings in `artifacts/lab/PROJ-1551/2026-07-05T13-24-30-526Z/manifest.json`; a no-old-space tsx rerun still failed in `artifacts/lab/PROJ-1551/2026-07-05T17-38-00-846Z/manifest.json`; after cursor snapshot-by-ID caching, a 1,000-request warmup baseline, and lab child runtime `--max-old-space-size=896 --max-semi-space-size=16`, the fixed 5-run gate passed with normal median/p95 after-GC RSS deltas 44.75 MB / 50.27 MB, no-op 42.94 MB / 51.09 MB, max peak RSS 251.34 MB / 234.20 MB, tracker drops 0, remaining connections 0; manifest `artifacts/lab/PROJ-1551/2026-07-06T19-38-23-532Z/manifest.json`.
  - Compiled prod-parity memory gate: 5 runs per mode passed with `node --expose-gc --max-old-space-size=896 --max-semi-space-size=16`, compiled `dist-lab` child code, and a 1,000-request warmup baseline; normal median/p95 after-GC RSS deltas 36.43 MB / 39.49 MB, no-op 30.14 MB / 40.10 MB, max peak RSS 215.92 MB / 215.70 MB, tracker drops 0, remaining connections 0; manifest `artifacts/lab/PROJ-1551/2026-07-06T19-42-01-707Z/manifest.json`.
  - Compiled heap-snapshot memory receipt: one-run diagnostic passed with before/after V8 heap snapshots, normal/no-op after-GC RSS deltas 2.91 MB / 3.45 MB, heap-used deltas -0.83 MB / -0.76 MB, external memory 3.98 MB -> 3.98 MB for normal and 3.96 MB -> 3.97 MB for no-op; manifest `artifacts/lab/PROJ-1551/2026-07-05T17-42-12-174Z/manifest.json`.
- Read-only production corpus snapshot, collected 2026-07-05 around 19:15 UTC:
  - Production checkout `/opt/bluesky-feed` was at commit `f2310a0`; service `bluesky-feed` was active with `NRestarts=0`.
  - Observed config: Jetstream subscribed to posts, likes, reposts, and follows; `SCORING_WINDOW_HOURS=72`; `SCORING_CANDIDATE_LIMIT=2500`; `FEED_MAX_POSTS=1000`; `FEED_MIN_RELEVANCE=0.25`; `INGESTION_GATE_ENABLED=true`; `TOPIC_EMBEDDING_ENABLED=false`.
  - `pg_stat_user_tables` estimates: `posts` 6,185,961; `likes` 45,822,835; `reposts` 8,228,498; `follows` 12,569,801; `post_scores` 6,176,236; `post_score_components` 30,900,088.
  - Recent exact post windows: 2,550 indexed in 15 minutes; 9,715 in 1 hour; approximately 314K in 24 hours; 530,683 active lower-bound 72-hour candidate-window posts.
  - Public stats endpoint: epoch 2 active, 3,323 scored posts, 2,950 authors, 0 votes.
  - Redis serving state: `feed:count=1000`, `ZCARD feed:current=1000`, `feed:epoch=2`.
  - Caveat: this is corpus/scoring/serving evidence, not proof of live firehose completeness, gate-by-gate rejection rates, event loss, or production saturation limits.
- Dry-run verification passed for all four lab runners; dry-runs prove CLI/artifact wiring only.

## Provenance

- Branch: `dev/PROJ-1551-corgi-validation`.
- Checkout base: `f2310a036cb668a9e7419ee8419a2cbe44dc9920` plus the uncommitted PROJ-1551 validation diff.
- Runtime: Node `v24.15.0`, npm `11.12.1`, Docker server `29.4.3`.
- Full verify command: `npm run verify` with the same dummy, non-production env shape used by `tests/harness/setup-env.ts` plus local IPC/loopback access.
- Default suite command: `npm test -- --run` with the same dummy, non-production env shape used by `tests/harness/setup-env.ts`.
- Harness command: `npm run sim:core`.
- Preflight command: `npm --silent run sim:preflight` for JSON-only stdout; migration progress is emitted on stderr.
- Campaign manifest command: `npm run sim:campaign -- --dry-run --max-stage S1`.
- Final S0 campaign command: `npm run sim:campaign -- --ephemeral --stage S0 --artifacts-dir /private/tmp/corgi-sim-campaign-s0-current-head`.
- S2-S5 campaign command shape: `npm run sim:campaign -- --ephemeral --stage S2 --artifacts-dir /private/tmp/corgi-sim-campaign-s2-counts` with the stage/artifact suffix changed to `S3`, `S4`, and `S5` for those receipts.
- Final S0 package-script artifact was a scratch-only local receipt: `/private/tmp/corgi-sim-campaign-s0-current-head/campaign-summary.json`; it passed with 30 users, 50 posts, 24 votes, 13 score rows, and 12 Redis feed rows.
- S2-S5 campaign artifact roots were scratch-only local receipts: `/private/tmp/corgi-sim-campaign-s2-counts`, `/private/tmp/corgi-sim-campaign-s3-counts`, `/private/tmp/corgi-sim-campaign-s4-counts`, and `/private/tmp/corgi-sim-campaign-s5-counts`.
- Durable manifest-backed receipts currently exist for the Jetstream replay, HTTP vote load, and memory lab gates under `artifacts/lab/PROJ-1551/<run-id>/`; rerunning S0-S5 into that protocol remains follow-up work.
- Detailed command receipts and metric interpretation are in the lab journal linked above.

## Safe Claims

- The local governance/voting harness exercises real aggregation, epoch transition, scoring, and storage paths.
- The local simulated epoch campaign can execute through a 10,000-user / 50,000-post synthetic target ceiling in throwaway Postgres/Redis.
- The local feed-skeleton stress scenario is below the 100 ms p95 target.
- The local concurrent-like write path did not duplicate or undercount the measured 50-write case.
- The repo now has guarded local lab commands for Jetstream replay, real HTTP voting load, and process-isolated memory measurement.
- The local recorded Jetstream replay gate passed for its fixture mix at 1,200 events, 3,105.67 events/sec, handler p95 0.76 ms, and 0 queue drops / handler errors / state mismatches / outcome mismatches.
- The local real-route HTTP voting load gate passed for 8,000 requests, 500 users, and 100 connections on the current canonical run with p95 48.18 ms and exact reconciliation, with one earlier failed 100-connection attempt retained as a repeatability warning.
- The local process-isolated feed memory gate passed for 5 runs per mode at 10,000 requests and 100 connections under the recorded lab child runtime with explicit 896 MB old-space, 16 MB semi-space, and a 1,000-request warmup baseline.
- The local compiled prod-parity memory gate passed for 5 runs per mode at 10,000 requests and 100 connections under the proposed 896 MB old-space, 16 MB semi-space, compiled child runtime, and the same warmup-baseline methodology.
- Feed request tracking now has local regression coverage proving stalled tracking Redis reads honor the tracker timeout, release the slot, and do not continue to write tracking rows after abort.
- Feed request tracking queue saturation now emits a rate-limited operator warning and has local regression coverage for drop accounting plus concurrent drain waiters.
- Private feed requests now reuse the already verified/approved DID for background tracking instead of verifying the same JWT twice.
- Subscriber upsert failure logging now has local regression coverage for string, null, and non-string-property rejection values without raw DID leakage.
- The standalone load-test CLI now has local regression coverage proving it prints a result and terminates promptly against a local HTTP server.
- Jetstream cursor persistence now has local regression coverage for duplicate in-flight events with the same `time_us`; the persisted cursor remains pinned behind the still-active duplicate until every event at that timestamp clears.
- Lab artifact provenance now includes untracked-file contents in `diffSha256`, rejects symlinks escaping the run root, and creates checksum directories deterministically before writing.
- An approval-gated staging/runtime plan is now recorded in the canonical lab journal. It proposes verifying the lab-proven runtime `NODE_OPTIONS=--max-old-space-size=896 --max-semi-space-size=16` on an approved isolated target before any DB saturation or external voting load.
- The 2026-07-05 read-only production corpus snapshot supports careful website/demo-paper wording that production had indexed approximately 6.19M posts, 45.8M likes, 8.23M reposts, and 12.57M follows, with roughly 314K posts indexed in the prior 24 hours, before scoring a bounded recent candidate set and serving a top-1,000 feed snapshot.

## Not Yet Proven

- Live Jetstream socket replay, reconnect churn, recovery from a real cursor, and production DB write saturation.
- Gate-by-gate production rejection rates, raw live Jetstream event receive rate, and loss/drop rates. The production snapshot measures stored rows and current scoring/serving state, not the raw firehose denominator.
- Production DB write saturation, DB pool headroom, and scoring-delay behavior under shared/staging/production load.
- Jetstream replay at the S0-S5 campaign sizes; the current campaign directly seeds the harness corpus and votes.
- Browser/proxy/CDN behavior for HTTP voting under external traffic.
- Production/staging process memory under the deployed runtime. The local lab and compiled prod-parity children are validated with `--max-old-space-size=896 --max-semi-space-size=16`, but the production systemd runtime was not changed under PROJ-1551.
- Checked-in golden snapshots for campaign outputs; the current evidence is command-output and artifact based.
- Route-level keyword-only vote behavior under concurrent HTTP load; the harness covers keyword-only vote exclusion in aggregation, not the live route under load.

## Next Evidence To Produce

1. Get explicit approval for the lab-journal `[PLAN DRAFT]` target, operator, time window, rollback command, artifact destination, and no-production-blast-radius boundary; then execute Phase 0 read-only baseline only.
2. Reproducible local test-env wrapper for clean-worktree test runs.
3. Optional CI/manual workflow for S0-S3 campaign gates and S4-S5 capacity runs.
4. Live Jetstream capture/replay receipt with event-count, collection-mix, cursor, and checksum provenance.
5. Staging saturation execution only after the approved runtime plan's memory/feed, Jetstream/scoring, repeated voting-load, DB-pool-utilization, and external voting phases pass on an isolated target.
