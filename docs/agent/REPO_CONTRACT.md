# Repo Contract -- bluesky-community-feed

Status: canonical repo contract
Owner: bluesky-feed
Service class: production_service
Contract version: 2
Last updated: 2026-04-06
Last verified: 2026-04-06

> Canonical reference for any human or tooling operating in this repo.

---

## 1. What This Repo Is

A production Bluesky custom feed generator where subscribers democratically vote
on ranking weights and content rules. The backend applies those decisions in a
transparent, auditable scoring pipeline. Every ranking decision is decomposed,
stored, and explainable.

This is the first governance-weighted custom feed on AT Protocol.

**Canonical URL:** `https://feed.corgi.network`
**API docs:** `https://docs.corgi.network`
**Repo:** `andrewnordstrom-eng/bluesky-community-feed`
**Linear project:** `https://linear.app/andrewnord/project/bluesky-corgi-8f5a0fc7a693`
**ChatPRD:** `https://app.chatprd.ai/chat/5d8a99e4-5871-4118-b3cb-77024ee37421?doc=60435cf8-353b-4548-bc95-c358cc8cfbb6`

---

## 2. Why It Exists

Before this project, Bluesky custom feeds were opaque ranking systems controlled
by a single operator. There was no mechanism for subscribers to influence how
posts are ranked. This feed exists to:

- Let subscribers vote on algorithm weights through Polis-style governance
  epochs. Five scoring components (recency, engagement, bridging, source
  diversity, relevance) are weighted by community vote.
- Provide full transparency: every score is decomposed into raw, weight, and
  weighted values, persisted per post per epoch, and exposed through public
  transparency endpoints.
- Serve as a research instrument for studying algorithmic governance on
  decentralized social networks, with IRB-ready consent flows, research gating,
  and anonymized export.
- Demonstrate that community-governed recommendation algorithms are viable at
  production scale on AT Protocol.

---

## 3. System Shape

```text
                       Bluesky Network (AT Protocol)
                                |
                       Jetstream WebSocket
                        (public firehose)
                                |
                                v
            +-----------------------------------------+
            |          Fastify HTTP Server             |
            |  XRPC feed endpoints (AT Protocol)       |
            |  Governance APIs (vote, epochs, weights)  |
            |  Admin APIs (health, interactions, export) |
            |  Transparency APIs (explanations, stats)  |
            |  MCP server (Streamable HTTP)             |
            |  Bot server (announcements)               |
            +-----------------------------------------+
                    |              |              |
                    v              v              v
          +-----------+  +--------------+  +------------+
          | PostgreSQL |  |    Redis     |  |  Scoring   |
          | 16 (posts, |  | 7 (feed:curr |  |  Pipeline  |
          | scores,    |  |  snapshots,  |  | (batch/5m) |
          | epochs,    |  |  sessions)   |  | 5 scoring  |
          | votes,     |  |              |  | components |
          | audit)     |  |              |  +------------+
          +-----------+  +--------------+
                                          +------------+
                                          | React 19   |
                                          | Vite 7     |
                                          | Dashboard  |
                                          | Voting UI  |
                                          +------------+
```

**Runtime:** Node.js 20, TypeScript 5, Fastify 5
**Data layer:** PostgreSQL 16 (posts, scores, governance, audit), Redis 7 (feed
cache, sessions)
**Frontend:** React 19, Vite 7 (transparency dashboard, voting UI)
**Protocol:** `@atproto/api`, `@atproto/xrpc-server`
**NLP:** winkNLP (topic classification at ingestion), HuggingFace Transformers
(embedding-based classification)
**Deploy target:** DigitalOcean VPS via systemd + nginx reverse proxy
**Container:** Multi-stage Docker build (node:20-alpine)

---

## 4. Key Files and Directories

