# Operability — bluesky-community-feed

Status: canonical operability doc
Owner: bluesky-feed
Service class: production_service
Last updated: 2026-04-12

## Release Path

The canonical release path is `main` → GitHub Actions deploy → VPS verification.

- CI validates backend, frontend, docs, and security lanes before deploy.
- `deploy.yml` handles the normal production update path to the VPS.
- Manual fallback remains documented in `docs/OPS_RUNBOOK.md` for direct systemd
  and Docker Compose operations on `/opt/bluesky-feed`.

## Rollback

- Fast rollback is a known-good git revision on the VPS plus rebuild/restart.
- If the issue is data-shape-related, restore PostgreSQL from the latest backup
  before replaying migrations.
- Redis can be rebuilt from persisted scoring state; PostgreSQL is the source of
  truth for durable feed and governance state.

## Monitoring And Alerting

Primary checks:

- `GET /health`, `/health/ready`, `/health/live`
- feed skeleton and feed describe endpoints
- `bluesky-feed` systemd service status and journal logs
- Redis feed keys (`feed:current`, run/epoch markers) and PostgreSQL scoring run
  metadata

Supporting ops signals:

- disk/service alert script
- retention/cleanup script
- Daily Health Check and Weekly Research Export workflows
- docs deployment checks for `docs.corgi.network`

## Backups And Recovery

- PostgreSQL backups run daily via `/opt/backups/daily-backup.sh`
- `/opt/backups` is a script/log location for cron compatibility, not a backup
  data root
- backup artifacts land on the dedicated mounted backup tier at
  `/mnt/host-backups/postgres`
- the retained PostgreSQL dump must pass `gzip -t` before it is moved into
  `/mnt/host-backups/postgres`
- retention keeps only the latest 5 valid PostgreSQL dumps and removes
  invalid/truncated `.sql.gz` dumps automatically
- operational cleanup script rotates logs, vacuums journals, and prunes unused
  Docker artifacts while also enforcing the same PostgreSQL retention on
  `/mnt/host-backups/postgres`
- recovery should restore PostgreSQL first, then rebuild Redis/cache state from
  the application

## Canonical Runbooks

- `docs/OPS_RUNBOOK.md` for day-2 operations and live commands
- `docs/DEPLOYMENT.md` for deployment/bootstrap details
- `docs/runbooks/operator-quickstart.md` for the shortest safe operator flow
- `docs/runbooks/incident-response.md` for failure handling and evidence capture

## Governed ranking-worker activation

`PROCESS_ROLE=all` remains the rollback-compatible application default. The
tracked service files are not production activation by themselves. Installing
or starting `corgi-ranking-worker.service`, or replacing the installed API unit
with the tracked `PROCESS_ROLE=api` unit, requires the explicit PROJ-1769
production gate.

Pre-activation evidence must prove all of the following:

1. The VPS checkout matches the reviewed merge SHA and CI/deploy receipts are green.
2. `findmnt -n -o TARGET --target /mnt/host-backups` returns exactly
   `/mnt/host-backups`; the newest `dump-*.sql.gz` exists and passes `gzip -t`.
3. Additive migrations complete before either service is restarted.
4. `npm run verify`, `npm run sim:core`, lease failure injection, queue
   idempotency, and process-isolation tests pass at the reviewed SHA.
5. The existing Redis snapshot has 1,000 items and the Community Governed Feed
   XRPC probe succeeds before activation; Birders still returns disabled.
6. `RANKING_LEASE_TTL_MS` remains greater than `SCORING_TIMEOUT_MS`. A legacy
   pipeline timeout must quarantine the worker, retain and renew its lease, and
   advertise a failed heartbeat until that process is stopped; it must not
   claim replacement work in the same process.
7. Queue claims, stale recovery, heartbeat keys, and owned lease keys remain
   scoped to `RANKING_COMMUNITY_ID`; one feed must not consume or block another.

Activation order after approval:

1. Copy both reviewed unit files, run `systemctl daemon-reload`, and enable the
   worker. Do not delete or mutate the current Redis snapshot.
2. Start/restart `corgi-ranking-worker` first. Require an active unit and a
   fresh `corgi:ranking-worker:heartbeat:${RANKING_COMMUNITY_ID}` with a
   non-failed state. For example, a deployment configured with
   `RANKING_COMMUNITY_ID=future-feed` must check
   `corgi:ranking-worker:heartbeat:future-feed`, matching the worker and watchdog.
3. Restart `bluesky-feed` with `PROCESS_ROLE=api`. Require `/health/ready` and
   the XRPC feed probe to pass while the worker remains active.
4. Restart the worker while issuing feed requests; require zero serving errors
   and preservation of the prior snapshot.
5. Restart the API during an owned worker run; require the worker heartbeat and
   request claim to survive independently.
6. Confirm snapshot size/freshness, request state, service memory, restart
   counts, and warning/error journals independently for both units.

Immediate rollback is unit-level and does not require a database rollback:

1. Stop and disable `corgi-ranking-worker`.
2. Restore the previous installed `bluesky-feed.service` or remove its
   `PROCESS_ROLE=api` setting so the default `all` role resumes.
3. Run `systemctl daemon-reload` and restart `bluesky-feed`.
4. Confirm the last-known-good Redis snapshot, API readiness, Community
   Governed Feed XRPC response, and disabled Birders behavior.

Forward-only additive migrations and ranking request rows may remain after this
rollback. Any destructive database rollback requires restore from the verified
backup in a controlled maintenance window.
