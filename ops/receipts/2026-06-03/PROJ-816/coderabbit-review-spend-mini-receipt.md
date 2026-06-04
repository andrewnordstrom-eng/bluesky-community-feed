# PROJ-816 CodeRabbit Review-Spend Mini Receipt

PR: https://github.com/andrewnordstrom-eng/bluesky-community-feed/pull/225
Linear issue: PROJ-816
Merge commit: not merged yet; this receipt records the review-spend stop condition after the `origin/main` merge repair.
CodeRabbit final state: not final; CodeRabbit status is still a live blocker until the audited wrapper gates report clean or exemptable.
Known warnings: PR #225 has exceeded the manual review-trigger budget and must not receive raw `@coderabbitai` comments.

## Runtime Health Check

This receipt records the PR #225 review-spend stop condition before any further
CodeRabbit request is attempted.

## Stop Condition

`PR_REVIEW_TRIGGER_CONTRACT.md` requires a mini receipt before more CodeRabbit
triggers when more than two manual review triggers have already been posted.
PR #225 has crossed that threshold.

## CodeRabbit Gate Snapshot

- Current hosted PR head: `478c4418d5b060ff7d753e28a153997a79503f44`.
- Latest known CodeRabbit review SHA: `2ef6c681f969c73ff8ec92996ee85fa6bd5ae257`.
- Review rounds: `8`.
- Manual triggers: `11`.
- Full-review triggers: `9`.
- Incremental-review triggers: `2`.
- Current-head CodeRabbit review state: `missing`.
- Unresolved current-head CodeRabbit threads: `0`.
- Active rate-limit state from the live snapshot: `false`.
- Current action from `pr-review-readiness`: `write_mini_receipt`.
- Current `wait-coderabbit` state: `hard_fail`, with signal message `CodeRabbit status state is failure`.

## Next Trigger Policy

Another CodeRabbit trigger is justified only if the control-plane wrapper
authorizes it after this receipt and the hosted deterministic checks are green.

The only allowed mutating path is:

`python3 .github/ops/flow.py coderabbit-request-review --repo andrewnordstrom-eng/bluesky-community-feed --pr 225 --apply --json`

No raw `@coderabbitai review`, `@coderabbitai full review`, or equivalent
comment mutation is authorized by this receipt.

## Split Decision

The PR is not being split at this step because the merge conflict was isolated
to `web/package.json` and `web/package-lock.json`; the PROJ-816 scoring,
governance, shared-type, and test changes did not conflict with current
`origin/main`. Splitting would not reduce the CodeRabbit review-spend cause.
The safer path is one convergence update plus wrapper-owned review handling.

## Validation

- `npm install` at repo root completed and reported `found 0 vulnerabilities`.
- `npm install` in `web/` completed and reported `found 0 vulnerabilities`.
- Escalated `npm run verify` passed: 75 test files, 535 tests.
- `npm run docs:verify` passed: 13 tracked docs, 23 markdown files scanned, 24 receipt files checked.
- `npm audit --omit=dev` at repo root reported `found 0 vulnerabilities`.
- `npm audit --omit=dev` in `web/` reported `found 0 vulnerabilities`.
- `git diff --check` passed.

## Live Acceptance

This mini receipt is live acceptance only for the review-spend stop condition.
It does not merge the PR, waive CodeRabbit convergence, authorize a raw
CodeRabbit trigger, bypass hosted required checks, or bypass human review
requirements.
