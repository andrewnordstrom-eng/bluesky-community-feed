# Community-Governed Bluesky Feed Generator

## What This Is

A Bluesky custom feed where **subscribers democratically vote on algorithm parameters**. Instead of one person deciding how posts are ranked, the community does through Polis-style deliberation.

- Users subscribe to the feed in their Bluesky app
- Subscribers vote on how much weight each scoring component should have
- Votes are aggregated using trimmed mean (removes outliers)
- The feed algorithm uses the community-chosen weights

**No one has built this before.** This is the first governance-weighted custom feed on AT Protocol.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Bluesky Network                                                        │
│        │                                                                 │
│        ▼                                                                 │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                │
│   │  Jetstream  │───▶│ PostgreSQL  │───▶│   Scoring   │                │
│   │  WebSocket  │    │   (posts,   │    │  Pipeline   │                │
│   │             │    │   likes,    │    │ (every 5m)  │                │
│   └─────────────┘    │   follows)  │    └──────┬──────┘                │
│                      └─────────────┘           │                        │
│                                                ▼                        │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                │
│   │  Bluesky    │◀───│    Redis    │◀───│  Top 1000   │                │
│   │    App      │    │ (feed:curr) │    │   Posts     │                │
│   └─────────────┘    └─────────────┘    └─────────────┘                │
│                                                                          │
│   ┌─────────────┐    ┌─────────────┐                                    │
│   │  Voting UI  │───▶│ Governance  │──▶ Weights applied next scoring   │
│   │  (React)    │    │   Epochs    │                                    │
│   └─────────────┘    └─────────────┘                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Steps

1. **Jetstream WebSocket** → Ingests public Bluesky posts (with keyword + embedding topic classification), likes, reposts, follows into PostgreSQL
2. **Scoring Pipeline** (every 5 minutes) → Calculates 5 component scores per post, applies governance weights, stores full decomposition
3. **Top 1000 posts** → Pushed to Redis sorted set (`feed:current`)
4. **getFeedSkeleton** → Bluesky app requests feed, we read from Redis and return post URIs
5. **Users vote** → Weights aggregated via trimmed mean → Next epoch uses new weights

---

## The 5 Scoring Components

Each component returns a normalized **0.0 to 1.0** score:

| Component | What It Measures | Algorithm |
|-----------|------------------|-----------|
| **Recency** | How new the post is | Exponential decay, half-life 18 hours |
| **Engagement** | Likes, reposts, replies | Log-scaled: `log10(likes×1 + reposts×2 + replies×3 + 1)` |
| **Bridging** | Cross-bubble appeal | Jaccard distance of engager follower sets |
| **Source Diversity** | Prevent author domination | Gini coefficient penalty for concentration |
| **Relevance** | Topic matching | Weighted average of post topic vector × community topic weights (governance-driven) |

### Final Score Calculation

```
total_score = Σ(component_score × governance_weight)

Example with default weights:
  Recency (0.95) × 0.30 = 0.285
  Engagement (0.40) × 0.25 = 0.100
  Bridging (0.60) × 0.20 = 0.120
  Source Diversity (0.80) × 0.15 = 0.120
  Relevance (0.50) × 0.10 = 0.050
  ─────────────────────────────────
  Total Score = 0.675
```

---

## Governance Model

### How Voting Works

1. **Eligibility**: Only feed subscribers can vote (tracked when they request the feed)
2. **Weight Distribution**: Voters set their preferred weight for each component (must sum to 100%)
3. **One Vote Per Epoch**: Each subscriber gets one vote per governance epoch (can update)
4. **Audit Trail**: All votes logged to append-only audit table

### Trimmed Mean Aggregation

To prevent manipulation by outliers:

1. Collect all votes for the epoch
2. For each component independently:
   - Sort values
   - Remove top 10% and bottom 10%
   - Calculate mean of remaining values
3. Normalize result to sum to exactly 1.0

Minimum 10 votes required before trimming kicks in.

### Epoch Lifecycle

```
┌──────────────┐    votes ≥ MIN_VOTES    ┌──────────────┐
│    ACTIVE    │ ─────────────────────▶  │    VOTING    │
│  (current)   │                         │  (closing)   │
└──────────────┘                         └──────┬───────┘
                                                │
       ┌────────────────────────────────────────┘
       │  aggregate votes, create new epoch
       ▼
┌──────────────┐                         ┌──────────────┐
│    ACTIVE    │ ◀──────────────────────│    CLOSED    │
│ (new epoch)  │                         │ (archived)   │
└──────────────┘                         └──────────────┘
```

