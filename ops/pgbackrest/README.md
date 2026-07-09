# pgBackRest setup runbook — PROJ-917

Status: **reviewed artifact, NOT live-tested.** Written and checked against
the pgBackRest documentation (<https://pgbackrest.org/configuration.html>,
<https://pgbackrest.org/user-guide.html>), but this environment has no
running production Postgres to init a stanza against and no real
DigitalOcean Spaces credentials to verify the S3 repo against. Treat every
command below as reviewed-but-unverified until a human runs it against the
real droplet. `ops/restore-drill.sh` (same status) covers the restore-side
verification.

This complements, and does not replace, the existing `pg_dumpall`-based
`ops/daily-backup.sh` (logical backups) — pgBackRest adds physical
base-backups + continuous WAL archiving, which is what makes point-in-time
recovery possible; `pg_dumpall` alone cannot do PITR.

## 1. Install

pgBackRest needs (a) filesystem access to `PGDATA` and (b) a Postgres
connection (local socket is fine) to call `pg_backup_start`/`pg_backup_stop`
during a backup. Two ways to get both, pick one:

**Option A — install inside the postgres container (recommended).** Extend
`docker-compose.prod.yml`'s postgres image with a small Dockerfile that
adds the `pgbackrest` package (Debian/Ubuntu-based `postgres:16` image ships
apt; `apt-get install -y pgbackrest`), and mount `ops/pgbackrest/pgbackrest.conf`
plus the local repo path into the container:

```yaml
# docker-compose.prod.yml (illustrative — not applied here, since this
# needs to be built/tested against the real image first)
postgres:
  build: ./ops/pgbackrest   # Dockerfile: FROM postgres:16 + apt-get install pgbackrest
  volumes:
    - bluesky_postgres_data:/var/lib/postgresql/data
    - ./ops/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro
    - /mnt/host-backups/pgbackrest:/mnt/host-backups/pgbackrest
```

This keeps `pg1-path` in `pgbackrest.conf` (`/var/lib/postgresql/data`)
correct as-is, since pgbackrest sees the exact same filesystem Postgres
does.

**Option B — host sidecar.** Install `pgbackrest` on the droplet directly
(`apt-get install pgbackrest`) and point `pg1-path` at the named volume's
host-side directory (`docker volume inspect bluesky_postgres_data --format
'{{ .Mountpoint }}'`) instead of `/var/lib/postgresql/data`. Simpler to
avoid rebuilding the postgres image, but more fragile: the exact host path
for a named Docker volume is Docker-internal and can change across Docker
versions, and this option needs a Postgres connection detail (host port
5433 per `docker-compose.prod.yml`, not the default local socket) added to
`pgbackrest.conf`'s `[corgi]` section (`pg1-port=5433`,
`pg1-socket-path=/var/run/postgresql` won't exist on the host — use
`pg1-host-type=tcp` equivalent config or connect via `127.0.0.1:5433`).

Whichever option: copy `ops/pgbackrest/pgbackrest.conf` to
`/etc/pgbackrest/pgbackrest.conf` (or mount it there), and create the local
repo directory ahead of time:

```bash
mkdir -p /mnt/host-backups/pgbackrest
chown postgres:postgres /mnt/host-backups/pgbackrest   # or the container's postgres uid
```

## 2. Set the Spaces (S3) secrets

