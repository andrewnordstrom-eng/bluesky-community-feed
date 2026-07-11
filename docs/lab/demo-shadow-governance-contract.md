# Corgi Shadow Demo Governance Contract

Version: `2026-07-10.shadow-demo.v3`

This contract powers the public `/demo` walkthrough without mutating production governance.

## Scope

- `open_science_builders` is the only live shadow community in v3. Its candidate pool uses the existing `science-research`, `data-science`, `software-development`, and `open-source` topic vectors.
- `birders_who_code` remains a preview/future secondary community. It is not the primary reviewer corpus and is not published as a Bluesky feed.
- Other demo community IDs may be returned as degraded concepts, not live feeds.
- Demo sessions source one corpus from live production `posts`, active `post_scores`, current epoch weights, and Bluesky AppView hydration, then freeze that comparison set at session creation. Reviewer votes change ranking math, not the compared post set.
- UI copy should use this provenance line: "Live-scored snapshot, frozen for this demo run so rank movement is attributable to policy changes."
- Demo state is Redis-only under `demo:session:*`, `demo:sessions:*`, `demo:corpus:*`, `demo:corpus:current:*`, `demo:idempotency:*`, `demo:lock:*`, short-lived `demo:staging:*`, and `demo:rate-limit:*` keys. It uses a dedicated localhost-only Redis on port 6381 with 64 MB, `noeviction`, no persistence, and a 96 MB container limit. Production feed/governance Redis is not used for demo state, including anonymous rate-limit counters.
- Anonymous rate-limit identifiers are stored only as HMAC-SHA-256 digests under a dedicated `DEMO_RATE_LIMIT_HASH_SECRET`; raw reviewer IP addresses are never written to Redis, and the export anonymization salt is not reused.
- Guided UI should default to 5 guided shadow epochs. Advanced/free-play sessions are capped at 10 shadow epochs, including the baseline epoch.
- Shared current corpus snapshots are short-lived warming caches. Each session still receives a cloned frozen corpus.
- Corpus rotation is automatic and lock-protected. There is no public corpus-refresh mutation; a newly created session uses the current shared snapshot and always receives its own frozen comparison boundary.

## Endpoints

- `POST /api/demo/sessions`
- `GET /api/demo/sessions/:sessionId`
- `POST /api/demo/sessions/:sessionId/votes`
- `POST /api/demo/sessions/:sessionId/agents/run` (compatibility path; runs deterministic synthetic community voters, not LLM agents)
- `POST /api/demo/sessions/:sessionId/epochs/advance`
- `GET /api/demo/sessions/:sessionId/feed?epochId=&limit=`
- `GET /api/demo/sessions/:sessionId/receipts?epochId=&postUri=`

All demo mutation bodies are capped at 16 KiB. Only the four Open Science topic keys are accepted. Session state is capped at 1 MiB, idempotency records at 256 KiB, and the anonymous service at 50 active sessions.

## Governance Math

The shadow demo uses the same side-effect-free trimmed-mean helper as production aggregation, labeled `trimmed_mean_no_trim_under_10`: no trimming below ten votes, and 10 percent trimming from both ends once ten or more votes exist.

The default demo electorate is one reviewer plus 24 deterministic synthetic community voters, for 25 total weight votes. That means the v3 demo actually exercises the production trim rule: two low and two high values are trimmed per component before averaging.

Synthetic voters are deterministic, seeded, inspectable, and replayable. They are grouped into five visible blocs:

- Research Practitioners: 5 voters
- Data Stewards: 5 voters
- Current-Awareness Readers: 5 voters
- Community Discussants: 4 voters
- Interdisciplinary Connectors: 5 voters

LLM agents are out of scope for v3 because the demo needs replayability, bounded cost, deterministic receipts, and a clear explanation path for ACM RecSys reviewers. The scripted voter archetypes are not meant to impersonate real people; they are a deterministic community-governance simulator over live-scored production components.

Each synthetic voter combines a stable bloc preference, prior-policy inertia, a bounded response to the reviewer proposal, and deterministic per-epoch variation. Replaying the same session inputs produces the same ballots. Changing the previous epoch policy changes the next electorate, so a multi-epoch run has real path dependence without opaque model calls or unbounded randomness.

The open epoch always retains the policy that produced its baseline ranking. Reviewer and synthetic ballots produce a pending aggregate; advancing closes that epoch and creates the next epoch with the pending policy. This preserves a causal before/after comparison instead of applying one aggregate to both sides of the transition.

Scores are recomputed as:

```text
effective relevance = production topic-vector relevance(post topics, shadow topic weights)
demo total = sum(effective raw component score * shadow epoch signal weight)
```

The demo does not rerun the scorer and does not write `post_scores`.

Applied epochs and receipts retain the authoritative aggregate (`voteCount=25`, `trimCount=2`, signal weights, and topic intent). `reviewerBallotShare=1/25` describes ballot count, not causal influence: scripted ballots respond partly to the reviewer proposal. The `direct_reviewer_ballot_removed` counterfactual removes only the direct reviewer ballot and explicitly holds all 24 scripted ballots fixed.

Topic receipts return the exact scorer decomposition: weighted sum, total topic signal, confidence multiplier, base relevance, effective relevance, the default-topic-weight flag, and every contributing term. When no shadow topic policy is active, the receipt identifies that the stored production relevance component was used instead.

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

The UI should display 8-12 ranked posts per shadow epoch when the frozen corpus is large enough. If the live Open Science Builders corpus cannot be loaded or fewer than ten public scored posts survive hydration, the API returns a degraded state and falls back to illustrative fixture posts with clear provenance. Live-proof claims must come from public Bluesky posts and Corgi receipt endpoints.

## Corpus Health Rules

The live Open Science Builders corpus loader reads recent non-deleted posts from production storage and requires both (a) at least one of the four canonical topic scores at or above 0.5 and (b) a matching Open Science, research, code, or data term in post text. It keeps only posts with decomposed score components for the active production epoch, hydrates display metadata via public Bluesky AppView, and then applies the public-view rules above. The source pool metrics are computed after strict filtering but before the 80-post display-corpus limit, so the UI does not mistake the frozen sample size for total 72-hour eligible supply. Every retained post carries its matched topics and matched text terms as inclusion reasons.

A 2026-07-10 read-only production query found 84,831 active-epoch scored candidates from 46,652 authors over 72 hours. Of those, 2,274 posts matched two or more target topics, or about 758 cross-topic posts/day. The largest single author contributed 1.7 percent of the pool. Detailed counts and query semantics are in `docs/lab/open-science-demo-readiness.md`.

The earlier broad query proves ample source supply, but v3 deliberately applies a stricter eligibility rule and reports the resulting count in corpus provenance. It does not mean Open Science Builders has been published as a native Bluesky feed; no feed record/rkey exists for it in v3.

## Atomicity And Recovery

Session mutations compute a candidate next state without writes. A 15-second ownership token then commits the session and optional idempotency record together in one Redis Lua operation. If ownership expired, the commit is rejected and the prior state remains authoritative. After an ambiguous client failure, the UI reconciles with `GET /api/demo/sessions/:sessionId`; it does not force a new session or assume the mutation failed.
