# Architecture — bluesky-community-feed

Status: canonical service architecture
Owner: bluesky-feed
Service class: production_service
Last updated: 2026-04-05

## System Purpose

`bluesky-community-feed` is a production custom-feed system for Bluesky where
community voting changes how posts are ranked. The durable architecture must
support three things at once: real-time feed serving, auditable governance, and
research-grade transparency.

## Architecture Overview

The system has four major surfaces:

1. **Ingestion**: Jetstream/WebSocket ingestion brings public Bluesky events into
   PostgreSQL.
2. **Scoring**: a batch scoring pipeline recomputes the ranked feed using five
   governance-weighted components and stores full score decomposition.
3. **Serving**: Fastify exposes AT Protocol XRPC endpoints plus transparency,
   governance, admin, and export APIs; Redis serves the current feed snapshot
   with low latency.
4. **Interaction**: the React/Vite dashboard, voting UI, CLI, and MCP server
   operate on the same backend state instead of forking separate admin planes.

## Core Data Flow

- Jetstream ingestion writes posts, interactions, follows, and cursor state into
  PostgreSQL.
- Governance votes create epoch state and weight distributions.
- The scoring pipeline runs on a schedule, computes component/raw/weighted values
  for each post, and writes both persistence and Redis feed snapshots.
- Bluesky clients request `getFeedSkeleton`; the service reads Redis and returns
  ranked post URIs quickly.
- Transparency and admin surfaces read the same persisted score and governance
  data, so every ranking decision can be decomposed and explained.

## Key Paths

- `src/ingestion/`: Jetstream/firehose ingestion and classification
- `src/scoring/`: component analyzers and score pipeline
- `src/governance/`: epoch lifecycle, vote intake, trimmed-mean aggregation
- `src/feed/`: XRPC feed generator endpoints
- `src/transparency/`: explanations, counterfactuals, audit views
- `src/admin/routes/`: protected operational/admin endpoints
- `src/mcp/`: programmatic admin interface for agents/tools
- `web/`: React/Vite dashboard and voting UI
- `cli/`: operator CLI
- `docs/SYSTEM_OVERVIEW.md`, `docs/OPS_RUNBOOK.md`, `docs/DEPLOYMENT.md`: deeper operational references

## External Dependencies

- Bluesky / AT Protocol (`@atproto/api`, XRPC feed generator contract)
- PostgreSQL for durable product, governance, and audit data
- Redis for active feed snapshots and fast-serving state
- GitHub Actions + VPS deployment flow for release automation

## Invariants

- Governance data must remain auditable; the audit log is append-only.
- Feed ranking must always be explainable from persisted raw/weight/weighted
  component values.
- Redis is a performance layer, not the sole source of truth.
- The public feed surface and the transparency/admin surfaces must agree on the
  current epoch and ranking state.
