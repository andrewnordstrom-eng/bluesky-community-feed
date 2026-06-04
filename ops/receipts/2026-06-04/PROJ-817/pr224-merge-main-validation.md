# PROJ-817 PR224 merge-main validation

Generated: 2026-06-04

## Scope

PR224 was stale against `origin/main` and reported as draft/dirty/conflicting. This receipt covers the review-closeout merge of `origin/main` into `dev/PROJ-817-implement-long-table-reads-across-transparency-admin-and-report`, conflict resolution, CodeRabbit review fixes on the refreshed branch, dependency audit repair, and local validation before pushing the refreshed branch.

## Expectations-first QA

- The worktree must be admitted for PROJ-817 review closeout before tracked edits.
- The merge must resolve all conflict markers and keep the upstream PROJ-110/PROJ-914 hardening already present on `origin/main`.
- Runtime must use repo-pinned Node `20.19.0`.
- Root and web dependency installs must complete.
- `npm run verify` must pass locally under unsandboxed execution because Vitest HTTP listener and `tsx` IPC paths are sandbox-sensitive.
- `npm run docs:verify` must pass.
- Root and web `npm audit --omit=dev` must report `0 vulnerabilities`.
- `git diff --check` and `git diff --cached --check` must pass.
- CodeRabbit actionable findings on the refreshed branch must be fixed with direct code/test evidence before requesting another review.
- PR224 must stay draft until the branch is pushed, hosted checks run, and review readiness criteria are re-evaluated.

## Builder evidence

- Admission: `launch-readiness --issue PROJ-817 --project bluesky-feed --mode execute --lane review-closeout ... --json` returned `verdict=READY` with no blockers.
- Lease: `start-work --issue PROJ-817 --project bluesky-feed --tool codex-desktop --mode execute --lane review-closeout ... --json` returned `verdict=ALLOW`, lease `atl-086bc772ad06f519`, fencing token `11`.
- Merge command: `git fetch origin main`, then `git merge origin/main`.
- Conflicts resolved:
  - `scripts/backfill-governance-weights.ts`
  - `scripts/backfill-score-components.ts`
  - `src/config.ts`
  - `src/governance/weight-longtable.ts`
  - `tests/governance-longtable-dualwrite.test.ts`
- Conflict marker check: `rg "<<<<<<<|=======|>>>>>>>" scripts/backfill-governance-weights.ts scripts/backfill-score-components.ts src/config.ts src/governance/weight-longtable.ts tests/governance-longtable-dualwrite.test.ts` returned no matches.
- CodeRabbit closeout fixes:
  - Python report flags now honor the post-flip long-table defaults when env vars are unset.
  - `readEpochWeights` long path now reads epoch existence and component weights through one `LEFT JOIN`.
  - Long-table score component reads now apply the same `runId` filter as the header query.
  - Admin audit analysis now fails closed when current epoch weights are incomplete.
  - Transparency routes now avoid invalid weight `NaN` propagation and invalid timestamp serialization.
  - Post explanation schema now preserves typed `topicBreakdown` response data.
  - Tests now cover DB rejection parity, run-scoped component reads, no-run-id behavior, invalid timestamps, invalid vote payloads, route app closeout, and updated single-query governance weight mocks.
- Dependency audit repair: root `hono` override moved from `4.12.18` to `4.12.23` after `npm audit --omit=dev` reported the current `hono <=4.12.20` moderate advisory.

## Integration evidence

- Runtime: `nvm use` selected `node v20.19.0` and `npm v10.8.2`.
- Root install: `npm install` completed successfully.
- Web install: `cd web && npm install` completed successfully.
- Focused review tests: `npm test -- tests/score-reader-parity.test.ts tests/transparency-run-scope.test.ts tests/votable-params-record-shape.test.ts tests/audit-analysis.test.ts` completed successfully with `Test Files 4 passed (4)` and `Tests 35 passed (35)`.
- Admin status regression check: `npm test -- tests/admin-status.test.ts` completed successfully with `Test Files 1 passed (1)` and `Tests 1 passed (1)`.
- Local verify: `npm run verify` completed successfully under unsandboxed execution with `Test Files 76 passed (76)` and `Tests 551 passed (551)`.
- Docs verify: `npm run docs:verify` completed successfully with `Docs verification passed (13 tracked docs, 23 markdown files scanned)` and `Receipt sanitizer checked 31 receipt files`.
- Root audit: `npm audit --omit=dev` completed successfully with `found 0 vulnerabilities`.
- Web audit: `cd web && npm audit --omit=dev` completed successfully with `found 0 vulnerabilities`.
- Dependency proof: `npm ls hono --all` resolved the MCP SDK Hono tree to `hono@4.12.23`.
- Whitespace checks: `git diff --check` and `git diff --cached --check` both completed successfully.

## QA result

Local QA met the pre-push expectations for the merge conflict repair and CodeRabbit closeout fixes. Remaining verification after push:

- Hosted PR224 checks must run on the new head and have fail count `0`.
- `pr-review-readiness`, CodeRabbit thread/freshness gates, and `closeout-required --strict` must be re-run after hosted checks.
- PR224 should only leave draft once those readiness criteria are satisfied or an explicit receipt-backed blocker is recorded.
