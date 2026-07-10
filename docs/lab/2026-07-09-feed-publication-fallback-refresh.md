# 2026-07-09 Feed Publication Fallback Refresh

## Scope

PROJ-1467 prevents a zero-row scoring run from erasing the feed served to reviewers. This refresh ports the original uncommitted reliability work onto current `origin/main`, including the shared snapshot cache added after the first implementation.

The claim is narrow: deterministic local tests validate publication and fallback semantics. Redis-down behavior, root-cause diagnosis for zero-row scoring, deployment, and live traffic remain separate work.

## Current Architecture

Non-empty scoring results are written to two run-scoped staging sorted sets plus seven run-scoped metadata keys. A preflighted Lua script atomically renames and persists all nine staged keys as:

- `feed:current`
- `feed:last_known_good`
- `feed:epoch`
- `feed:run_id`
- `feed:updated_at`
- `feed:count`
- `feed:last_known_good_epoch`
- `feed:last_known_good_run_id`
- `feed:last_known_good_count`

The script verifies every source key exists before its first mutation. Redis executes the staged promotions without interleaving commands from other clients. After preflight, it renames each staged source over its destination and then runs `PERSIST` on that destination. Snapshot readers maintain consistency through generation checks and retry behavior; callers that read separate feed and metadata keys across the publication boundary must not assume a multi-read transaction. Staging keys expire after twice the configured scoring timeout so an interrupted run cannot leave permanent debris.

A zero-row result does not publish, delete, or invalidate the current snapshot. It attempts these best-effort telemetry writes:

- `feed:empty_result_skipped_total`
- `feed:last_empty_result_at`

Both telemetry writes are attempted independently. Failures are logged, neither write delays the scoring run, and neither can suppress feed preservation or turn the skipped result into a publication.

First-page feed requests continue through the shared snapshot cache. Snapshot creation reads `feed:current` first and reads `feed:last_known_good` only when current is empty. Concurrent callers share one in-flight load. After a fallback snapshot is successfully published, the cache asynchronously attempts to increment `feed:last_known_good_fallback_total`; metric-write failures are logged and do not affect the served fallback snapshot. A compare-and-set retry does not overcount.

## Regression Matrix

The focused suite covers:

1. No candidates and all-filtered candidates preserve the served feed.
2. Relevance-floor zero-row results preserve the served feed.
3. Empty-result telemetry is attempted without publishing; telemetry failure still preserves the feed.
4. Non-empty results stage current and last-known-good sets with batched `ZADD` commands.
5. Staging TTL and all current/last-known-good metadata are emitted.
6. Staging aborts, staging command errors, rejected publish scripts, and unexpected publish results surface and trigger staged-key cleanup.
7. Snapshot creation falls back only when current is empty.
8. Both-empty state returns no snapshot.
9. Fallback metric latency or failure does not suppress fallback content.
10. Concurrent callers share one fallback publication and one metric increment.
11. Redis read failures are side-effect free and a later request can retry successfully.
12. Bounded feed reads, generation-conflict retries, and skip-safe epoch metrics are covered.
13. Existing incremental, deduplication, long-table, embedding, and rescore behavior remains covered.

## Local Receipts

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts` | 531 packages installed; 0 vulnerabilities |
| `npm run build` | Pass |
| Focused Vitest slice | 8 files, 92 tests passed |
| Exact Lua script against local Redis | 9 keys promoted atomically; missing-source preflight rejected without mutating published state |
| Full `npm run verify` with deterministic example env and `NODE_ENV=production` | 109 test files, 1,025 tests, CLI/SDK/legacy web/Next export passed |
| CodeRabbit local pass 1 | 2 major, 4 minor, 2 trivial findings; all addressed |
| CodeRabbit local pass 2 | 0 major, 1 minor, 3 trivial findings; all addressed |
| CodeRabbit local pass 3 | 0 major, 0 minor, 4 trivial test-polish findings; all addressed |
| CodeRabbit hosted pass 1 on PR #329 | 0 major, 2 minor, 4 trivial findings; all addressed in the review follow-up |
| CodeRabbit local follow-up pass | 0 major, 1 minor, 2 trivial findings; all addressed before push |
| CodeRabbit hosted current-head pass on PR #329 | 7 actionable findings; all addressed with narrower claims and stronger exact-contract regressions |
| `git diff --check` | Pass |

The hosted CodeRabbit request was posted through the repository wrapper for PR #329. No raw GitHub review trigger was used.

## Production Gate

After merge and approved deployment, allow a normal non-empty scoring cycle to populate `feed:last_known_good`; never induce a zero-row production run. Verify both sorted sets, metadata counts, the feed skeleton result, and unchanged health endpoints. This document does not claim that deployment has happened.
