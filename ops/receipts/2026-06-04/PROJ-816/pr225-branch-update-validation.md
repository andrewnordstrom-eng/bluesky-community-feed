# PROJ-816 PR 225 Branch Update Validation

Date: 2026-06-04

## Scope

PR: https://github.com/andrewnordstrom-eng/bluesky-community-feed/pull/225

Branch: `dev/PROJ-816-implement-record-string-number-weight-contract-in-shared-types-a`

Purpose: merge `origin/main` into PR 225 after `main` advanced to `8be4d76` (`[PROJ-817] Implement long-table reads across transparency, admin, and report consumers`) so the PR is no longer merge-conflicting against base.

The staged merge brings upstream `main` changes into the branch and resolves conflicts in:

- `src/governance/routes/vote.ts`
- `src/scoring/pipeline.ts`
- `src/scoring/score.types.ts`
- `tests/votable-params-record-shape.test.ts`

Resolution notes:

- Preserved PROJ-816 runtime/wide-column guards while keeping the PROJ-817 long-table reader changes from `main`.
- Preserved `weightFromRow(...)` null/number coercion in `toGovernanceEpoch`.
- Preserved own-property weight lookup and warning behavior in `scorePost`.
- Combined the vote-route tests with the `postVote(...)` helper so injected Fastify apps close in `finally` while retaining the stronger registry/wide-column drift tests.

## Admission

`launch-readiness` returned `READY` for PROJ-816 review-closeout.

`start-work` returned `ALLOW` and recorded lease `atl-32975949b1b7d55f`, fencing token `12`.

## Local Validation

Runtime:

- `.nvmrc`: `20.19.0`
- validation PATH pinned to `/Users/andrewnordstrom/.nvm/versions/node/v20.19.0/bin`
- `node -v`: `v20.19.0`

Install:

- root `npm install`: changed 1 installed package
- `web/` `npm install`: up to date

Sandbox note:

- sandboxed `npm run verify` failed because local Redis/socket access and localhost binding were denied with `EPERM` for `127.0.0.1`, `::1`, and `listen EPERM`.
- rerun outside the sandbox was required for a truthful local-network test result.

Passing gates:

- unsandboxed `npm run verify`: pass
  - TypeScript build: pass
  - Vitest: 76 files / 559 tests passed
  - CLI build: pass
  - `build:mcp-local`: skipped because `src/mcp-local` is absent
  - web lint: pass
  - web build: pass
- focused PROJ-816 acceptance tests: pass
  - `npm test -- tests/votable-params-record-shape.test.ts tests/governance.types.test.ts tests/governance-admin.test.ts tests/topic-voting.test.ts`
  - 4 files / 40 tests passed
- acceptance grep: pass
  - `rg -n "WEIGHT_ACCESSORS|\.recencyWeight|\.engagementWeight|\.bridgingWeight|\.sourceDiversityWeight|\.relevanceWeight" src/scoring src/governance web/src`
  - 0 matches
- `npm run docs:verify`: pass
  - 13 tracked docs
  - 23 markdown files scanned
  - 34 receipt files checked
- `git diff --check`: pass
- `git diff --cached --check`: pass
- root `npm audit --omit=dev`: found 0 vulnerabilities
- `web/` `npm audit --omit=dev`: found 0 vulnerabilities

## Expected Hosted QA

After committing and pushing this branch update, hosted checks must be re-measured on the new head:

- required check fail count: 0
- CodeRabbit current-head unresolved threads: 0
- CodeRabbit freshness: pass or remain covered by the audited `coderabbit:exempt` path
- `closeout-required bluesky-feed --issue PROJ-816 --repo andrewnordstrom-eng/bluesky-community-feed --pr 225 --strict --json`: pass
