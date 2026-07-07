# 2026-07-07 RecSys Live Metrics Packet

Status: PROJ-1433 production refresh
Collected: 2026-07-07T03:00:57Z
Environment: live production, `https://feed.corgi.network`
Repo base: `origin/main` at `da2450fd28a014f2e94d2c46721f6e42413c0ad2`
Admin scope: public endpoints only; no admin cookies, bearer tokens, database credentials, or export secrets used

## Receipt Commands

```bash
curl -sS https://feed.corgi.network/health
curl -sS https://feed.corgi.network/xrpc/app.bsky.feed.describeFeedGenerator
curl -sS https://feed.corgi.network/api/governance/weights
curl -sS https://feed.corgi.network/api/transparency/stats
curl -sS 'https://feed.corgi.network/xrpc/app.bsky.feed.getFeedSkeleton?feed=at%3A%2F%2Fdid%3Aplc%3Aamzyknmm4auxijvykyfgznw2%2Fapp.bsky.feed.generator%2Fcommunity-gov&limit=100'
curl -sS 'https://feed.corgi.network/api/transparency/counterfactual?recency=0.2&engagement=0.5&bridging=0.1&source_diversity=0.1&relevance=0.1&limit=10'
curl -sS 'https://feed.corgi.network/api/transparency/post/at%3A%2F%2Fdid%3Aplc%3Adv4t4hwp2bzm2ruyim2hpssa%2Fapp.bsky.feed.post%2F3mpaxvobadc2e'
curl -sS 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=at%3A%2F%2Fdid%3Aplc%3Adv4t4hwp2bzm2ruyim2hpssa%2Fapp.bsky.feed.post%2F3mpaxvobadc2e&depth=0'
```

## Live Production Claims

| Metric | Value | Receipt |
|---|---:|---|
| Health | `{"status":"ok"}` | `/health` |
| Feed generator DID | `did:plc:amzyknmm4auxijvykyfgznw2` | `describeFeedGenerator` |
| Feed URI | `at://did:plc:amzyknmm4auxijvykyfgznw2/app.bsky.feed.generator/community-gov` | `describeFeedGenerator` |
| Active epoch | `2` | `/api/transparency/stats`, `/api/governance/weights` |
| Epoch status | `active` | `/api/transparency/stats` |
| Epoch created | `2026-02-07T21:38:06.153Z` | `/api/transparency/stats` |
| Current epoch votes | `0` | `/api/transparency/stats`, `/api/governance/weights` |
| Scored posts | `3,348` | `/api/transparency/stats` |
| Unique authors | `3,007` | `/api/transparency/stats` |
| Average bridging score | `0.7276394256303051` | `/api/transparency/stats` |
| Average engagement score | `0.3226783153401943` | `/api/transparency/stats` |
| Median bridging score | `0.9186194653299917` | `/api/transparency/stats` |
| Median total score | `0.5312066730135393` | `/api/transparency/stats` |
| Served feed page | `100` posts returned with a cursor for `limit=100` | `getFeedSkeleton` |

Current weights from both public governance and transparency endpoints:

```json
{
  "recency": 0.25,
  "engagement": 0.2,
  "bridging": 0.1,
  "source_diversity": 0.1,
  "relevance": 0.35
}
```

The governance weights endpoint reports the epoch description as `FORCED transition from epoch 1 with 2 votes.` The current epoch itself has `0` votes, so public copy should not imply current live voter participation beyond that historical transition note.

## Post Explanation Example

Production post:

```text
at://did:plc:dv4t4hwp2bzm2ruyim2hpssa/app.bsky.feed.post/3mpaxvobadc2e
```

Public Bluesky appview context:

- Author handle: `elainesque.bsky.social`
- Post text: `Also, this is just funny.`
- Created: `2026-06-27T07:49:32.745Z`
- Indexed: `2026-06-27T07:49:34.782Z`
- Engagement at appview fetch time: 10 likes, 6 reposts, 0 replies, 0 quotes

Corgi explanation receipt:

| Field | Value |
|---|---:|
| Epoch | `2` |
| Rank | `1` |
| Total score | `0.8486208006784361` |
| Scored at | `2026-06-27T08:33:59.649Z` |
| Classification method | `keyword` |
| Pure-engagement rank | `4` |
| Community-governed rank | `1` |
| Governance difference | `+3` positions |

Component breakdown:

| Component | Raw | Weight | Weighted |
|---|---:|---:|---:|
| Recency | `0.971876150243864` | `0.25` | `0.242969037560966` |
| Engagement | `0.45384361090898817` | `0.2` | `0.09076872218179764` |
| Bridging | `0.9988304093567251` | `0.1` | `0.09988304093567252` |
| Source diversity | `1` | `0.1` | `0.1` |
| Relevance | `0.9` | `0.35` | `0.315` |

