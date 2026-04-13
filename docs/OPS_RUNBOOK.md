# Operations Runbook

This runbook covers day-2 operations for the production Bluesky feed stack.
It is written for the current VPS deployment model and can be adapted for other hosts.

## Scope

- Service lifecycle and deploy procedure
- Health checks and smoke tests
- Backup/retention and disk management
- Alerting and incident response

## Production Topology

- App service: `bluesky-feed.service` (systemd)
- App directory: `/opt/bluesky-feed`
- Backend runtime: `node dist/index.js`
- Redis + PostgreSQL: Docker Compose (`docker-compose.prod.yml`)
- PostgreSQL container: `bluesky-feed-postgres` on `127.0.0.1:5433`
- Redis container: `bluesky-feed-redis` on `127.0.0.1:6380`

## Primary Commands

```bash
# Service status and logs
sudo systemctl status bluesky-feed --no-pager
sudo journalctl -u bluesky-feed -n 200 --no-pager
sudo journalctl -u bluesky-feed -f

# Infra containers
cd /opt/bluesky-feed
docker compose -f docker-compose.prod.yml ps

# Disk and memory quick checks
df -h /
free -h
```

## Standard Deploy (main branch)

```bash
cd /opt/bluesky-feed
git fetch origin
git checkout main
git pull --ff-only origin main
npm install --no-audit --no-fund
npm run build
npm run migrate
sudo systemctl restart bluesky-feed
sudo systemctl is-active bluesky-feed
```

## Post-Transfer Validation (Manual Dispatch)

Use this after repository ownership transfer and for recurring manual verification.
This project intentionally uses a deploy-only model for ongoing checks (no extra scheduled smoke workflow).

Set the repo target once:

```bash
REPO="andrewnordstrom-eng/bluesky-community-feed"
```

### 1) Verify required repository secrets

```bash
gh secret list --repo "$REPO"
```

Expected required names:
- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `DATABASE_URL`
- `EXPORT_ANONYMIZATION_SALT`

### 2) Trigger and watch required workflows on `main`

```bash
# CI
gh workflow run "CI" --repo "$REPO" --ref main
gh run watch "$(gh run list --repo "$REPO" --workflow "CI" --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --repo "$REPO" --exit-status

# Deploy Docs
gh workflow run "Deploy Docs" --repo "$REPO" --ref main
gh run watch "$(gh run list --repo "$REPO" --workflow "Deploy Docs" --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --repo "$REPO" --exit-status

# Deploy to VPS
gh workflow run "Deploy to VPS" --repo "$REPO" --ref main
gh run watch "$(gh run list --repo "$REPO" --workflow "Deploy to VPS" --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --repo "$REPO" --exit-status

# Daily Health Check
gh workflow run "Daily Health Check" --repo "$REPO" --ref main
gh run watch "$(gh run list --repo "$REPO" --workflow "Daily Health Check" --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --repo "$REPO" --exit-status

# Weekly Research Export
gh workflow run "Weekly Research Export" --repo "$REPO" --ref main
gh run watch "$(gh run list --repo "$REPO" --workflow "Weekly Research Export" --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --repo "$REPO" --exit-status
```

Expected pass criteria:
- Each workflow concludes with `success`.
- `Daily Health Check` creates no incident issue when the run passes.
- `Weekly Research Export` uploads the expected CSV artifacts.

### 3) Validate live runtime endpoints

```bash
curl -sS https://feed.corgi.network/health
curl -sSI https://docs.corgi.network/
```

Expected:
- feed health returns `{"status":"ok"}`.
- docs endpoint returns `200`.

### Post-deploy smoke test

```bash
curl -sS http://localhost:3001/health
curl -sS http://localhost:3001/health/ready
curl -sS http://localhost:3001/health/live

curl -sS "http://localhost:3001/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://<PUBLISHER_DID>/app.bsky.feed.generator/community-gov&limit=10"

# Validation behavior checks
curl -i "http://localhost:3001/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://<PUBLISHER_DID>/app.bsky.feed.generator/community-gov&limit=0"
curl -i "http://localhost:3001/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://<PUBLISHER_DID>/app.bsky.feed.generator/community-gov&cursor=invalid"
```

Expected:
- health endpoints return healthy/ready/live
- feed skeleton returns posts + cursor
- invalid pagination inputs return `400 ValidationError`

## Backup and Retention

### DB backups

- Script: `/opt/backups/daily-backup.sh`
- Schedule (root crontab): `0 3 * * * /opt/backups/daily-backup.sh >> /opt/backups/backup.log 2>&1`
- Output dir: `/opt/backups/postgres`
- Retention policy:
  - keep only the latest 5 valid `dump-YYYY-MM-DD.sql.gz` files
  - validate each PostgreSQL dump with `gzip -t` before it is retained
  - remove invalid/truncated `.sql.gz` dumps automatically
  - remove stale plain `.sql` files if any are left behind by an interrupted run

Quick verification:

```bash
sudo crontab -l
find /opt/backups/postgres -maxdepth 1 -type f -name 'dump-*.sql.gz' -printf '%f\n' | sort -r | nl
shopt -s nullglob
for dump in /opt/backups/postgres/dump-*.sql.gz; do sudo gzip -t "$dump"; done
shopt -u nullglob
tail -n 200 /opt/backups/backup.log
```

