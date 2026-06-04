# PROJ-816 PR 225 Branch Update Validation

Date: 2026-06-04

## Scope

PR: https://github.com/andrewnordstrom-eng/bluesky-community-feed/pull/225

Branch: `dev/PROJ-816-implement-record-string-number-weight-contract-in-shared-types-a`

Purpose: merge `origin/main` into PR 225 after `main` advanced to `6ea06f8` (`[PROJ-110] Contain feed secret exposure (#201)`) so the PR is no longer behind base.

No PROJ-816 implementation logic was changed in this closeout pass. The staged merge brings upstream `main` changes into the branch.

## Admission

`launch-readiness` returned `READY` for PROJ-816 review-closeout after the stale PROJ-110 review-closeout lease was closed.

`start-work` returned `ALLOW` and recorded lease `atl-32975949b1b7d55f`.

## Local Validation

Runtime:

- `.nvmrc`: `20.19.0`
- validation PATH pinned to `/Users/andrewnordstrom/.nvm/versions/node/v20.19.0/bin`
- `node -v`: `v20.19.0`

Install:

- root `npm install`: up to date
- `web/` `npm install`: up to date

Sandbox note:

- sandboxed `npm run verify` failed because local Redis/socket access and localhost binding were denied with `EPERM` for `127.0.0.1`, `::1`, and `listen EPERM`.
- rerun outside the sandbox was required for a truthful local-network test result.

Passing gates:

- unsandboxed `npm run verify`: pass
  - TypeScript build: pass
  - Vitest: 75 files / 541 tests passed
  - CLI build: pass
  - `build:mcp-local`: skipped because `src/mcp-local` is absent
  - web lint: pass
  - web build: pass
- `npm run docs:verify`: pass
  - 13 tracked docs
  - 23 markdown files scanned
  - 32 receipt files checked
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

