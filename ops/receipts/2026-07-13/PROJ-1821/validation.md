# PROJ-1821 validation receipt

Date: 2026-07-13 (America/Los_Angeles)
Repository: `andrewnordstrom-eng/bluesky-community-feed`
Pull request: `#357`

## Delivered behavior

Corgi's public product story now uses one truthful cold-start journey across the
homepage, `/how-it-works`, `/demo`, `/start`, authenticated governance surfaces,
current documentation, and the public API description:

- Corgi Commons is the live Bluesky feed and proof surface.
- Bluesky renders ordered posts; Corgi exposes policy and ranking receipts.
- Five global signal weights are separate from topic preferences, which affect
  relevance, and content rules, which affect eligibility.
- One ballot joins other community ballots. Reviewed results are applied only
  after operator approval and then trigger rescoring.
- The anonymous demo runs isolated shadow governance over a frozen comparison
  corpus and cannot mutate the public feed.
- Public viewing and the shadow demo remain open; production governance is an
  approved waitlist pilot.

Birders-specific teaching content and stale automatic-application claims were
removed from primary public surfaces. Corgi annotations remain outside the
Bluesky-style post chrome.

## Governance and safety

- Approved lifecycle application covers signal weights, topic weights, and
  adopted content rules before rescoring.
- Demo routes remain Redis-isolated, rate-limited, idempotent, and unable to
  write production votes, epochs, audit logs, exports, or feed publication.
- Demo content rules are bounded to exclusion-only mechanics for this release.
- Snapshot capture fails closed: a failed quality gate cannot leave or publish a
  stale approved manifest or review sheet.
- The Corgi Commons record updater preserves the existing DID, rkey, avatar,
  creation timestamp, and uses compare-and-swap publication.

## Deterministic verification

- Full repository verification passed with 1,667 tests.
- Root/backend, SDK, CLI, legacy web, and `web-next` builds passed.
- `web-next` lint and TypeScript checks passed.
- Documentation verification passed.
- GitHub backend, frontend, docs, report-script, quality, security, secret-scan,
  CodeQL, Linear-policy, and review-thread checks passed on the PR head.
- Focused cold-start product-story tests passed 9 of 9 after the final contract
  guard correction.
- The initial CodeRabbit review reported 16 actionable findings. Every finding
  was verified, corrected where valid, tested, replied to, and resolved before
  the final exact-head review request.

## Browser acceptance

The production-shaped local static export was reviewed in the in-app browser:

- Desktop `1440x1100`, tablet `756x762`, and mobile `390x844` showed no
  horizontal overflow on `/` and `/how-it-works`.
- The educational replay changed the ranked order when its policy preset
  changed.
- The mobile menu closed on Escape and returned focus to its trigger.
- The hero, trust line, product stage, and Corgi Commons explanation retained a
  calm visual hierarchy across desktop and mobile.

## Release boundaries

Production deployment, the live Bluesky record update, Corgi Commons snapshot
quality capture, exact-SHA route/API/CSP smoke tests, and the five unbriefed
human comprehension sessions are post-merge evidence. They must be recorded in
Linear and must not be claimed complete before they occur.

If the live snapshot fails its objective quality gates, the release retains the
clearly labeled mechanics fixture. It must not be described as a reviewed live
snapshot.