## Ops Retention and Alerting

### Retention/cleanup script

- Script: `/usr/local/bin/bluesky-ops-retention.sh`
- Schedule (root crontab): `30 3 * * *`
- Actions:
  - force logrotate attempt
  - vacuum systemd journal to 300MB
  - enforce PostgreSQL backup retention on `/opt/backups/postgres`
  - delete invalid/truncated PostgreSQL dumps before counting retained backups
  - prune unused docker containers/images (safe prune only)

### Disk/service alert script

- Script: `/usr/local/bin/bluesky-disk-alert.sh`
- Schedule (root crontab): `*/5 * * * *`
- Config: `/etc/default/bluesky-ops-alert`
  - `DISK_WARN_PCT` default `85`
  - `DISK_CRIT_PCT` default `92`
  - `ALERT_COOLDOWN_SEC` default `1800`
  - `ALERT_WEBHOOK_URL` optional
- Checks:
  - root filesystem usage
  - `bluesky-feed` service active
  - local `/health` endpoint reachable

Logs:

```bash
sudo journalctl -t bluesky-ops-retention -n 100 --no-pager
sudo journalctl -t bluesky-disk-alert -n 100 --no-pager
sudo grep -E "bluesky-ops-retention|bluesky-disk-alert" /var/log/syslog | tail -n 100
```

## Governance/Feed Integrity Spot Checks

Check current scoring run metadata:

```bash
psql "$DATABASE_URL" -At -c "SELECT value FROM system_status WHERE key='current_scoring_run';"
docker exec bluesky-feed-redis redis-cli get feed:run_id
docker exec bluesky-feed-redis redis-cli get feed:epoch
docker exec bluesky-feed-redis redis-cli zcard feed:current
```

Top-ranked URI consistency check:

```bash
TOP_REDIS=$(docker exec bluesky-feed-redis redis-cli zrevrange feed:current 0 0)
TOP_DB=$(psql "$DATABASE_URL" -At -c "WITH run AS (SELECT value->>'run_id' AS run_id, (value->>'epoch_id')::int AS epoch_id FROM system_status WHERE key='current_scoring_run') SELECT post_uri FROM post_scores ps, run r WHERE ps.epoch_id=r.epoch_id AND ps.component_details->>'run_id'=r.run_id ORDER BY total_score DESC LIMIT 1;")
echo "redis=$TOP_REDIS"
echo "db=$TOP_DB"
```

`redis` and `db` top URIs should match.

## Incident Playbooks

### 1) Disk pressure (`/` above 92%)

1. Confirm usage:

```bash
df -h /
du -xhd1 /var | sort -h
du -xhd1 /opt | sort -h
du -xhd1 /opt/backups | sort -h
du -xhd1 /home/corgi | sort -h
```

1. Run retention:

```bash
sudo /usr/local/bin/bluesky-ops-retention.sh
```

1. Verify the backup directory contains only the latest 5 valid dumps:

```bash
find /opt/backups/postgres -maxdepth 1 -type f -name 'dump-*.sql.gz' -printf '%f\n' | sort -r | nl
shopt -s nullglob
for dump in /opt/backups/postgres/dump-*.sql.gz; do sudo gzip -t "$dump"; done
shopt -u nullglob
```

1. Re-check `df -h /`.

### 2) Feed stale or empty

1. Check app and health:

```bash
sudo systemctl status bluesky-feed --no-pager
curl -sS http://localhost:3001/health
```

1. Check feed keys:

```bash
docker exec bluesky-feed-redis redis-cli zcard feed:current
docker exec bluesky-feed-redis redis-cli get feed:updated_at
```
1. Trigger manual rescore from admin UI.
1. Check logs for scoring errors:

```bash
sudo journalctl -u bluesky-feed -n 300 --no-pager | grep -Ei "scoring|error|redis|postgres"
```

### 3) Jetstream disconnected

1. Check health payload (`jetstream.connected`).
1. Inspect logs:

```bash
sudo journalctl -u bluesky-feed -n 300 --no-pager | grep -Ei "jetstream|websocket|reconnect"
```
1. Restart service if needed:

```bash
sudo systemctl restart bluesky-feed
```

### 4) PostgreSQL/Redis unavailable

1. Check container state:

```bash
cd /opt/bluesky-feed
docker compose -f docker-compose.prod.yml ps
```
1. Start infra if down:

```bash
docker compose -f docker-compose.prod.yml up -d postgres redis
```
1. Validate DB/Redis:

```bash
docker exec bluesky-feed-postgres pg_isready -U feed -d bluesky_feed
docker exec bluesky-feed-redis redis-cli ping
```
1. Restart app:

```bash
sudo systemctl restart bluesky-feed
```

## Rollback Procedure

If a deploy introduces a runtime regression:

```bash
cd /opt/bluesky-feed
git fetch origin
git checkout <known-good-sha-or-tag>
npm install --no-audit --no-fund
npm run build
npm run migrate
sudo systemctl restart bluesky-feed
```

Notes:
- DB migrations are forward-only by default.
- For destructive rollback needs, restore from backup first in a controlled maintenance window.

## Ownership and Review

- Update this file whenever:
  - service names/paths change
  - cron schedules change
  - backup retention policy changes
  - alert thresholds or channels change
- Review quarterly as part of security/ops audits.