| Path | Purpose |
|------|---------|
| `src/index.ts` | Entry point; boots Fastify server with all plugins and routes |
| `src/config.ts` | Centralized config with Zod-validated env vars |
| `src/ingestion/jetstream.ts` | WebSocket connection to Bluesky Jetstream firehose |
| `src/ingestion/embedding-gate.ts` | Single-post embedding classifier (at ingestion time) |
| `src/scoring/pipeline.ts` | 5-component scoring pipeline and Redis population (batch every 5 min) |
| `src/scoring/` | Individual scoring components: recency, engagement, bridging, source-diversity, relevance |
| `src/feed/` | AT Protocol XRPC feed skeleton endpoint with cursor pagination |
| `src/governance/` | Epoch lifecycle, vote submission, trimmed-mean aggregation, content rules |
| `src/transparency/` | Public endpoints: score explanations, counterfactuals, feed-level stats, audit log |
| `src/admin/routes/` | Admin APIs: governance controls, feed health, interactions, participants, export |
| `src/bot/` | Bluesky bot agent for governance announcements |
| `src/auth/admin.ts` | Admin DID allowlist session auth |
| `src/db/` | PostgreSQL client, connection pool, migrations |
| `src/mcp/` | MCP server (Streamable HTTP) for programmatic admin tooling |
| `src/scheduler/` | Cron-based scheduler for recurring jobs (scoring, health) |
| `src/lib/` | Shared utilities (logging, metrics, rate limiting) |
| `src/maintenance/` | Operational maintenance routines |
| `src/legal/` | Terms of service and privacy policy content |
| `web/` | React + Vite frontend (dashboard, voting UI, transparency views) |
| `cli/` | CLI tool (`feed-cli`) for admin operations from any terminal |
| `scripts/` | Setup, migration, seed, publish-feed, report generation scripts |
| `tests/` | Unit, integration, and stress tests (Vitest) |
| `docs/` | Deployment, ops runbook, security, system overview, stability tests |
| `legal/` | Terms of Service, Privacy Policy documents |
| `Dockerfile` | Multi-stage production Docker build |
| `docker-compose.prod.yml` | Production PostgreSQL + Redis containers |
| `.github/workflows/` | CI, deploy, daily health, weekly export, docs deploy, security gates |
| `ops/` | Operational scripts and automation |

---

## 5. Build / Test / Run Commands

```bash
# Install dependencies (backend + frontend)
npm install
cd web && npm install && cd ..

# Build (TypeScript -> dist/)
npm run build

# Run tests
npm test             # single run (vitest --run)
npm run stress       # stress tests

# Development server (tsx watch, auto-reload)
npm run dev

# Frontend dev server (separate terminal)
cd web && npm run dev

# Production start (requires prior build)
npm start

# Database migrations
npm run migrate

# Seed initial governance epoch
npx tsx scripts/seed-governance.ts

# Publish feed record to Bluesky
npm run publish-feed

# Full verify (build + test + cli + mcp + web lint + web build)
npm run verify

# Docs verification
npm run docs:verify

# CLI usage
npm run cli -- login your-handle.bsky.social xxxx-xxxx-xxxx-xxxx
npm run cli -- epoch status
npm run cli -- feed health
npm run cli -- --help
```

**Pre-commit hooks** (installed via `husky` + `lint-staged`):
- `.husky/pre-commit` runs `npx lint-staged`
- `lint-staged.config.js` currently type-checks staged TypeScript files via `tsc --noEmit`
- There is no local `.husky/commit-msg` hook; Linear key and identity enforcement happen in CI / org policy checks

---

## 6. Deploy and Rollback Notes

### Production deploy path

1. Push to `main` (squash merge only).
2. The `deploy.yml` workflow SSHs to the DigitalOcean VPS and deploys.
3. Manual deploy alternative:

   ```bash
   cd /opt/bluesky-feed
   git fetch origin
   git checkout main
   git pull --ff-only origin main
   npm install --no-audit --no-fund
   npm run build
   npm run migrate
   sudo systemctl restart bluesky-feed
   ```

4. Verify: `curl https://feed.corgi.network/health`

### Docker deploy (alternative)

