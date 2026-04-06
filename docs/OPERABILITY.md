# Operability — bluesky-community-feed

Status: canonical operability doc
Owner: bluesky-feed
Service class: production_service
Last updated: 2026-04-05

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

- PostgreSQL backups run daily via `/home/corgi/backup-corgi.sh`
- retention keeps the latest five DB backups and removes stale compressed files
  after 14 days
- operational cleanup script rotates logs, vacuums journals, and prunes unused
  Docker artifacts
- recovery should restore PostgreSQL first, then rebuild Redis/cache state from
  the application

## Canonical Runbooks

- `docs/OPS_RUNBOOK.md` for day-2 operations and live commands
- `docs/DEPLOYMENT.md` for deployment/bootstrap details
- `docs/runbooks/operator-quickstart.md` for the shortest safe operator flow
- `docs/runbooks/incident-response.md` for failure handling and evidence capture
