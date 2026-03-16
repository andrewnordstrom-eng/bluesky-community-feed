## What does this PR do?

<!-- Brief description of the change and why it's needed. -->

## Area

<!-- Check the primary area(s) affected -->
- [ ] Scoring
- [ ] Feed
- [ ] Governance
- [ ] Admin / CLI / MCP
- [ ] Ingestion
- [ ] Transparency
- [ ] Frontend
- [ ] Database / Migrations
- [ ] Tests
- [ ] Docs
- [ ] Build / Config

## Checklist

- [ ] `npm run verify` passes
- [ ] `python3 -m py_compile scripts/generate-report.py scripts/generate-report-pdf.py scripts/report_utils.py` passes
- [ ] `MPLCONFIGDIR=/tmp python3 scripts/generate-report.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run` passes
- [ ] `MPLCONFIGDIR=/tmp python3 scripts/generate-report-pdf.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run` passes
- [ ] `npm audit --audit-level=moderate` passes
- [ ] `cd web && npm audit --audit-level=moderate` passes
- [ ] Migrations included for schema changes
- [ ] No hardcoded secrets, DIDs, or production domains
- [ ] Parameterized SQL only (no string interpolation)
- [ ] Scoring changes preserve full decomposition (raw, weight, weighted per component)
- [ ] `CHANGELOG.md` updated for user/operator-visible changes
- [ ] Notes included for operational or rollout impact

## Related Issues

<!-- Closes #123, Fixes #456 -->
