# Operator Quickstart — bluesky-community-feed

Status: canonical operator runbook
Owner: bluesky-feed
Last updated: 2026-04-05

## Fast Path

1. Check service health:
   - `sudo systemctl status bluesky-feed --no-pager`
   - `curl -sS https://feed.corgi.network/health`
2. Check runtime dependencies:
   - `cd /opt/bluesky-feed && docker compose -f docker-compose.prod.yml ps`
3. Verify feed integrity:
   - `curl -sS "https://feed.corgi.network/xrpc/app.bsky.feed.describeFeedGenerator"`
4. If deploy-related, inspect the latest GitHub Actions deploy and journal logs.

## Health Checks

- Public health: `https://feed.corgi.network/health`
- Local health: `http://localhost:3001/health`
- Docs site: `https://docs.corgi.network/`
- Feed endpoint: `app.bsky.feed.getFeedSkeleton`
- systemd logs: `sudo journalctl -u bluesky-feed -n 200 --no-pager`

## Key Commands

- Service logs: `sudo journalctl -u bluesky-feed -f`
- Deploy locally on VPS:
  `git fetch origin && git checkout main && git pull --ff-only origin main && npm install --no-audit --no-fund && npm run build && npm run migrate && sudo systemctl restart bluesky-feed`
- Container status: `docker compose -f docker-compose.prod.yml ps`
- Backup verification:
  `find /mnt/host-backups/postgres -maxdepth 1 -type f -name 'dump-*.sql.gz' -printf '%f\n' | sort -r | nl`

## When To Go Deeper

Use `docs/OPS_RUNBOOK.md` for disk pressure, stale feed, backup, and workflow
validation procedures. Use `docs/runbooks/incident-response.md` when the service
is degraded rather than just being checked.