Topic breakdown for relevance:

```json
{
  "decentralized-social": {
    "postScore": 1,
    "communityWeight": 0.9,
    "contribution": 0.9
  }
}
```

## Counterfactual Example

Engagement-heavy alternate weights:

```json
{
  "recency": 0.2,
  "engagement": 0.5,
  "bridging": 0.1,
  "source_diversity": 0.1,
  "relevance": 0.1
}
```

Receipt summary for the top 10 current posts:

| Metric | Value |
|---|---:|
| Posts compared | `10` |
| Posts moved up | `4` |
| Posts moved down | `6` |
| Posts unchanged | `0` |
| Max absolute rank change | `13` |
| Average absolute rank change | `4.1` |

Largest observed movement in this receipt: the current rank-1 post above moves to rank 14 under the engagement-heavy counterfactual (`rank_delta = -13`).

## Simulation-Derived And Local Claims

These are not live production metrics:

- PROJ-1551 local validation reported a recorded Jetstream replay fixture of 1,200 events at 3,105.67 events/sec with 0 drops, 0 handler errors, 0 state mismatches, 0 outcome mismatches, handler p95 0.76 ms, 569 durable state mutations, and cursor lag 793 microseconds.
- PROJ-1551 local validation reported a real-route voting load of 8,000 POSTs across 500 synthetic users with 8,000/8,000 `200` responses, p95 48.18 ms, exact database/audit reconciliation, exact aggregate rows after the 429 phase, cleanup failures 0, and correct per-DID 429 behavior.
- PROJ-1551 local validation reported a compiled prod-parity memory gate of 5 runs per mode at 10,000 requests and 100 connections with normal/no-op median after-GC RSS deltas 36.43 MB / 30.14 MB.

Do not turn those into production-scale claims. The PROJ-1551 lab note explicitly says synthetic voter populations are useful for mechanism evidence but do not prove real electorate behavior, Sybil resistance, personhood, or abuse resistance.

Current strategyproofness evidence is also simulation-derived. The source fixture in `tests/harness/strategyproofness.sim.ts` pins a bounded result for the real `aggregateVotes` implementation: at `n=10`, sincere L1 is approximately `0.302`, strategic L1 approximately `0.236`, and the manipulation direction is positive for that documented population. This is evidence about manipulability of one synthetic population, not a Sybil-resistance proof.

Fresh local rerun attempt for `tests/harness/strategyproofness.sim.ts` on this branch did not produce a simulation result. `./node_modules/.bin/vitest run --config vitest.harness.config.ts tests/harness/strategyproofness.sim.ts` failed before tests with `Could not find a working container runtime strategy` from Testcontainers, even though `docker info` reported Docker Desktop server `29.4.3` running. The paper/site should therefore avoid fresh-run claims for this simulation until the harness is rerun successfully.

## Branch Verification

Final branch verification used dummy non-production environment values and local loopback/IPC permission. `npm run verify` passed on 2026-07-07 at 04:10 UTC, including root TypeScript build, 98 Vitest files / 885 tests, CLI build, MCP-local skip check, SDK build, SDK fixture, Vite lint/build, and Next static build. A direct `web-next` TypeScript guard also passed with `npx tsc --noEmit` after the branch fixed two pre-existing component type errors that Next's configured build does not enforce. The extra Vitest file guards the public `web-next` demo fixtures against accidentally committing live Bluesky handles, DIDs, AT-URIs, known receipt text, and receipt drift.

## Copy Guidance

Safe live-production wording:

- "As of 2026-07-07 03:00 UTC, Corgi's public transparency endpoint reported epoch 2 active with 3,348 scored posts, 3,007 unique authors, and 0 votes in the current epoch."
- "A public post explanation shows a rank-1 production post with total score 0.8486, all five component contributions, and a pure-engagement counterfactual rank of 4."
- "An engagement-heavy counterfactual over the top 10 current posts moved 4 posts up and 6 down, with max rank change 13 and average absolute change 4.1."

Unsafe wording:

- "Corgi has proven live Sybil resistance."
- "The 8,000-request vote-load receipt proves production voting capacity."
- "The feed contains only 100 posts." The public skeleton receipt proves a 100-item served page with cursor, not total feed size.
- "Current epoch weights were produced by current live voters." The active epoch has 0 current-epoch votes; the epoch description references a forced transition from epoch 1 with 2 votes.
