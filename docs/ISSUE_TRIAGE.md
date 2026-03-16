# Issue Triage Policy

This policy keeps the backlog useful, newcomer-friendly, and actionable.

## Label Discipline

Every issue should have:
- exactly one type label: `bug` or `enhancement` or `documentation` or `question`
- at most one readiness label: `good first issue` or `help wanted`
- status labels only when needed (for example `duplicate`, `invalid`, `wontfix`)

## `good first issue` Criteria

Only apply `good first issue` when all are true:
- scope is small (roughly 1-3 files or one isolated behavior)
- clear acceptance criteria are written in the issue body
- no production data migration or security-sensitive logic required
- a maintainer can review quickly

## `help wanted` Criteria

Use `help wanted` when:
- the issue is useful but not currently scheduled for core maintainers
- solution space is open and contributor discussion is welcome

## Triage SLA

- New issues labeled within 2 business days
- Reproducible bug issues get either:
  - a milestone/priority assignment, or
  - an explicit defer/close rationale

## Backlog Hygiene

Run a monthly cleanup:
- close stale `question` issues that have no follow-up
- close or merge duplicates
- remove `good first issue` from items that grew in scope
- verify linked docs/code paths still exist
