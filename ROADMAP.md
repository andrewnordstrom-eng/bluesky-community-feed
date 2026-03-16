# Roadmap

This roadmap is intentionally outcome-driven. Dates are directional and may shift based on production incidents, research priorities, and governance feedback.

## North Star

Make community-governed ranking credible at production scale:
- Reliable enough for daily use
- Transparent enough for public audit
- Rigorous enough for research publication

## 2026 Priorities

### Q2 2026 (Now)

- Governance reliability hardening
  - Enforce CI/security gates on every PR and `main` merge
  - Keep dependency risk at zero high/moderate in root + frontend
- Reporting and observability polish
  - Deterministic DOCX/PDF report generation with fixture-backed CI checks
  - Stable admin health and interaction analytics workflows
- Contributor experience
  - Tighten docs, release process, and issue triage policy

### Q3 2026 (Next)

- Governance product maturity
  - Parameter registry for controlled expansion of votable settings
  - Better policy ergonomics for topic/content voting outcomes
- Research workflow quality
  - Stronger export metadata and reproducibility guarantees
  - More benchmark datasets and evaluation scripts
- Performance
  - Reduce ingestion backpressure drop rate during peak Jetstream traffic
  - Improve frontend bundle splitting and first-load latency

### Q4 2026 (Later)

- Multi-feed experimentation
  - Optional side-by-side feed variants for governance experiments
- Experiment instrumentation
  - Deeper causal analysis support across epochs
- Operator ergonomics
  - More self-serve admin runbooks and incident automation

## Quality Bar

We consider a milestone complete only when:
- Required CI checks are green on PR and protected on `main`
- Security scanning is enabled and passing
- Build/test/lint/audit/infra smoke checks are reproducible by contributors
- Docs and changelog reflect the shipped behavior
