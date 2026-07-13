---
bypass: true
bypass_reason: "audited CodeRabbit exemptable timeout, PR #355, zero unresolved CodeRabbit threads"
auditor: "Codex/GPT-5"
---

# PROJ-1818 CodeRabbit Exemptable Timeout Receipt

Linear issue: PROJ-1818
PR: https://github.com/andrewnordstrom-eng/bluesky-community-feed/pull/355
Decision: apply the audited `coderabbit:exempt` path.

## CodeRabbit Gate Snapshot

- Reviewed code head at timeout: `38a8e88f679e578bf5230aac4e25fa5e36882f6a`.
- Latest completed CodeRabbit review SHA: `3f237687bc5b3c6ea625153ee317532017fa3ef1`.
- That completed review's seven actionable findings were addressed in the reviewed code head.
- The sanctioned wrapper requested a fresh full review at 2026-07-13 11:43 UTC.
- CodeRabbit remained `Review in progress` without producing a current-head review object.
- Unresolved live CodeRabbit threads at both bounded timeouts: `0`.
- A 900-second bounded wait returned `state: exemptable`, followed by a final 300-second grace wait that returned the same state with zero live threads.

## Deterministic Verification

- Focused governance lifecycle suite: 5 files and 47 tests passed.
- Full backend suite: 148 files and 1,618 tests passed.
- `npm run verify` passed, including root, CLI, SDK, legacy web, and `web-next` builds.
- `npm run docs:verify` passed: 14 tracked docs and 37 Markdown files scanned.
- `web-next` lint, TypeScript `--noEmit`, and production build passed.
- Current-head GitHub checks passed for backend, frontend, docs, reports, CodeQL, Aikido, secrets, security, Linear policy, and quality gates.
- `web-next` has no package-level `test` script; the root Vitest run is the canonical test gate.

## Why The Prior Review Is Obsolete

- The prior review covered `3f237687bc5b3c6ea625153ee317532017fa3ef1`.
- The reviewed code head adds strict persisted-topic parsing, a transactional generation-based rescore outbox, retry-safe cache invalidation, generation-safe completion, and the requested regression coverage.
- No implementation files change in this receipt-only commit.

## Scope Of The Exemption

- The exemption applies only to CodeRabbit's failure to publish a current-head review object within the bounded wait.
- It does not waive deterministic tests, security checks, Linear closeout, branch protection, migration verification, deployment, or production smoke tests.
- Remove or invalidate this exemption if implementation code changes after the reviewed code head.
