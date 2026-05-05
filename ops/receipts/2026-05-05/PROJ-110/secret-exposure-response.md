# PROJ-110 Secret Exposure Response

Date: 2026-05-05

## Incident Classification

This was a real credential exposure incident. A production `.env` inspection printed
secret values into the operator transcript. The exposed classes were treated as
compromised:

- PostgreSQL connection secret: rotated.
- Research export anonymization salt: rotated.
- Bluesky app password: revoked at provider, removed from active deployed env.
- Bot app password: removed from active deployed env; bot login disabled until a
  new app password is created out of band.

The following were also hardened because the service health gate was already red:

- GitHub Actions `VPS_SSH_KEY`: replaced with a fresh repo-level SSH key.
- GitHub Actions `VPS_SSH_HOST_KEY`: added so health checks use pinned host-key
  verification instead of first-use trust.

No raw secret values were intentionally recorded in this receipt.

## Containment Receipts

- Database/env rotation helper reported: `rotated keys: DATABASE_URL, POSTGRES_PASSWORD, EXPORT_ANONYMIZATION_SALT`.
- Root-only backup was created at `/root/bluesky-feed-secret-rotation-backups/.env.20260505T083505Z.incident-rotation`.
- Active env permissions after rotation: `/opt/bluesky-feed/.env` is `0600 root:root`.
- Previously world-readable `/opt/bluesky-feed/.env.backup` was moved to `/root/bluesky-feed-secret-rotation-backups/.env.backup.pre-incident` and chmodded `0600`.
- GitHub repository secrets updated by name/timestamp only:
  - `DATABASE_URL`: `2026-05-05T08:35:22Z`
  - `EXPORT_ANONYMIZATION_SALT`: `2026-05-05T08:35:32Z`
  - `VPS_HOST`: `2026-05-05T08:45:55Z`
  - `VPS_USER`: `2026-05-05T08:45:56Z`
  - `VPS_SSH_KEY`: `2026-05-05T08:45:58Z`
  - `VPS_SSH_HOST_KEY`: `2026-05-05T08:46:00Z`
- New SSH key local auth probe succeeded with explicit `-i`, `IdentitiesOnly=yes`, and `BatchMode=yes`.
- Bluesky app-password API receipt: `{"ok":true,"listedCount":1,"revokedNames":["Corgi"],"oldLoginRejected":true}`.
- Deployed env scrub receipt:
  - `BOT_ENABLED=false`
  - `BOT_APP_PASSWORD_empty=True`
  - `BSKY_APP_PASSWORD_placeholder=True`
  - Redis `bot:session` delete count: `1`
- Root-only scrub backup was created at `/root/bluesky-feed-secret-rotation-backups/.env.20260505T085242Z.bsky-app-password-scrub`.

## Runtime Receipts

- `systemctl show bluesky-feed`: `ActiveState=active`, `SubState=running`, `NRestarts=0`.
- Localhost probes after scrub/restart:
  - `/health/ready`: `{"status":"ready"}`
  - `/health/live`: `{"status":"live"}`
  - `/health`: `{"status":"ok"}` after startup scoring completed.
- Public probe after scrub/restart:
  - `https://feed.corgi.network/health`: HTTP `200`, body `{"status":"ok"}`.
- Hosted Daily Health Check:
  - First post-SSH-rotation run: `https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/runs/25366648561`, success.
  - Post-Bluesky-revoke/scrub run: `https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/runs/25366964265`, success.

## Residual Risk

- Bot posting is intentionally disabled until a new Bluesky app password is created
  through the Bluesky account UI and installed without exposing it to chat, logs,
  screenshots, or shell history.
- The feed service remains healthy without bot login. Logs show `Bot is disabled,
  skipping initialization`.
- Jetstream saturation/reconnect warnings existed after restart and should be
  tracked separately if they persist; they did not block readiness, public health,
  feed freshness, or the hosted Daily Health Check.

## Repo Hardening

- `scripts/sanitize-receipts.mjs` now redacts dotenv-style secret assignments and
  credential-bearing URLs.
- `tests/sanitize-receipts.test.ts` includes RED/GREEN coverage for the exact
  exposure pattern.
- `docs/SECURITY.md` now instructs operators to inspect deployed env key names
  only and run receipt verification before committing evidence.
