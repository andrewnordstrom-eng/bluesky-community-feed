# PROJ-1795 validation receipt

Date: 2026-07-12 (America/Los_Angeles)
Repository: `andrewnordstrom-eng/bluesky-community-feed`
Pull request: https://github.com/andrewnordstrom-eng/bluesky-community-feed/pull/346
Validated implementation head before this receipt: `aded410bcdb12b0abc65d70aa1631494491def9b`

## Delivered behavior

The desktop demo vote panel is bounded to the available viewport. Its policy
controls scroll independently when all 26 topics are open, while the vote
action remains outside that scrolling area and stays reachable. Tablet and
mobile keep the existing natural document flow.

## Verification

- Focused demo release-blocker suite: 7 tests passed.
- Full deterministic repository verification: 142 files and 1,518 tests passed.
- Root, CLI, SDK, legacy web, and `web-next` builds passed.
- `web-next` lint and TypeScript checks passed.
- Desktop QA at 1440x1100 measured 1,960px of topic content inside a 919px
  scroll viewport; the vote action remained visible with 16px bottom clearance.
- Tablet 756x762 and mobile 390x844 retained natural overflow and had no
  horizontal page overflow.
- Vote submission advanced to the 24-voter simulation step with no browser
  console errors.
- Hosted exact-head CodeRabbit, freshness/thread checks, backend/frontend CI,
  CodeQL, security, secrets, docs, policy, and quality gates passed.

## Safety

This change does not alter demo APIs, governance math, corpora, receipts,
production feed publication, or the separately leased deployment workflow.
No review or merge gate was bypassed.
