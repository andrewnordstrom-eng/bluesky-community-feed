# Releasing

This project uses Semantic Versioning (`MAJOR.MINOR.PATCH`) and Keep a Changelog.

## Versioning Policy

- `PATCH` for bug fixes, docs-only operational fixes, and non-breaking dependency/security updates.
- `MINOR` for backward-compatible feature additions and new endpoints/tooling.
- `MAJOR` for breaking API/behavior changes or migration-required operator changes.

## Changelog Gate

Any user-visible, operator-visible, or contributor-visible change must add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) before merge.

Allowed omission:
- Internal refactors with zero observable behavior/tooling/docs impact.

## Pre-Release Checklist

Run from repository root:

```bash
npm run verify
python3 -m py_compile scripts/generate-report.py scripts/generate-report-pdf.py scripts/report_utils.py
MPLCONFIGDIR=/tmp python3 scripts/generate-report.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run
MPLCONFIGDIR=/tmp python3 scripts/generate-report-pdf.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run
npm audit --audit-level=moderate
cd web && npm audit --audit-level=moderate
```

## Release Procedure

1. Ensure `main` is green and branch protections are satisfied.
2. Confirm `CHANGELOG.md` has accurate `Unreleased` entries.
3. Create release PR (if needed) that:
   - bumps version(s),
   - moves `Unreleased` notes into a dated version section,
   - includes any migration/rollout notes.
4. Merge release PR into `main`.
5. Tag release from `main`:

```bash
git checkout main
git pull
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

6. Publish GitHub release notes from the tag and include:
   - highlights,
   - migration notes,
   - rollback considerations.

## Cadence

- Target cadence: at least one release per month.
- Hotfix releases can happen any time for incidents/security issues.
