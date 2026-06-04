# PROJ-818 CodeRabbit Review-Spend Mini Receipt

PR: https://github.com/andrewnordstrom-eng/bluesky-community-feed/pull/226
Linear issue: PROJ-818
Current head at receipt time: `34398ce8ddfb0f8c22bb3cae7ab6ec7d8449f761`
CodeRabbit final state: not final; CodeRabbit status is still a live blocker until the wrapper gates report clean or another documented terminal path is available.
Known warnings: PR #226 has crossed the manual review-trigger stop condition and must not receive raw `@coderabbitai` comments.

## Runtime Health Check

This receipt records the PR #226 review-spend stop condition before any further
CodeRabbit request is attempted.

## Stop Condition

`PR_REVIEW_TRIGGER_CONTRACT.md` requires a mini receipt before more CodeRabbit
triggers when the review-loop budget is exhausted. For PR #226, the
control-plane wrapper returned `readiness_action=write_mini_receipt` at
`2026-06-04T20:01:00Z`.

## CodeRabbit Gate Snapshot

- Hosted PR head at receipt time: `34398ce8ddfb0f8c22bb3cae7ab6ec7d8449f761`.
- Latest known CodeRabbit review SHA: none.
- Review rounds: `0`.
- Manual triggers: `3`.
- Full-review triggers: `0`.
- Incremental-review triggers: `3`.
- Current-head CodeRabbit review state: `missing`.
- Unresolved current-head CodeRabbit threads: `0`.
- Raw GitHub CodeRabbit commit status: `failure`, description `Review rate limit exceeded`, updated at `2026-06-04T19:57:18Z`.
- Current action from `pr-review-readiness`: `write_mini_receipt`.
- Current `coderabbit-truth-gate --mode threads`: passed with `0` live current-head CodeRabbit threads.
- Current `coderabbit-truth-gate --mode freshness`: failed because CodeRabbit status state is `failure`.

## Next Trigger Policy

Another CodeRabbit trigger is justified only if the control-plane wrapper
authorizes it after this receipt and the hosted deterministic checks remain
green.

The only allowed mutating path is:

`python3 .github/ops/flow.py coderabbit-request-review --repo andrewnordstrom-eng/bluesky-community-feed --pr 226 --apply --json`

No raw `@coderabbitai review`, `@coderabbitai full review`, or equivalent
comment mutation is authorized by this receipt.

## Split Decision

The PR is not being split at this step because the final diff against
`origin/main` is a focused SDK/documentation package (`12` files: SDK package,
ADR, repo-contract link, generator guidance, fixture, and package locks).
The hosted deterministic checks pass, and the live blocker is CodeRabbit quota,
not review complexity or unresolved findings. Splitting would not reduce the
vendor rate-limit cause.

## Validation

- `npm install` at repo root completed and reported `found 0 vulnerabilities`.
- `npm install` in `web/` completed and reported `found 0 vulnerabilities`.
- `npm run verify` passed outside the sandbox: TypeScript build passed, Vitest
  reported `76` files and `559` tests passed, CLI build passed,
  `src/mcp-local` build skipped because absent, SDK build passed, web lint
  passed, and web build passed.
- `npm run docs:verify` passed: `13` tracked docs, `24` markdown files scanned,
  and `34` receipt files checked.
- Root `npm audit --omit=dev` reported `found 0 vulnerabilities`.
- Web `npm audit --omit=dev` reported `found 0 vulnerabilities`.
- SDK package `npm audit --audit-level=high` reported `found 0 vulnerabilities`.
- `git diff --check` and `git diff --cached --check` passed before the
  preceding push.
- Hosted checks on head `34398ce8ddfb0f8c22bb3cae7ab6ec7d8449f761` passed for
  backend-verify, frontend-verify, docs-verify, report-scripts-verify,
  security-gate, CodeQL, quality-gate, linear-policy, linear-state-sync,
  internal-tooling-hygiene, dependabot-automerge, aikido-thread-check, and
  coderabbit-thread-check.

## Live Acceptance

This mini receipt is live acceptance only for the review-spend stop condition.
It does not merge the PR, waive CodeRabbit convergence, authorize a raw
CodeRabbit trigger, bypass hosted required checks, or bypass human review
requirements.
