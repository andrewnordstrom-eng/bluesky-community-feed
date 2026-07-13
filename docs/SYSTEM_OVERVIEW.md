# Corgi Commons Feed Generator

## What This Is

A production Bluesky custom feed with inspectable, community-shaped ranking. Corgi Commons is public to view and subscribe to; production governance participation is currently an approved waitlist pilot.

- Anyone can view Corgi Commons in Bluesky and use the isolated shadow demo
- Approved pilot participants can submit signal weights, topic priorities, and content rules
- Fewer than 10 ballots use an arithmetic mean; 10 or more use a 10% trimmed mean
- Closed results require review and operator approval before the complete policy is applied and the feed is rescored

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
5. **Approved participants vote** → Ballots aggregate after the configurable window → Results review and operator approval → Complete policy application → Rescore

---

## The 5 Scoring Components

Each component returns a normalized **0.0 to 1.0** score:

| Component | What It Measures | Algorithm |
|-----------|------------------|-----------|
| **Recency** | How new the post is | Exponential decay, half-life 18 hours |
| **Engagement** | Likes, reposts, replies | Log-scaled: `log10(likes×1 + reposts×2 + replies×3 + 1)` |
| **Bridging** | Cross-bubble appeal | Jaccard distance of engager follower sets |
| **Source Diversity** | Prevent author domination | Per-author diminishing-returns penalty (repeated authors within a scoring batch score progressively lower) |
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

1. **Eligibility**: Production voting is limited to approved waitlist participants during the pilot
2. **Three ballot channels**: Five global signal weights, topic priorities that shape relevance, and include/exclude content rules
3. **One ballot per epoch**: An approved participant can update their ballot while voting is open
4. **Audit trail**: Governance and operator actions are recorded in the append-only audit table

### Trimmed Mean Aggregation

To prevent manipulation by outliers:

1. Collect all ballots for the epoch
2. For each component independently:
   - With fewer than 10 ballots, calculate the arithmetic mean
   - With 10 or more, sort values and remove the top and bottom 10%
   - Calculate the mean of the remaining values
3. Normalize result to sum to exactly 1.0

Content-rule keywords use a separate threshold: at least 30% support among ballots that submit content rules. Include rules act as an allowlist and excludes take precedence.

### Epoch Lifecycle

1. A vote is scheduled or opened manually with a configurable voting window.
2. The window closes and ballots are aggregated into proposed signals, topics, and content rules.
3. Results enter review; an operator approves or rejects the complete proposal.
4. Approval applies all three policy channels to the active epoch, returns it to the running phase, and queues a durable rescore.
5. Bluesky receives the resulting ordered post URIs; Corgi exposes policy and receipt metadata.

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
Individual approved-participant ballots (one per voter per epoch, updatable while open).

### governance_audit_log
**Append-only** record of all governance actions (trust anchor).

### subscribers
Tracks feed subscriptions and participant state; pilot voting eligibility is separately allowlisted.

### jetstream_cursor
Persists cursor every 1000 events to resume without gaps.

---

## Transparency Dashboard

The React frontend provides:

- **Current Weights**: Radar chart showing active epoch's weight distribution
- **Feed Statistics**: Posts scored, unique authors, average bridging
- **Epoch History**: Timeline of all governance epochs with weight changes
- **Post Explanations**: Score and ranking provenance when a Corgi receipt is available
- **Audit Log**: Complete history of governance actions

---

## Current Limitations

1. **Pilot governance access**: Viewing and the shadow demo are public; production voting is allowlisted
2. **Single public governed feed**: Corgi Commons is the production feed; multi-community governance is not yet public
3. **Relevance model**: Curated keyword topic classification is primary; sentence-embedding similarity is optional behind configuration
4. **Receipt coverage**: A receipt requires persisted score provenance for the post and epoch

---

## Content-Rule Governance

Content rules are part of the current ballot. Include keywords form an allowlist, exclude keywords take precedence, and adopted rules are applied with the approved signal and topic policy before rescoring. The public shadow demo exposes only bounded exclusion-rule mechanics for this release.

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
npm run cli -- feed rescore  # Manually trigger scoring

# Production
docker compose up -d     # Start PostgreSQL + Redis
npm run build            # Compile TypeScript
npm start                # Start production server
```

---

## Credits

- **Architecture Model**: [PaperSkygest](https://github.com/Skygest/PaperSkygest)
- **Jetstream**: [bluesky-social/jetstream](https://github.com/bluesky-social/jetstream)
- **AT Protocol Feed Spec**: [docs.bsky.app](https://docs.bsky.app/docs/starter-templates/custom-feeds)
