# PROJ-817 PR224 merge-main validation

Generated: 2026-06-04

## Scope

PR224 was stale against `origin/main` and reported as draft/dirty/conflicting. This receipt covers the review-closeout merge of `origin/main` into `dev/PROJ-817-implement-long-table-reads-across-transparency-admin-and-report`, conflict resolution, and local validation before pushing the refreshed branch.

## Expectations-first QA

- The worktree must be admitted for PROJ-817 review closeout before tracked edits.
- The merge must resolve all conflict markers and keep the upstream PROJ-110/PROJ-914 hardening already present on `origin/main`.
- Runtime must use repo-pinned Node `20.19.0`.
- Root and web dependency installs must complete.
- `npm run verify` must pass locally under unsandboxed execution because Vitest HTTP listener and `tsx` IPC paths are sandbox-sensitive.
- `npm run docs:verify` must pass.
- Root and web `npm audit --omit=dev` must report `0 vulnerabilities`.
- `git diff --check` and `git diff --cached --check` must pass.
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

## Integration evidence

- Runtime: `nvm use` selected `node v20.19.0` and `npm v10.8.2`.
- Root install: `npm install` completed successfully.
- Web install: `cd web && npm install` completed successfully.
- Local verify: `npm run verify` completed successfully under unsandboxed execution with `Test Files 76 passed (76)` and `Tests 541 passed (541)`.
- Docs verify: `npm run docs:verify` completed successfully with `Docs verification passed (13 tracked docs, 23 markdown files scanned)` and `Receipt sanitizer checked 30 receipt files`.
- Root audit: `npm audit --omit=dev` completed successfully with `found 0 vulnerabilities`.
- Web audit: `cd web && npm audit --omit=dev` completed successfully with `found 0 vulnerabilities`.
- Whitespace checks: `git diff --check` and `git diff --cached --check` both completed successfully.

## QA result

Local QA met the pre-push expectations for the merge conflict repair. Remaining verification after push:

- Hosted PR224 checks must run on the new head and have fail count `0`.
- `pr-review-readiness`, CodeRabbit thread/freshness gates, and `closeout-required --strict` must be re-run after hosted checks.
- PR224 should only leave draft once those readiness criteria are satisfied or an explicit receipt-backed blocker is recorded.
