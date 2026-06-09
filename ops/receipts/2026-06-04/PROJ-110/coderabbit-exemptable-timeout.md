---
bypass: true
bypass_reason: "audited CodeRabbit exemptable sticky reviewDecision path, PR #201, zero live current-head CodeRabbit threads"
bypass_actor: "Codex/GPT-5"
---

# PROJ-110 CodeRabbit Exemptable Timeout Receipt

Generated: 2026-06-04T08:34:00Z

Issue: PROJ-110
Project: bluesky-feed
Repository: andrewnordstrom-eng/bluesky-community-feed
PR: https://github.com/andrewnordstrom-eng/bluesky-community-feed/pull/201
Current head before this audit receipt commit: `55e6870a703a97ba731b77f70e3ef2b9c551b62a`
Decision: apply the audited `coderabbit:exempt` path and dismiss stale/off-head CodeRabbit change-request reviews after live current-head thread truth is clear.

## CodeRabbit Gate Snapshot

- `python3 .github/ops/flow.py wait-coderabbit --project bluesky-feed --repo andrewnordstrom-eng/bluesky-community-feed --branch dev/PROJ-110-restore-feed-health --pr 201 --refresh-on-skipped --timeout-seconds 600 --poll-seconds 30 --json`
  returned terminal `state=exemptable`, `retry_count=2`, `threads_open=0`, and
  `next_action=Apply the audited CodeRabbit exempt/dismiss path and record sticky reviewDecision evidence`.
- The same wait result reported the current head SHA as
  `55e6870a703a97ba731b77f70e3ef2b9c551b62a`, the stale review SHA as
  `055afd7eb3feb00d312c25ef410247990b63eb3e`, `review_state=CHANGES_REQUESTED`,
  and `github_review_decision=CHANGES_REQUESTED`.
- `python3 .github/ops/flow.py coderabbit-truth-gate --repo andrewnordstrom-eng/bluesky-community-feed --pr 201 --mode threads --json`
  passed with `0` live current-head CodeRabbit threads, `0` stale residue
  threads, and `1` superseded residue thread.
- `python3 .github/ops/flow.py coderabbit-truth-gate --repo andrewnordstrom-eng/bluesky-community-feed --pr 201 --mode freshness --json`
  failed before this audit path because GitHub's review decision remained sticky
  `CHANGES_REQUESTED` from an off-head CodeRabbit review.
- `gh api repos/andrewnordstrom-eng/bluesky-community-feed/pulls/201/reviews`
  showed two stale CodeRabbit `CHANGES_REQUESTED` reviews:
  `4226653523` on commit `226fad9565d7300ec07fe5cda2c022772b2cd8a6` and
  `4226732072` on commit `055afd7eb3feb00d312c25ef410247990b63eb3e`.

## Why Refresh Attempts Were Insufficient

- The controller used the bounded `wait-coderabbit --refresh-on-skipped` path
  instead of direct ad hoc review comments.
- CodeRabbit did not produce an approving current-head review during the bounded
  wait, and its status reported review activity/rate-limit churn.
- The live current-head thread truth was clear, so the remaining blocker was a
  stale GitHub review decision rather than an unresolved current-head finding.
- The exemption is narrow: it covers only CodeRabbit freshness convergence for
  PR #201 while the audit block and label are present and not expired.

## Deterministic Eval

- `npm test -- tests/backfill-score-components-cli.test.ts tests/backfill-governance-weights-cli.test.ts --run --reporter=verbose` under Node `v20.19.0` with fake test env and unsandboxed local IPC passed: `2` files and `21` tests passed.
- `npm run verify` under Node `v20.19.0` with fake test env and unsandboxed local IPC passed: TypeScript build passed, Vitest reported `74` files and `521` tests passed, CLI build passed, `src/mcp-local` build skipped because absent, web lint passed, and web build passed.
- `npm run docs:verify` passed before this receipt: `13` tracked docs and `23` markdown files scanned; receipt sanitizer checked `29` receipt files.
- `git diff --check` and `git diff --cached --check` passed.
- Root `npm audit --omit=dev` passed with `found 0 vulnerabilities`.
- Web `npm audit --omit=dev` passed with `found 0 vulnerabilities`.
- The pre-commit hook ran `tsc --noEmit` over staged TypeScript/TSX files and passed before commit `55e6870a703a97ba731b77f70e3ef2b9c551b62a`.

## Hosted PR Gates

- On current head `55e6870a703a97ba731b77f70e3ef2b9c551b62a`, the following hosted checks were passing before this audit path: CodeQL, dependabot automerge, security-gate, linear-state-sync, aikido-thread-check, internal-tooling-hygiene, linear-policy, quality-gate, docs-verify, backend-verify, frontend-verify, and report-scripts-verify.
- Hosted CodeRabbit freshness and thread workflow checks were failing only because the PR lacked a valid audit block plus `coderabbit:exempt` label while the vendor review state remained sticky/off-head.

## Live Acceptance

- This receipt justifies `coderabbit:exempt` for `bluesky-community-feed#201` under the documented exemptable timeout path.
- This receipt also justifies dismissing stale CodeRabbit `CHANGES_REQUESTED` reviews `4226653523` and `4226732072` only after verifying zero live current-head CodeRabbit threads.
- This receipt does not waive local tests, hosted CI, Linear closeout, current-head thread truth, or future CodeRabbit findings.
- Remove `coderabbit:exempt` after merge, after CodeRabbit approves a later current head, or if a new live current-head CodeRabbit finding appears.