```bash
docker build -t bluesky-feed .
docker run -d --name bluesky-feed --env-file .env -p 3000:3000 bluesky-feed
```

### Rollback

```bash
cd /opt/bluesky-feed
git fetch origin
git checkout <known-good-sha-or-tag>
npm install --no-audit --no-fund
npm run build
npm run migrate
sudo systemctl restart bluesky-feed
```

Notes:
- DB migrations are forward-only by default. For destructive rollback, restore
  from backup first in a controlled maintenance window.
- Backups run daily at 02:00 UTC via cron (`/home/corgi/backup-corgi.sh`),
  retention: latest 5, compressed backups removed after 14 days.

### Infrastructure containers

PostgreSQL and Redis run via Docker Compose on the VPS:

```bash
cd /opt/bluesky-feed
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

### CI/CD workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR, push to main | Build, test, lint, security audit |
| `deploy.yml` | Push to main | SSH deploy to VPS |
| `deploy-docs.yml` | Push to main (docs-site changes) | Deploy API docs to `docs.corgi.network` |
| `daily-health.yml` | Cron (daily) | Health check, creates incident issue on failure |
| `weekly-export.yml` | Cron (weekly) | Anonymized research data export |
| `docs-freshness.yml` | Cron | Doc staleness detection |

See `docs/OPERABILITY.md`, `docs/runbooks/operator-quickstart.md`, and
`docs/runbooks/incident-response.md` for the canonical operational procedures.

---

## 7. Linked Deeper Docs

| Document | Path |
|----------|------|
| Architecture | `docs/ARCHITECTURE.md` |
| Operability / release procedures | `docs/OPERABILITY.md` |
| Operator quickstart | `docs/runbooks/operator-quickstart.md` |
| Incident response | `docs/runbooks/incident-response.md` |
| ADR index | `docs/adr/README.md` |
| Product requirements / strategy | `docs/PRD.md` |
| Legacy system overview | `docs/SYSTEM_OVERVIEW.md` |
| Deployment guide | `docs/DEPLOYMENT.md` |
| Legacy operations runbook | `docs/OPS_RUNBOOK.md` |
| Security model and audit | `docs/SECURITY.md`, `docs/SECURITY_AUDIT.md` |
| Stability and load testing | `docs/STABILITY_TEST.md` |
| MCP setup guide | `docs/MCP_SETUP.md` |
| Issue triage | `docs/ISSUE_TRIAGE.md` |
| Versioning and releases | `docs/VERSIONING.md`, `RELEASING.md` |
| Product roadmap | `ROADMAP.md` |
| Contributing guide | `CONTRIBUTING.md` |
| Changelog | `CHANGELOG.md` |
| Code of conduct | `CODE_OF_CONDUCT.md` |
| Support channels | `SUPPORT.md` |
| Legal (ToS, Privacy) | `legal/` |
| OpenAPI spec | `docs/openapi-public.json` |
| API reference (live) | `https://docs.corgi.network` |

### Doc Compliance Tracker (production_service)

| Required Doc | Canonical Path | Status | Notes |
|--------------|----------------|--------|-------|
| readme | `README.md` | Exists | Canonical entry point for repo overview and setup |
| repo_contract | `docs/agent/REPO_CONTRACT.md` | Exists | Added in this PR |
| architecture | `docs/ARCHITECTURE.md` | Exists | Added in this PR |
| operator_runbook | `docs/runbooks/operator-quickstart.md` | Exists | Added in this PR |
| incident_runbook | `docs/runbooks/incident-response.md` | Exists | Added in this PR |
| release_operability | `docs/OPERABILITY.md` | Exists | Added in this PR |
| adr_index | `docs/adr/README.md` | Exists | Added in this PR; no ADR files tracked yet |
| prd_or_strategy | `docs/PRD.md` | Exists | Added in this PR |
| contributing | `CONTRIBUTING.md` | Exists | Repo-local contribution guide already tracked |

---

