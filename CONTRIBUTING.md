# Contributing

## Development Setup

1. Install dependencies:
```bash
npm install
cd web && npm install && cd ..
```
2. Configure environment:
```bash
cp .env.example .env
```
3. Start services:
```bash
docker compose up -d
```
4. Run migrations:
```bash
npm run migrate
```

## Useful Commands

- Build backend: `npm run build`
- Run backend tests: `npm test`
- Build frontend: `cd web && npm run build`
- Run frontend dev server: `cd web && npm run dev`

## Project Structure

- `src/ingestion/`: Jetstream ingestion
- `src/scoring/`: scoring components + pipeline
- `src/governance/`: voting, aggregation, epoch lifecycle
- `src/feed/`: feed generator routes
- `src/admin/`: admin routes and status
- `src/transparency/`: public transparency APIs
- `web/`: React frontend

## Contribution Guidelines

- Keep core governance invariants intact (decomposed scores, epoch tagging, soft deletes)
- Add or update tests for behavior changes
- Avoid adding external API calls in feed serving paths
- Keep changes scoped and easy to review

## Adding A Votable Weight

1. Update backend parameter config in `src/config/votable-params.ts`.
2. Add any required schema/migration changes for new vote columns.
3. Wire scoring/aggregation consumers that depend on the new field.
4. Update frontend parameter config in `web/src/config/votable-params.ts`.
5. Run full verification (`npm run build`, `npm test`, `cd web && npm run build`).

## Pull Request Checklist

- `npm run verify` passes
- `python3 -m py_compile scripts/generate-report.py scripts/generate-report-pdf.py scripts/report_utils.py` passes
- `MPLCONFIGDIR=/tmp python3 scripts/generate-report.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run` passes
- `MPLCONFIGDIR=/tmp python3 scripts/generate-report-pdf.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run` passes
- `npm audit --audit-level=moderate` passes
- `cd web && npm audit --audit-level=moderate` passes
- Migrations included for schema changes
- Notes included for operational or rollout impact
