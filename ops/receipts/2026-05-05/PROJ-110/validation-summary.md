# Validation Summary

Date: 2026-05-05

## Local Validation

- `git diff --check`: passed.
- `python3 -m json.tool ops/receipts/2026-05-05/PROJ-110/receipt_index.json`: passed.
- `python3 -m json.tool ops/receipts/2026-05-05/PROJ-110/security-ownership-summary.json`: passed.
- `npm test -- --run tests/sanitize-receipts.test.ts`: passed, `32` tests.
- `npm run docs:verify`: passed, `13` tracked docs and `23` markdown files scanned; receipt sanitizer checked `27` receipt files.
- `npm run build`: passed.
- `npm audit --audit-level=moderate`: passed, `0` vulnerabilities.
- `npm test -- --run` with non-secret dummy test env and normal localhost bind permissions: passed, `70` test files and `472` tests.

## Hosted Validation

- `Daily Health Check` after SSH credential rotation:
  `https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/runs/25366648561`,
  conclusion `success`.
- `Daily Health Check` after Bluesky app-password revocation and deployed env scrub:
  `https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/runs/25366964265`,
  conclusion `success`.

## Live Runtime Validation

- `bluesky-feed.service`: `ActiveState=active`, `SubState=running`, `NRestarts=0`.
- `http://127.0.0.1:3001/health/ready`: `{"status":"ready"}`.
- `http://127.0.0.1:3001/health/live`: `{"status":"live"}`.
- `http://127.0.0.1:3001/health`: `{"status":"ok"}` after startup scoring completed.
- `https://feed.corgi.network/health`: HTTP `200`, body `{"status":"ok"}`.