## 8. Known Gotchas

1. **Squash-only merges.** The org enforces squash merges. Using `--merge` or
   `--rebase` will be blocked by policy checks.

2. **Linear key required everywhere.** Branch names must follow
   `dev/<LINEAR-KEY>-<slug>`. PR titles must include `[KEY]`. Commit messages
   must contain a Linear key. Enforcement happens in org-policy / CI checks and
   any local hook configuration that may be installed by the workspace.

3. **Two install targets.** Backend and frontend have separate `node_modules`.
   Run `npm install` at repo root AND `cd web && npm install` for the frontend.
   The `npm run verify` command covers both.

4. **PostgreSQL port offset in production.** Docker Compose binds PostgreSQL to
   `127.0.0.1:5433` (not standard 5432) and Redis to `127.0.0.1:6380` (not
   6379) to avoid conflicts with system installs. Ensure `DATABASE_URL` and
   `REDIS_URL` in `.env` match these port mappings.

5. **Scoring pipeline runs every 5 minutes.** New posts are ingested
   continuously via Jetstream but scores are only recalculated in batch. If the
   feed looks stale after deploying, wait for the next scoring cycle or trigger
   a manual rescore via `npm run cli -- feed rescore`.

6. **Governance epoch transitions.** Epochs require a minimum vote threshold
   before trimmed-mean aggregation kicks in (10 votes). Below that threshold,
   weights remain at their prior values. New epochs must be seeded via
   `npx tsx scripts/seed-governance.ts` on a fresh database.

7. **Append-only audit log.** The `governance_audit_log` table is DB-enforced
   append-only (no edits, no deletes). Do not attempt to modify it in
   migrations.

8. **Jetstream reconnection.** The Jetstream WebSocket client automatically
   reconnects with cursor persistence (saved every 1000 events). If ingestion
   gaps appear, check cursor state and restart the service.

9. **DID requirement.** The feed generator must use `did:plc` (not `did:web`).
   Run `npm run generate-feed-did` to resolve DIDs during initial setup.

10. **VPS file paths.** Production uses `/opt/bluesky-feed/` as working
    directory. The systemd unit file is `bluesky-feed.service`.

11. **Public repo workflow exception.** This repository is public while the org
    control-plane repo (`andrewnordstrom-eng/.github`) is private. Reusable
    workflows from that private repo cannot be relied on here, so
    `coderabbit-freshness` and `coderabbit-thread-check` are intentionally
    implemented locally in `.github/workflows/` rather than inherited by
    reference. Keep `.coderabbit.yaml` `reviews.auto_review.auto_incremental_review`
    enabled so the freshness gate receives a fresh non-skipped CodeRabbit signal
    on the latest push.

---

## 9. Where to Get Live State

| What | How |
|------|-----|
| Health check | `GET https://feed.corgi.network/health` |
| Readiness probe | `GET https://feed.corgi.network/health/ready` |
| Liveness probe | `GET https://feed.corgi.network/health/live` |
| Feed describe | `GET https://feed.corgi.network/xrpc/app.bsky.feed.describeFeedGenerator` |
| Transparency stats | `GET https://feed.corgi.network/api/transparency/stats` |
| Current governance weights | `GET https://feed.corgi.network/api/governance/weights` |
| Service status (VPS) | `sudo systemctl status bluesky-feed` |
| Service logs (VPS) | `sudo journalctl -u bluesky-feed -f` |
| Infra containers | `cd /opt/bluesky-feed && docker compose -f docker-compose.prod.yml ps` |
| Database backups | `/home/corgi/backups/` on VPS |
| Disk/service alerts | `sudo journalctl -t bluesky-disk-alert -n 100 --no-pager` |
| Retention/cleanup logs | `sudo journalctl -t bluesky-ops-retention -n 100 --no-pager` |
| Linear project board | `https://linear.app/andrewnord/project/bluesky-corgi-8f5a0fc7a693` |
| API documentation (live) | `https://docs.corgi.network` |
