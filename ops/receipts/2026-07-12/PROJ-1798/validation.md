# PROJ-1798 validation receipt

Date: 2026-07-12 (America/Los_Angeles)
Repository: `andrewnordstrom-eng/bluesky-community-feed`

## Delivered behavior

The demo now uses one accessible Radix slider system for signal and topic
policy controls. Topic edits immediately show their value and delta from the
selected preset, mark the policy as custom, and submit the complete 26-topic
vector expected by the shadow-governance API. Returning every value to its
preset restores the preset state.

The Topics tab is a single readable list inside the existing independently
scrolling vote panel. Mobile controls use a full-width slider row, while tablet
and desktop retain aligned labels, tracks, and values. The vote action remains
outside the scrolling region.

## Runtime Health Check

- Local static-export proxy used the production `/api/demo/v4/*` endpoints.
- An edited topic ballot was accepted and advanced to `Simulate 24 voters`.
- Browser console remained free of warnings, hydration failures, CSP failures,
  and raw endpoint errors during keyboard, pointer, reset, and submit checks.

## Deterministic Eval

- Focused frontend release-blocker suite: 13 tests passed.
- Full repository verification: 142 test files and 1,524 tests passed.
- Root, CLI, SDK, legacy web, and `web-next` builds passed.
- `web-next` lint and TypeScript checks passed.
- Documentation verification passed: 14 tracked docs and 37 Markdown files.
- Contract tests prove ballots contain exactly the 26 catalog topics, preserve
  edited values, normalize the five signal weights, and fail closed for missing
  topics or out-of-range signal values.
- Review follow-up locks the edit-threshold boundary, reset behavior, raw signal
  readout semantics, shared ballot validity, friendly submission failure, and
  multi-thumb Slider rendering.
- Ballot validation lives in a React-free policy module so the root backend CI
  lane can verify the shared contract without installing frontend packages.

The first sandboxed full-suite run could not bind the repository load-test HTTP
server to `127.0.0.1`. The exact command passed when rerun with local-network
permission; no product code changed between those runs.

## Live Acceptance

- Keyboard topic edit: 1.00 to 0.99 with accessible value text `99%, -1 pp`.
- Pointer topic edit: 1.00 to 0.50 with accessible value text `50%, -50 pp`.
- Reset restored 1.00, `Preset policy`, and `Preset unchanged`.
- Mobile 390x844: 300px topic slider track and no horizontal overflow.
- Tablet 756x762: 444px topic slider track and no horizontal overflow.
- Desktop 1440x1100: bounded independent policy scrolling, reachable vote CTA,
  and no horizontal overflow.
- Signals and Topics now share track, thumb, focus, spacing, value, and changed
  state behavior while retaining signal-specific accent colors.

## Safety

This change is frontend-only. It does not alter demo APIs, governance math,
corpora, receipts, production feed publication, or backend/deployment paths.
The strict submission helper rejects malformed ballots before calling the API.