Never put these in `pgbackrest.conf` (it's a tracked file in this repo).
Export them wherever pgbackrest actually runs (systemd `EnvironmentFile=`
for a host install, or the container's env for Option A) — pgBackRest
reads any config option from `PGBACKREST_<SECTION>_<OPTION>`:

```bash
export PGBACKREST_REPO2_S3_BUCKET="<the-do-spaces-bucket-name>"
export PGBACKREST_REPO2_S3_KEY="<do-spaces-access-key>"
export PGBACKREST_REPO2_S3_KEY_SECRET="<do-spaces-secret-key>"
```

Also fill in the two `<region>` placeholders in `pgbackrest.conf`
(`repo2-s3-endpoint`, `repo2-s3-region`) with the real DigitalOcean Spaces
region (e.g. `nyc3`, `sfo3`) before continuing.

## 3. Initialize the stanza

```bash
pgbackrest --stanza=corgi --log-level-console=info stanza-create
```

## 4. Set `archive_command` and RECREATE the container

`docker-compose.prod.yml` already ships with `wal_level=replica` and
`archive_mode=on` (restart-only settings, already applied during the
PROJ-917 maintenance window — see `docs/PARTITION_REBUILD.md`) and a
placeholder `archive_command=/bin/true`. Once the stanza above exists,
point `archive_command` at the real pgbackrest push:

```bash
# docker-compose.prod.yml: change
#   -c archive_command=/bin/true
# to
#   -c archive_command='pgbackrest --stanza=corgi archive-push %p'
```

`archive_command` is set here via a Postgres `-c` command-line flag in the
`command:` block, not via `postgresql.conf`. A value supplied on the
command line is fixed for the life of the postmaster process and takes
precedence over anything reloaded from config — sending `SIGHUP` (or
calling `pg_reload_conf()`) re-reads `postgresql.conf` but does **not**
re-parse the container's command line, so it will **not** pick up the
edited `command:` block. You must recreate the container so it starts
with the new command-line flags:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate postgres
```

Until you do, `SHOW archive_command;` will keep reporting `/bin/true` even
after a `HUP`/`pg_reload_conf()` — that staleness is expected and is not a
sign the edit failed; it means the container hasn't been recreated yet.

## 5. Verify archiving end-to-end

```bash
pgbackrest --stanza=corgi --log-level-console=info check
```

This forces a test WAL segment through the real `archive_command` and
confirms it lands in the repo — run this immediately after step 4's
`--force-recreate`, before trusting the setup. If `SHOW archive_command;`
still shows `/bin/true`, the container was not actually recreated; re-run
step 4's `up -d --force-recreate` before continuing.

## 6. First full backup

```bash
pgbackrest --stanza=corgi --type=full --log-level-console=info backup
```

Subsequent backups can be `--type=diff` or `--type=incr` on whatever
schedule an operator wires up (cron/systemd timer — not added here, since
that decision depends on the retention/RPO an operator actually wants and
isn't specified by the PROJ-917 packet).

## 7. Verify WAL pushed to BOTH repos

`check` (step 5) only proves the repo pgbackrest is configured to prefer
(repo1, local) is reachable. Confirm repo2 (Spaces) independently:

```bash
pgbackrest --stanza=corgi --repo=2 --log-level-console=info check
pgbackrest --stanza=corgi --repo=2 info
```

`info` should list the full backup from step 6 under repo2 as well as
repo1 (pgbackrest pushes WAL and backups to every configured repo by
default, not just the first).

## 8. Restore commands

**Restore the latest backup (e.g. after total data loss)**, into the
*real* PGDATA — stop Postgres first:

```bash
sudo systemctl stop bluesky-feed   # or: docker compose stop postgres
pgbackrest --stanza=corgi --delta restore
sudo systemctl start bluesky-feed  # or: docker compose start postgres
```

**Point-in-time recovery** (e.g. recovering from a bad `DROP TABLE` or a
bad deploy at a known time):

```bash
# Capture the target time from Postgres itself (server clock, with tz) if
# recovering "as of a few minutes ago" rather than a specific known instant:
RECOVERY_TARGET=$(psql "$DATABASE_URL" -Atc "select current_timestamp")

sudo systemctl stop bluesky-feed
pgbackrest --stanza=corgi --delta \
  --type=time "--target=${RECOVERY_TARGET}" \
  --target-action=promote restore
sudo systemctl start bluesky-feed
```

`--target-action=promote` tells Postgres to come up read-write once it
reaches the target, rather than pausing in recovery — appropriate for this
single-primary setup (no standby to hand off to).

For the safer "restore into a throwaway copy and verify before touching
production" workflow, use `ops/restore-drill.sh` instead of restoring
directly into the real PGDATA.

## 9. Retention

Handled automatically by the `repo1-retention-full`/`repo2-retention-full`
settings in `pgbackrest.conf` (7d local, 30d Spaces) — pgBackRest expires
old backups (and their now-unreachable WAL) on its own after each backup,
no separate cron job needed for this piece. (`ops/daily-backup.sh`'s own
`pg_dumpall` retention is unrelated and unaffected.)