---

## Database Schema (Key Tables)

### posts
Stores all ingested Bluesky posts with `deleted` flag for soft deletes.

### post_scores (GOLDEN RULE)
Stores **decomposed scores** - 15 columns per post per epoch:
- 5 raw scores (recency_score, engagement_score, etc.)
- 5 weights from governance epoch
- 5 weighted values (score × weight)
- total_score
- epoch_id (critical for measuring governance impact)

### governance_epochs
Current and historical governance periods with weight distribution.

### governance_votes
Individual subscriber votes (one per voter per epoch).

### governance_audit_log
**Append-only** record of all governance actions (trust anchor).

### subscribers
Tracks who uses the feed and is eligible to vote.

### jetstream_cursor
Persists cursor every 1000 events to resume without gaps.

---

## Transparency Dashboard

The React frontend provides:

- **Current Weights**: Radar chart showing active epoch's weight distribution
- **Feed Statistics**: Posts scored, unique authors, average bridging
- **Epoch History**: Timeline of all governance epochs with weight changes
- **Post Explanations**: Why any post has its current rank (score breakdown)
- **Audit Log**: Complete history of governance actions

---

## Current Limitations

1. **All of Bluesky**: Currently ingests everything, not scoped to topic/community
2. **No Moderation Layer**: Relies on Bluesky's own moderation
3. **Relevance**: Uses keyword + embedding classification at ingestion time; governance weights determine per-topic relevance at scoring time
4. **Single Feed**: One governance epoch affects one feed

---

## Future: Collection Governance

Currently users vote on **ranking** (how to order posts). Future extension: vote on **collection** (what to include).

### Potential Collection Rules

- **Topic Keywords**: Include posts mentioning specific terms
- **Source Allowlists/Blocklists**: Include/exclude specific accounts
- **Content Type Filters**: Text only, images allowed, no reposts
- **Language Filters**: English only, multilingual, etc.
- **Engagement Thresholds**: Minimum likes to be considered

### Implementation Path

1. Add `collection_rules` JSONB column to `governance_epochs`
2. Create voting UI for rule proposals
3. Jetstream handlers check rules before inserting posts
4. Separate epochs for collection rules vs. ranking weights

---

## Deployment Requirements

### Infrastructure
- **VPS**: Any Linux server with Docker (2GB RAM minimum)
- **PostgreSQL 16+**: Main data store
- **Redis 7+**: Feed cache and cursor snapshots

### Bluesky Requirements
- **DID:PLC**: Must use `did:plc` (not `did:web`) - survives domain changes
- **publish-feed.ts**: Script to register feed with Bluesky
- **DNS**: Point domain to VPS for feed URL

### Environment Variables
```bash
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JETSTREAM_URL=wss://jetstream1.us-east.bsky.network/subscribe
FEED_GENERATOR_DID=did:plc:your-did
FEED_HOSTNAME=feed.yourdomain.com
```

---

## Key Files

| Path | Purpose |
|------|---------|
| `src/ingestion/jetstream.ts` | WebSocket connection to Bluesky firehose |
| `src/ingestion/embedding-gate.ts` | Single-post embedding classifier (at ingestion time) |
| `src/scoring/pipeline.ts` | 5-component scoring and Redis population |
| `src/feed/routes/feed-skeleton.ts` | AT Protocol feed endpoint |
| `src/governance/routes/vote.ts` | Vote submission API |
| `src/governance/aggregation.ts` | Trimmed mean calculation |
| `web/src/pages/Vote.tsx` | Voting UI with linked sliders |
| `web/src/pages/Dashboard.tsx` | Transparency dashboard |

---

## Commands

```bash
# Development
npm run dev              # Start backend (port 3000)
cd web && npm run dev    # Start frontend (port 5173)

# Database
npm run migrate          # Run migrations
npm run score            # Manually trigger scoring

# Production
docker-compose up -d     # Start PostgreSQL + Redis
npm run build            # Compile TypeScript
npm start                # Start production server
```

---

## Credits

- **Architecture Model**: [PaperSkygest](https://github.com/Skygest/PaperSkygest)
- **Jetstream**: [bluesky-social/jetstream](https://github.com/bluesky-social/jetstream)
- **AT Protocol Feed Spec**: [docs.bsky.app](https://docs.bsky.app/docs/starter-templates/custom-feeds)
