# Corgi Shadow Demo Governance Contract

Version: `2026-07-10.shadow-demo.v2`

This contract powers the public `/demo` walkthrough without mutating production governance.

## Scope

- `open_science_builders` is the only live shadow community in v2. Its candidate pool uses the existing `science-research`, `data-science`, `software-development`, and `open-source` topic vectors.
- `birders_who_code` remains a preview/future secondary community. It is not the primary reviewer corpus and is not published as a Bluesky feed.
- Other demo community IDs may be returned as degraded concepts, not live feeds.
- Demo sessions source one corpus from live production `posts`, active `post_scores`, current epoch weights, and Bluesky AppView hydration, then freeze that comparison set at session creation. Reviewer votes change ranking math, not the compared post set.
- UI copy should use this provenance line: "Live-scored snapshot, frozen for this demo run so rank movement is attributable to policy changes."
- Demo state is Redis-only under `demo:session:*`, `demo:corpus:*`, `demo:corpus:current:*`, `demo:idempotency:*`, and `demo:lock:*`.
- Guided UI should default to 5 guided shadow epochs. Advanced/free-play sessions are capped at 10 shadow epochs, including the baseline epoch.
- Shared current corpus snapshots are short-lived warming caches. Each session still receives a cloned frozen corpus.
- A "refresh live snapshot" action should create a new session, optionally bypassing the short shared-corpus cache. It must never mutate an existing session's frozen corpus.

## Endpoints

- `POST /api/demo/sessions`
- `GET /api/demo/sessions/:sessionId`
- `POST /api/demo/sessions/:sessionId/votes`
- `POST /api/demo/sessions/:sessionId/agents/run` (compatibility path; runs deterministic synthetic community voters, not LLM agents)
- `POST /api/demo/sessions/:sessionId/epochs/advance`
- `GET /api/demo/sessions/:sessionId/feed?epochId=&limit=`
- `GET /api/demo/sessions/:sessionId/receipts?epochId=&postUri=`

`POST /api/demo/sessions` accepts `refreshCorpus: true` to force a new live corpus load for the new session boundary.

## Governance Math

The shadow demo uses the same side-effect-free trimmed-mean helper as production aggregation, labeled `trimmed_mean_no_trim_under_10`: no trimming below ten votes, and 10 percent trimming from both ends once ten or more votes exist.

The default demo electorate is one reviewer plus 24 deterministic synthetic community voters, for 25 total weight votes. That means the v2 demo actually exercises the production trim rule: two low and two high values are trimmed per component before averaging.

Synthetic voters are deterministic, seeded, inspectable, and replayable. They are grouped into five visible blocs:

- Research Practitioners: 5 voters
- Data Stewards: 5 voters
- Current-Awareness Readers: 5 voters
- Community Discussants: 4 voters
- Interdisciplinary Connectors: 5 voters

LLM agents are out of scope for v2 because the demo needs replayability, bounded cost, deterministic receipts, and a clear explanation path for ACM RecSys reviewers. The synthetic voters are not meant to impersonate real people; they are a deterministic community-governance simulator over live-scored production components.

Each synthetic voter combines a stable bloc preference, prior-policy inertia, a bounded response to the reviewer proposal, and deterministic per-epoch variation. Replaying the same session inputs produces the same ballots. Changing the previous epoch policy changes the next electorate, so a multi-epoch run has real path dependence without opaque model calls or unbounded randomness.

The open epoch always retains the policy that produced its baseline ranking. Reviewer and synthetic ballots produce a pending aggregate; advancing closes that epoch and creates the next epoch with the pending policy. This preserves a causal before/after comparison instead of applying one aggregate to both sides of the transition.

Scores are recomputed as:

```text
effective relevance = production topic-vector relevance(post topics, shadow topic weights)
demo total = sum(effective raw component score * shadow epoch signal weight)
```

The demo does not rerun the scorer and does not write `post_scores`.

## Isolation Rules

The demo must not import or call production epoch transition, production voting, scoring-pipeline, production feed-cache writer, audit-log writer, or research-export writer paths. It may read active production epochs, posts, and decomposed score components to build the frozen corpus.

Production tables and keys that must not be written by the demo:

- `governance_votes`
- `governance_epochs`
- `governance_audit_log`
- `feed:current`
- `feed:current_snapshot_id`
- research export tables

## Public View Rules

Bluesky AppView hydration is used for display metadata. Rows with `!no-unauthenticated`, `!hide`, takedown, adult-only labels, deleted/unavailable records, or missing public text are returned as compact hidden rows without text, handle, avatar, or Bluesky URL.

The UI should display 8-12 ranked posts per shadow epoch when the frozen corpus is large enough. If the live Open Science Builders corpus cannot be loaded or fewer than five public scored posts survive hydration, the API returns a degraded state and falls back to illustrative fixture posts with clear provenance. Live-proof claims must come from public Bluesky posts and Corgi receipt endpoints.

## Corpus Health Rules

The live Open Science Builders corpus loader reads recent non-deleted posts from production storage, selects posts with at least one of the four production topic slugs, keeps only posts with decomposed score components for the active production epoch, hydrates display metadata via public Bluesky AppView, and then applies the public-view rules above. The source pool metrics are computed before the 80-post display-corpus limit, so the UI does not mistake the frozen sample size for total 72-hour supply.

A 2026-07-10 read-only production query found 84,831 active-epoch scored candidates from 46,652 authors over 72 hours. Of those, 2,274 posts matched two or more target topics, or about 758 cross-topic posts/day. The largest single author contributed 1.7 percent of the pool. Detailed counts and query semantics are in `docs/lab/open-science-demo-readiness.md`.

This proves ample source supply for the shadow corpus. It does not mean Open Science Builders has been published as a native Bluesky feed; no feed record/rkey exists for it in v2.
