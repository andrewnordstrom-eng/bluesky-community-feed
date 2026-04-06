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

No ADR files are tracked here yet. When one of the decisions above changes
durable product behavior, add `ADR-0001-<slug>.md`, `ADR-0002-<slug>.md`, and so
on, then list them here.
