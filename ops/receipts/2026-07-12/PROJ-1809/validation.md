# PROJ-1809 Validation Receipt

Validated at `2026-07-12T23:30:06Z` from base `8728af3ca724e7bf7c8a50b79cb8c6b62e7a45fb`.

## Scope

- Shared desktop panel frame: viewport-bound height with an independently scrolling body.
- Applied to vote, community response, epoch advancement, and receipt inspection.
- Primary actions remain outside the scrolling body.
- Below the `xl` breakpoint, panels return to natural document flow.

## Automated Verification

- Focused demo regression: 14 tests passed.
- `web-next` lint: passed with zero warnings or errors.
- `web-next` TypeScript: passed.
- `web-next` static export build: passed, including `/demo`.
- Root `npm run verify`: passed; 142 backend test files and 1,525 tests passed before the CLI, SDK, legacy web, and `web-next` build gates completed.
- `npm run docs:verify`: passed.

## Browser Verification

The local static export was exercised against the production v4 demo API through the full no-login flow.

At `1440 x 1100`:

- Vote action bottom: `1086px`, within the `1100px` viewport.
- Community action bottom: `406.5px`, within the viewport.
- Epoch body: `1122px` scroll height inside a `931px` client area; `overflow-y: auto`; action bottom `1084px` and visible.
- Receipt body: `1378px` scroll height inside a `489px` client area; `overflow-y: auto`; action bottom `930.2px` and visible.
- Browser console: zero warnings or errors.
- Every independent scroll body is keyboard-focusable, has an accessible region name, and receives a visible focus ring at desktop width.

At `756 x 762` and `390 x 844`:

- Panel `max-height`: none.
- Receipt body `overflow-y`: visible.
- Document scroll width equaled viewport width at both sizes; no horizontal overflow.

## Isolation

- No backend, API, ranking, voting, aggregation, receipt, epoch, or production infrastructure behavior changed.
- No legacy `web/` source file changed.
