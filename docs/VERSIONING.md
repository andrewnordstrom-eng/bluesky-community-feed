# Versioning

Semantic versioning (semver). Tag on `main` after each sprint or milestone merge.

## Version Bumps

- **MAJOR** (2.0.0): Breaking API changes, governance model redesign, schema migrations that require data migration from consumers (e.g., adding a 6th scoring component changes the weight sum constraint)
- **MINOR** (1.3.0): New features, new scoring components, new admin endpoints, new ML capabilities — anything additive that doesn't break existing consumers
- **PATCH** (1.2.1): Bug fixes, config changes, dependency updates, doc updates

## Tagging

After merging a sprint's work to main:

```bash
git tag -a v1.2.0 -m "Embedding classifier, URL dedup, classification tracking"
git push origin v1.2.0
```

The dev journal entry for the merge commit should note the version tag.

## Upcoming Version Map

| Version | Milestone |
|---------|-----------|
| v1.3.0 | Governance parameter registry |
| v1.4.0 | ML Phase 1 — infrastructure (sidecar, model registry, autonomy modes) |
| v1.5.0 | ML Phase 2 — prescreener |
| v2.0.0 | ML Phase 3 — 6th scoring component (quality) — breaking: weight sum constraint changes from 5→6 |
| v2.1.0 | ML Phase 4 — weight tuning bandit |

## Release History

| Version | Date | Highlights |
|---------|------|------------|
| v1.0.0 | 2026-03-06 | Initial release: 5-component scoring, governance voting, topic engine, security audit |
| v1.1.0 | 2026-03-08 | Ingestion gate, media filter, relevance floor, Jetstream throughput fix |
| v1.2.0 | 2026-03-09 | Embedding at ingestion, confidence multiplier, URL dedup, classification tracking |
