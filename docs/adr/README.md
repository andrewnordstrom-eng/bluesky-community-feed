# ADR Index — bluesky-community-feed

Status: canonical ADR index
Owner: bluesky-feed
Last updated: 2026-04-05

This folder should record decisions that permanently shape governance integrity,
feed serving, and research posture.

## Decisions Worth Capturing

- Governance epochs and trimmed-mean aggregation as the ranking control model
- Redis snapshot serving with PostgreSQL as the durable source of truth
- Persisting decomposed scores for explainability rather than only total scores
- Supporting admin tooling through CLI and MCP on the same backend state
- Research/export boundaries and anonymization posture

## Current ADR Status

- [ADR-0001 — Extensible scoring components via a registry-driven, long-table-backed contract](ADR-0001-extensible-scoring-components.md) (Accepted, 2026-05-26)
  - Codifies the architectural shape that emerges from PROJ-814 through PROJ-820: registry-driven component contract, normalized long-table schema for per-component decomposition, `Record<>`-shaped types, `@corgi/feed-sdk` workspace package for external contributors.
