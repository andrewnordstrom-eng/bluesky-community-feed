# Project Status: What Happened This Week

**TL;DR:** The feed generator went from a working prototype to a production-grade, research-ready system with semantic NLP, a full admin toolkit, and the foundation for community governance experiments.

---

## What You Can See Right Now

- **The live feed** at feed.corgi.network is serving real ranked posts on Bluesky
- **Admin dashboard** with governance controls, topic management, and feed health monitoring
- **Transparency page** showing per-post score breakdowns with topic classification details
- **Vote page** with three tabs: component weights, content keywords, and topic preferences
- **API docs** at /docs (admin-gated) with Swagger UI

---

## What Was Built (in priority order for the team)

### 1. The feed actually works now
The scoring pipeline had two critical bugs causing 10-day-old posts to sit at #1. Both are fixed. Posts now decay properly and the feed shows fresh, relevant content.

### 2. Semantic topic classification
Posts are classified into 25 topics using a two-tier system:
- **Tier 1 (ingestion):** Fast keyword matching via winkNLP (<1ms/post)
- **Tier 2 (scoring):** Semantic embeddings via all-MiniLM-L6-v2 (~20ms/post)

The embedding classifier eliminates false positives that keyword matching can't handle. "Trump Tower developer" no longer matches "software development." This is running in production right now.

### 3. Community governance is fully wired
Subscribers can vote on:
- How much weight each scoring component gets (recency, engagement, bridging, source diversity, relevance)
- Per-topic preferences (boost dogs, penalize politics, etc.)
- Content inclusion/exclusion keywords

Votes are aggregated via trimmed mean each epoch. The architecture supports making ANY parameter votable — post lifespan, classifier thresholds, scoring window, etc.

### 4. Admin toolkit (4 interfaces)
- **Web dashboard** — visual management of epochs, topics, participants, feed health
- **CLI** — `npm run cli -- topics list`, `feed rescore`, `export votes --epoch 1 --format csv`, etc.
- **MCP server** — 30 tools for natural-language admin via Claude or any MCP client
- **REST API** — full CRUD on everything, Zod-validated, audit-logged

### 5. Research infrastructure
- Anonymized data exports (votes, scores, engagement, epochs, audit logs, full-dataset ZIP)
- `classification_method` tracking on every score (keyword vs embedding) for classifier comparison studies
- Private feed mode for IRB-gated participant studies
- Research consent flow
- Governance audit log (append-only, DB-enforced)

### 6. Security audit completed
316 files reviewed, 62,965 lines. 13 findings (9 HIGH, 4 MEDIUM), all fixed. Zero CRITICAL. Documented in `docs/SECURITY_AUDIT.md`.

---

## Architecture in One Paragraph

Bluesky posts flow in via Jetstream WebSocket → classified by winkNLP at ingestion → stored in PostgreSQL. Every 5 minutes, the scoring pipeline re-classifies with semantic embeddings, computes 5 component scores weighted by community votes, stores decomposed scores (Golden Rule), and writes the top 1000 to Redis. Bluesky apps request the feed via AT Protocol's `getFeedSkeleton`. The governance system runs in epochs — community votes during a voting phase, votes are aggregated via trimmed mean, and the next epoch uses the new weights.

---

## What's Next

1. **API documentation** — Complete OpenAPI spec on every route (infrastructure is in place, schemas need adding)
2. **Governance parameter registry** — Database-driven system where admins control which parameters the community can vote on (the "commune to authoritarian spectrum")
3. **Petition-to-vote pipeline** — Community members propose governance changes via Bluesky replies, support via likes, auto-promoted to formal votes
4. **Demo video** — Remotion-based walkthrough for the research community

---

## For Developers Joining

Read these files in order:
1. `CLAUDE.md` — Project rules and key file paths
2. `AGENTS.md` — Architecture overview for AI coding agents
3. `docs/SYSTEM_OVERVIEW.md` — Detailed system walkthrough
4. `docs/dev-journal.md` — Chronological record of every change with rationale

The full test suite: `npm run build && npm test -- --run` (402 tests across 66 files, should all pass)

Key architectural decisions are documented in the dev journal entries under "Decisions & alternatives" — read those before proposing changes to understand why things are the way they are.
