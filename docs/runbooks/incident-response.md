# Incident Response — bluesky-community-feed

Status: canonical incident runbook
Owner: bluesky-feed
Last updated: 2026-04-05

## Detect

Common failure signals:

- `/health` or `/health/ready` fails
- feed skeleton returns empty/stale data unexpectedly
- `bluesky-feed` systemd service is inactive or crash-looping
- Redis top-ranked feed state and PostgreSQL scoring-run state diverge
- disk pressure or cleanup alerts trip

## Contain

- Pause risky deploy or migration activity first.
- If the issue is application-level, stop at the service boundary:
  `sudo systemctl stop bluesky-feed`
- If the issue is cache corruption or stale feed snapshots, inspect Redis and the
  current scoring run before restarting the whole stack.
- Preserve evidence before cleanup: journal logs, workflow URLs, health output,
  DB/Redis state checks.

## Recover

- Restore a known-good app revision on the VPS and restart the service.
- If data corruption is suspected, restore PostgreSQL from backup before
  rebuilding Redis/cache state.
- Re-run smoke checks:
  `curl -sS http://localhost:3001/health`
  `curl -sS "http://localhost:3001/xrpc/app.bsky.feed.describeFeedGenerator"`
- Confirm public health once local checks pass.

## Evidence

Every incident should capture:

- service/journal output
- workflow run URLs or IDs
- health and feed endpoint results
- backup/restore actions taken
- the final verified state after recovery

The deeper command set for disk pressure, feed staleness, and backup validation
is in `docs/OPS_RUNBOOK.md`.
