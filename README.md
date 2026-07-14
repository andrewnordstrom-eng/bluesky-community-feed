<p align="center">
  <img src="docs/assets/corgi-logo-mark.png" alt="Corgi logo" width="180">
</p>

<h1 align="center">Corgi</h1>

<p align="center">
  Community-shaped Bluesky ranking with inspectable policy and receipts.
</p>

[![Deploy](https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/workflows/deploy.yml/badge.svg)](https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/workflows/deploy.yml)
[![Deploy Docs](https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/workflows/deploy-docs.yml/badge.svg)](https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/workflows/deploy-docs.yml)
[![CI](https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/workflows/ci.yml)
[![CodeQL](https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node >= 20](https://img.shields.io/badge/Node-%3E%3D20-339933)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6)](https://www.typescriptlang.org/)

Corgi Commons is a production Bluesky custom feed shaped through a limited governance pilot. Approved participants can vote on five global ranking signals, topic priorities that shape relevance, and content rules that shape eligibility. Closed results are reviewed and approved before the complete policy is applied and the feed is rescored. Bluesky shows the ordered posts; Corgi exposes the policy and available ranking receipts.

> **Research question:** Can communities meaningfully govern their own recommendation algorithms?

![Governance dashboard screenshot](docs/screenshots/dashboard.png)

---

## Try It

**No coding required.** Anyone can use the anonymous demo; a Bluesky account is needed only to save or subscribe to the feed.

1. **Open Corgi Commons** — view or subscribe to the public feed without a Corgi account:
   [Open Corgi Commons on Bluesky](https://bsky.app/profile/corgi-network.bsky.social/feed/community-gov)

2. **Try isolated shadow governance** — propose a policy, combine it with 24 scripted deterministic voter archetypes, and inspect how a frozen comparison corpus reranks without changing production:
   [feed.corgi.network/demo](https://feed.corgi.network/demo)

3. **Request pilot access** — production governance participation is currently available through an approved waitlist:
   [feed.corgi.network/start](https://feed.corgi.network/start)

---

## Features

**Governance**
- Ballots can cover five global ranking signals, topic priorities, and include/exclude content rules
- Include rules act as an allowlist, excludes take precedence, and rule adoption requires at least 30% support among content-rule ballots
- Scheduled or manual rounds with configurable voting windows, arithmetic mean below 10 ballots, 10% trimmed mean at 10 or more, results review, operator approval, and post-approval rescoring
- Append-only audit log (DB-enforced, no edits or deletes)

**Scoring & Transparency**
- Score decomposition persisted per post per epoch — raw, weight, and weighted contribution for every registered component, in a normalized long table
- Transparency endpoints: per-post explanations, counterfactual analysis, feed-level statistics
- Redis-backed feed serving with snapshot cursors (<50ms response time)

**Feed Intelligence**
- Jetstream ingestion with cursor persistence and automatic reconnection
- Bluesky `acceptsInteractions` support (See More / See Less feedback buttons)
- AT Protocol content label filtering (NSFW, moderation labels)
- Interaction analytics: scroll depth, engagement attribution, keyword performance

**Research Mode**
- Approved governance-participant list for the limited pilot; viewing Corgi Commons and using the shadow demo stay public
- Research consent flow with IRB-ready architecture
- Anonymized data export (deterministic hashing, correlatable across tables)
- Legal framework: Terms of Service, Privacy Policy, research consent separation

**Admin & Tooling**
- Admin dashboard: governance controls, feed health, interactions, audit log
- CLI tool (`feed-cli`): full admin operations from any terminal, no VPS access required
- MCP server: Streamable HTTP admin tools for natural-language feed management
- Public API reference at [docs.corgi.network](https://docs.corgi.network), auto-deployed from `docs/docs-site/`
- Admin Swagger UI at `/api/docs` (production-gated); `/docs` is the public product documentation
- Research data export: votes, scores, engagement, epochs, audit log (CSV/JSON)

**Engineering**
- Automated unit, integration, contract, and stress tests with PR-gated CI
- Genuinely pluggable scoring components: implement the `ScoringComponent` interface from `@corgi/feed-sdk`, register, ship. No schema migration required. See the [contribution guide](docs/contributing-scoring-components.md) and the [civility example](examples/civility-component/) for an end-to-end walk-through. ADR-0001 covers the design.
- Pre-commit hooks (husky + lint-staged + tsc)
- Dependabot for automated dependency updates
- CodeQL + npm audit gates on pull requests
- Shared types between frontend and backend (compile-time contract)
- Code generators for new scoring components and routes

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                        INTERFACES                           │
│  Web Dashboard  │  CLI (feed-cli)  │      MCP Server         │
└────────┬────────┴────────┬─────────┴────────┬───────────────┘
         │                 │                  │
         ▼                 ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                     FASTIFY SERVER                          │
│  Governance APIs  │  Admin APIs  │  Export APIs  │  XRPC    │
└────────┬──────────┴──────┬───────┴──────┬───────┴─────┬─────┘
         │                 │              │             │
         ▼                 ▼              ▼             ▼
┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐
│  GOVERNANCE  │  │   SCORING    │  │  EXPORT  │  │   FEED   │
│  Epochs      │  │  5 components│  │  CSV/JSON│  │  Skeleton│
│  Votes       │  │  Pipeline    │  │  Anonymize│ │  Cursors │
│  Aggregation │  │  (batch/5min)│  │          │  │  (<50ms) │
└──────┬───────┘  └──────┬───────┘  └──────────┘  └────┬─────┘
       │                 │                              │
       ▼                 ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATA LAYER                               │
│  PostgreSQL 16 (posts, scores, epochs, votes, audit)        │
│  Redis 7 (feed snapshots, sessions, caches)                 │
└─────────────────────────────────────────────────────────────┘
       ▲
       │
┌──────┴──────┐    ┌───────────────┐
│  INGESTION  │◄───│   Bluesky     │
│  Jetstream  │    │   Firehose    │
│  WebSocket  │    │   (AT Proto)  │
└─────────────┘    └───────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20, TypeScript 6, Fastify 5 |
| Data | PostgreSQL 16, Redis 7 |
| Frontend | Next.js 15 (React 19) static export, Tailwind, TanStack Query |
| Protocol | `@atproto/api`, `@atproto/xrpc-server` |
| NLP | winkNLP (topic classification) |
| Testing | Vitest, Fastify inject |
| Deploy | Docker, GitHub Actions CI/CD |

---

## Quickstart

### Prerequisites
- Node.js >= 20
- Docker and Docker Compose (for PostgreSQL + Redis)
- A Bluesky account with an [app password](https://bsky.app/settings/app-passwords)

### Setup

```bash
git clone https://github.com/andrewnordstrom-eng/bluesky-community-feed.git
cd bluesky-community-feed

# Install dependencies
npm install
cd web && npm install && cd ..

# Configure environment
cp .env.example .env
# Edit .env with your Bluesky credentials and service config

# Start PostgreSQL + Redis
docker compose up -d

# Run migrations and seed initial governance epoch
npm run migrate
npx tsx scripts/seed-governance.ts

# Build and run
npm run build
npm run dev

# Frontend (separate terminal)
cd web && npm run dev
```

### Verify

```bash
npm run verify
npm run docs:verify
python3 -m py_compile scripts/generate-report.py scripts/generate-report-pdf.py scripts/report_utils.py
MPLCONFIGDIR=/tmp python3 scripts/generate-report.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run
MPLCONFIGDIR=/tmp python3 scripts/generate-report-pdf.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run
npm audit --audit-level=moderate
cd web && npm audit --audit-level=moderate
curl http://localhost:3000/health  # {"status":"ok"}
```

### Quick Smoke Test

```bash
# 1) Service health should return {"status":"ok"}
curl -sS http://localhost:3000/health

# 2) Feed describe should return a DID and feed URI payload
curl -sS http://localhost:3000/xrpc/app.bsky.feed.describeFeedGenerator

# 3) Direct CLI read against local DB should return JSON (epoch may be null on fresh DB)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/community_feed" npm run cli -- --direct --json epoch status
```

---

## Scoring Formula

Five components, each normalized to 0.0–1.0:

| Component | Signal | Method |
|-----------|--------|--------|
| Recency | Post age | Exponential decay (18hr half-life) |
| Engagement | Likes, reposts, replies | Log-scaled (likes×1 + reposts×2 + replies×3) |
| Bridging | Cross-community appeal | Jaccard distance of engager follow sets |
| Source Diversity | Author variety | Diminishing returns per author (1.0 → 0.7 → 0.5 → 0.3) |
| Relevance | Topic match × community preference | Weighted dot product of topic vectors and governance weights |

**Component score:** `total = Σ(component_raw × approved_signal_weight)` where the five global signal weights sum to 1.0. Topic preferences affect the relevance component only; eligibility rules and publication adjustments are applied separately.

All 15 numeric values (5× raw, weight, weighted) are persisted per post per epoch for full auditability.

---

<details>
<summary><strong>API Surface</strong></summary>

**Public (no auth)**
- `GET /xrpc/app.bsky.feed.getFeedSkeleton` — Feed skeleton (AT Protocol)
- `GET /xrpc/app.bsky.feed.describeFeedGenerator` — Feed metadata
- `POST /xrpc/app.bsky.feed.sendInteractions` — See More/See Less signals
- `GET /api/transparency/*` — Score explanations, stats, counterfactuals, audit log
- `GET /health`, `/health/ready`, `/health/live` — Health checks

**Governance (session auth)**
- `POST /api/governance/auth/login` — Bluesky handle + app password
- `POST /api/governance/vote` — Submit weight + keyword + topic votes
- `GET /api/governance/weights`, `/epochs`, `/content-rules` — Current governance state

**Admin (session auth + DID allowlist)**
- `GET /api/docs` — OpenAPI / Swagger UI (admin-gated in production)
- `/api/admin/status`, `/epochs`, `/governance/*` — Governance controls
- `/api/admin/feed/*` — Feed health, rescore, Jetstream reconnect
- `/api/admin/interactions/*` — Scroll depth, engagement, keyword analytics
- `/api/admin/participants/*` — Research participant management
- `/api/admin/export/*` — Research data export (votes, scores, engagement, epochs, audit)

**MCP Server**
- `POST /mcp` — Streamable HTTP endpoint for programmatic admin tooling

</details>

<details>
<summary><strong>CLI</strong></summary>

Full admin operations from any terminal. Authenticates via the same session system as the web dashboard — no VPS credentials required.

```bash
npm run cli -- login your-handle.bsky.social xxxx-xxxx-xxxx-xxxx
npm run cli -- epoch status
npm run cli -- votes summary --epoch 1
npm run cli -- feed health
npm run cli -- export votes --epoch 1 --format csv
npm run cli -- topics list
npm run cli -- announce send "Voting opens tomorrow"
```

See `npm run cli -- --help` for all commands.

</details>

---

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/SYSTEM_OVERVIEW.md`](docs/SYSTEM_OVERVIEW.md) | Architecture and data flow |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Production deployment guide |
| [`docs/OPS_RUNBOOK.md`](docs/OPS_RUNBOOK.md) | Operations and troubleshooting |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security model and threat analysis |
| [`ROADMAP.md`](ROADMAP.md) | Product and engineering roadmap |
| [`RELEASING.md`](RELEASING.md) | Semantic versioning and release process |
| [`docs/ISSUE_TRIAGE.md`](docs/ISSUE_TRIAGE.md) | Issue labels, triage, and newcomer flow |
| [`docs/MCP_SETUP.md`](docs/MCP_SETUP.md) | MCP server connection guide |
| [`docs/STABILITY_TEST.md`](docs/STABILITY_TEST.md) | Stability and load testing |
| [`docs/dev-journal.md`](docs/dev-journal.md) | Development log with decisions |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributor guidelines |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting policy |
| [`SUPPORT.md`](SUPPORT.md) | Support channels and issue guidance |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | Community code of conduct |
| [`legal/`](legal/) | Terms of Service, Privacy Policy |

---

## Research Context

This project is a research instrument for studying algorithmic governance. It is developed in the context of work on community-governed recommendation systems for decentralized social networks.

The system is designed so that:
- Every ranking decision is decomposable and auditable
- Community preferences are captured through structured governance votes
- The effect of governance changes on feed behavior is measurable across epochs
- Research data can be exported with deterministic anonymization for analysis

If you use this system in research, cite the repository URL and commit SHA used for your analysis.

---

## License

MIT — see [`LICENSE`](LICENSE).
