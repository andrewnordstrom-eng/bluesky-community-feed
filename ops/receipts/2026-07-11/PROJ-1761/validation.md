# PROJ-1761 validation receipt

Date: 2026-07-11 (America/Los_Angeles)
Repository: `andrewnordstrom-eng/bluesky-community-feed`
Pull request: https://github.com/andrewnordstrom-eng/bluesky-community-feed/pull/340
Validated implementation head before this receipt: `9ff14a7722c3c1509510f1ddb35aadb2e668a97e`

## Delivered behavior

The CodeRabbit freshness workflow can use a complete exact-head review when the
Actions token cannot observe CodeRabbit's third-party status or check suite. The
fallback requires the CodeRabbit `Bot` actor, a normalized canonical login, the
exact pull-request head commit, and complete review pagination.

Only an exact-head `APPROVED` review passes. `CHANGES_REQUESTED`, `COMMENTED`,
`PENDING`, `DISMISSED`, a stale review, incomplete pagination, or ambiguous
author identity fails closed. The separately required
`coderabbit-thread-check` remains authoritative for unresolved findings.

## Failure coverage

The workflow harness executes the production script and covers:

- bare and suffixed CodeRabbit Bot identities, case normalization, and User
  spoof rejection;
- exact-head and stale-head review commits;
- comment-only, approval, changes-requested, pending, and dismissed states,
  including fail-closed comment-only behavior;
- newest-decisive-review ordering;
- commit-status and GraphQL review pagination;
- nullable review data, a missing pull-request node, incomplete pagination,
  the 100-page safety bound, and GraphQL failure.

## Verification

- Focused workflow harness: 22 tests passed.
- `actionlint .github/workflows/coderabbit-freshness.yml`: passed.
- `npm run build`: passed.
- `npm run docs:verify`: passed.
- Deterministic full suite after integrating current `main`: 138 files and
  1,418 tests passed. HTTP-load tests ran with local loopback enabled.
- Hosted checks for `9ff14a`: backend/frontend/report/docs CI, CodeQL, security,
  quality, secret scan, Linear policy, internal-tooling hygiene, CodeRabbit
  thread check, and Aikido thread check passed. CodeRabbit review and freshness
  remain pending at receipt authoring time; this receipt does not claim the PR
  is merge-ready.
- Unresolved CodeRabbit threads: zero.
- Current-head changes-requested rounds: zero.

## Safety

No CodeRabbit exemption, synthetic status, duplicate raw review request,
ruleset weakening, or break-glass merge was used. The repair changes only the
freshness workflow, its executable regression harness, and this receipt.

Current-head CodeRabbit approval, freshness, closeout, merge, and deployment
remain pending. Merge remains subject to Andrew's separate approval.
