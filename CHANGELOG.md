# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Topic scoring engine: winkNLP-based topic classification at ingestion time
- Community topic weight voting (boost/penalize topics via governance)
- Bluesky content label filtering (replaces keyword-based NSFW exclusion)
- Topic taxonomy with co-occurrence disambiguation

## [1.1.0] — 2026-03-06

### Added
- Admin CLI tool (`feed-cli`) with 7 command groups covering all admin operations
- MCP server with 23 admin tools via Streamable HTTP for programmatic management
- Research data export API: votes, scores, engagement, epochs, audit log (CSV/JSON)
- Deterministic DID anonymization for research exports (`EXPORT_ANONYMIZATION_SALT`)
- Weekly automated research export via GitHub Actions
- Daily governance health check workflow

### Changed
- CLI authenticates via same session system as dashboard (no VPS credentials required)
- MCP endpoint at `/mcp` with Bearer token auth (same admin DID allowlist)

## [1.0.0] — 2026-03-06

### Added
- Community governance with epoch-based weight voting
- Five scoring components: recency, engagement, bridging, source diversity, relevance
- Modular scoring component interface for pluggable algorithms
- Bluesky `acceptsInteractions` support (See More / See Less feedback buttons)
- Private feed access gating with approved participant management
- Admin dashboard: governance controls, feed health, interactions, announcements, audit log
- Interaction tracking: feed requests, scroll depth, engagement attribution
- OpenAPI documentation at `/docs` (Swagger UI)
- Pre-commit hooks (husky + lint-staged + TypeScript checking)
- Dependabot for automated dependency updates (npm + GitHub Actions)
- Shared API types between frontend and backend (`src/shared/`)
- Code generators for scoring components and routes
- Transparency endpoints: per-post explanations, counterfactuals, feed statistics
- Bot integration for governance epoch announcements
- Score decomposition: 15 numeric columns per post per epoch (raw, weight, weighted × 5)
- Append-only audit log with DB-enforced immutability
- Jetstream ingestion with cursor persistence and automatic reconnection
- Research consent flow with Terms of Service and Privacy Policy
- 185+ tests (unit, integration, stress) with CI enforcement
- Docker deployment with GitHub Actions CI/CD
