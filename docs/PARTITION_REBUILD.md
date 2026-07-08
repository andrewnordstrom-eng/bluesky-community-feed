# Partition Rebuild Runbook — PROJ-917

Status: canonical runbook for the native time-partitioned schema rebuild
Owner: bluesky-feed
Last updated: 2026-07-07

## Background

Migrations 026-029 rebuilt `likes`, `reposts`, `follows`, `posts`,
`post_scores`, and `post_score_components` as declaratively `RANGE`-partitioned
(by `created_at`) tables with daily partitions. This replaces the old
guarded-DELETE retention model (`src/maintenance/cleanup.ts`, band-aided by
migration 025's `created_at` indexes) with instant `DETACH PARTITION` + `DROP
TABLE` retention (`src/maintenance/partition-manager.ts`) — a metadata-only
operation independent of row count, which is what actually fixes the root
cause: guarded DELETEs provably time out on 48M rows even indexed.

Retention windows (`src/config.ts`):

- `RAW_EVENT_RETENTION_DAYS` (default 14) — `likes`, `reposts`, `follows`
- `SCORED_DATA_RETENTION_DAYS` (default 30) — `posts`, `post_scores`,
  `post_score_components`

`governance_*` tables and everything else are untouched (tiny: ~31 rows
total) — this rebuild only concerns the high-volume event/content tables.

This is a **stop-the-line, blocking rebuild**, appropriate for the current
"no real users yet" phase (see PROJ-917 packet). It is NOT designed as a
zero-downtime online migration — `bluesky-feed.service` must be stopped for
the duration.

## Foreign key note (read before running)

`post_engagement.post_uri`, `post_scores.post_uri`, and
`post_score_components.post_uri` **lost their `ON DELETE CASCADE` FK to
posts** during this rebuild. PostgreSQL 16 requires a partitioned table's
unique/PK constraints to include the full partition key ("5.11.2.3.
Limitations", <https://www.postgresql.org/docs/16/ddl-partitioning.html>), so
once `posts`' PK becomes `(uri, created_at)`, `posts(uri)` alone can no
longer back a foreign key. See migration 027's header comment for the full
rationale. Referential integrity is instead preserved by construction
(scoring pipeline writes children immediately after reading the parent) plus
two application-level cascades: `partition-manager.ts` deletes matching
`post_engagement` rows before dropping a `posts` partition, and
`cleanup.ts`'s `batchDeleteOrphanedEngagement()` sweeps stragglers the same
way it already did for `likes`/`reposts` (which never had an FK to `posts`
either).

## Pre-flight

- [ ] Confirm this is running against the intended target — **never** run
      these steps against a database you haven't explicitly verified is the
      one you mean to rebuild. There is no simulation/dry-run flag here;
      double-check the connection string by hand.
- [ ] Disk headroom (**the 200 GB resize is part of this window — step 4b**):
      the rebuild temporarily holds both the old (`*_legacy`) and new tables at
      once, so free space must exceed the combined retained-window size across
      all six tables. On the current 96 GB disk (~82% used) there is NOT enough
      room — the droplet MUST be resized to 200 GB (step 4b) before the copy
      runs, or migration 026's `INSERT ... SELECT` hits ENOSPC mid-cutover.
      Check sizes (note: Postgres runs in Docker, so all `psql`/`pg_dump` go
      through `docker exec bluesky-feed-postgres`, never `sudo -u postgres`):
      `docker exec bluesky-feed-postgres psql -U feed -d bluesky_feed -c "SELECT pg_size_pretty(sum(pg_total_relation_size(t))) FROM unnest(ARRAY['posts','post_scores','post_score_components','likes','reposts','follows']) t;"`
- [ ] Maintenance window scheduled — this is blocking DDL + a full-table
      copy of the retained window; expect service downtime for the
      duration.

## Ordered steps

### 1. Stop the service

```bash
sudo systemctl stop bluesky-feed
docker compose -f docker-compose.prod.yml ps   # confirm postgres/redis still up
```

### 2. Archive: full logical backup

Take a full `pg_dump` before touching anything, independent of the routine
`/opt/backups/daily-backup.sh` cadence (see `docs/OPS_RUNBOOK.md`'s Backup
and Retention section):

```bash
# Postgres runs in Docker — there is NO `postgres` OS user on the host
# (`sudo -u postgres` fails). Always go through the container.
OUT=/mnt/host-backups/postgres/pre-partition-rebuild-$(date +%Y%m%d-%H%M%S).dump
docker exec bluesky-feed-postgres pg_dump -Fc -U feed bluesky_feed > "$OUT"
# Verify the custom-format dump isn't truncated (it is NOT gzip, so `gzip -t`
# does not apply — `pg_restore -l` reads the archive's table of contents):
docker exec -i bluesky-feed-postgres pg_restore -l < "$OUT" > /dev/null && echo "dump OK: $OUT"
```

### 3. Dump governance tables separately

Governance is out of scope for this rebuild but is small enough to snapshot
on its own for an easy point-in-time reference, independent of the full
backup above:

```bash
docker exec bluesky-feed-postgres pg_dump -Fc -U feed \
  -t governance_epochs -t governance_votes -t governance_audit_log \
  -t governance_epoch_weights -t governance_vote_weights \
  bluesky_feed > /mnt/host-backups/postgres/governance-snapshot-$(date +%Y%m%d-%H%M%S).dump
```

### 4. Deploy new code, resize the droplet, then run the migrations

Ordering matters: the migrations widen primary keys and change `ON CONFLICT`
targets, so the deployed app MUST already be the new code (old code + new
schema = every insert fails), and the copy step needs disk headroom the
current 96 GB disk does not have (legacy + new coexist).

**4a. Deploy the new code** (app + tuned `docker-compose.prod.yml` + migrations 026-030):

```bash
cd /opt/bluesky-feed
git fetch origin && git checkout main && git pull   # main must already contain the merged PROJ-917 work
npm ci && npm run build
```

**4b. Resize the droplet to 200 GB** (mandatory — see pre-flight disk math):

```bash
docker compose -f docker-compose.prod.yml stop      # clean Postgres shutdown before power-off
# Power off, resize with "Disk, CPU and RAM", power on — via the DO console/API.
df -h /                                              # expect ~196G; if not: sudo growpart /dev/vda 1 && sudo resize2fs /dev/vda1
```

**4c. Bring Postgres back up with the tuned settings** (the new compose applies
`shared_buffers=4GB`, `wal_level`, `archive_mode`, etc. on restart):

```bash
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml ps         # confirm both healthy
```

**4d. Run the migrations** (rename old → create partitioned → copy recent
window; atomic per table):

```bash
cd /opt/bluesky-feed
npm run migrate
```

What this does, per table (see each migration file's header for the exact
rationale and PG16 citations):

- Creates a new `RANGE`-partitioned table (`<table>_new`) with daily
  partitions spanning `[today - (retention + 2d), today + 2d]`, plus a
  `DEFAULT` partition safety net.
- Copies rows within the retention window from the old table into the new
  one (`INSERT ... SELECT ... WHERE created_at >= ...`).
- Renames the OLD table to `<table>_legacy` (**not dropped** — this is the
  rollback path) and renames the NEW table into the live table name.

After this step, the application schema is fully partitioned and rows older
than the retention window have been intentionally left behind in
`<table>_legacy` (not copied forward) — that data aging out is the point of
this rebuild.

### 5. Verify

```bash
psql "$DATABASE_URL" <<'SQL'
-- Every partitioned table should report relkind = 'p'.
SELECT relname, relkind
FROM pg_class
WHERE relname IN ('likes','reposts','follows','posts','post_scores','post_score_components')
  AND relnamespace = 'public'::regnamespace;

-- Row counts: new table vs. legacy table (new should be <= legacy, and
-- roughly equal to legacy filtered to the retention window).
SELECT 'posts' AS t, (SELECT COUNT(*) FROM posts) AS new_count, (SELECT COUNT(*) FROM posts_legacy) AS legacy_count
UNION ALL
SELECT 'post_scores', (SELECT COUNT(*) FROM post_scores), (SELECT COUNT(*) FROM post_scores_legacy)
UNION ALL
SELECT 'post_score_components', (SELECT COUNT(*) FROM post_score_components), (SELECT COUNT(*) FROM post_score_components_legacy)
UNION ALL
SELECT 'likes', (SELECT COUNT(*) FROM likes), (SELECT COUNT(*) FROM likes_legacy)
UNION ALL
SELECT 'reposts', (SELECT COUNT(*) FROM reposts), (SELECT COUNT(*) FROM reposts_legacy)
UNION ALL
SELECT 'follows', (SELECT COUNT(*) FROM follows), (SELECT COUNT(*) FROM follows_legacy);

-- Spot-check: a handful of the most recent rows made it across intact.
SELECT uri, created_at FROM posts ORDER BY created_at DESC LIMIT 5;
SQL
```

Then start the service and run the standard smoke checks
(`docs/runbooks/operator-quickstart.md`):

```bash
sudo systemctl start bluesky-feed
curl -sS http://localhost:3001/health
curl -sS "http://localhost:3001/xrpc/app.bsky.feed.describeFeedGenerator"
```

Watch the next scheduled scoring run (`SCORING_INTERVAL_MS`, default 5 min)
and the next hourly maintenance-worker tick complete cleanly:

```bash
sudo journalctl -u bluesky-feed -f | grep -E 'Scoring pipeline complete|Partition maintenance run complete|Cleanup run complete'
```

Confirm `system_status` reflects a healthy run:

```bash
psql "$DATABASE_URL" -c "SELECT key, value, updated_at FROM system_status WHERE key IN ('current_scoring_run','last_partition_maintenance_run','last_cleanup_run') ORDER BY key;"
```

### 6. Drop old (only after verification above passes)

This is a deliberate, separate, manual step — NOT part of the migrations —
so there is always a rollback path until an operator explicitly confirms
the new schema is good:

```bash
psql "$DATABASE_URL" <<'SQL'
DROP TABLE IF EXISTS likes_legacy CASCADE;
DROP TABLE IF EXISTS reposts_legacy CASCADE;
DROP TABLE IF EXISTS follows_legacy CASCADE;
DROP TABLE IF EXISTS post_score_components_legacy CASCADE;
DROP TABLE IF EXISTS post_scores_legacy CASCADE;
DROP TABLE IF EXISTS posts_legacy CASCADE;
SQL
```

Reclaim disk space:

```bash
psql "$DATABASE_URL" -c "VACUUM (ANALYZE);"
```

## Rollback

Rollback is only possible **before** step 6 (the legacy tables must still
exist).

1. Stop the service: `sudo systemctl stop bluesky-feed`.
2. Swap back — for each table (example shown for `posts`; repeat for
   `post_scores`, `post_score_components`, `likes`, `reposts`, `follows`):

   ```sql
   ALTER TABLE posts RENAME TO posts_partitioned_rollback;
   ALTER TABLE posts_legacy RENAME TO posts;
   ```

   (Index/constraint names on `posts_legacy` were already suffixed
   `_legacy` by the migration, so no further renaming is needed for the old
   table to become fully live again under its original name.)
3. Roll back `schema_migrations` so `npm run migrate` doesn't try to
   re-apply 026-029 against the restored old schema:

   ```sql
   DELETE FROM schema_migrations WHERE filename IN (
     '026_partition_raw_events.sql',
     '027_partition_posts.sql',
     '028_partition_post_scores.sql',
     '029_partition_post_score_components.sql'
   );
   ```
4. Restart the service and re-run the smoke checks from step 5.

If something has already gone wrong with the `_legacy` tables too (or step 6
already ran), fall back to the full `pg_dump` from step 2:

```bash
sudo systemctl stop bluesky-feed
# Docker again — pipe the host dump into the container's pg_restore over stdin.
docker exec -i bluesky-feed-postgres pg_restore -U feed -d bluesky_feed --clean --if-exists \
  < /mnt/host-backups/postgres/pre-partition-rebuild-<timestamp>.dump
sudo systemctl start bluesky-feed
```

## Postgres tuning + WAL archiving (PROJ-917 production hardening)

`docker-compose.prod.yml`'s postgres `command:` block and migration 030
(`030_autovacuum_tuning.sql`) landed alongside the partition rebuild. Two
separate things to know before/while applying them:

**1. The `command:` flag changes require a maintenance-window restart, not
just this rebuild's downtime.** `shared_buffers`, `wal_level`, and
`archive_mode` are restart-only parameters in PostgreSQL (changing them via
`docker compose up -d` recreates the container, which restarts postgres —
so in practice this is the same maintenance window as the rest of this
runbook, just make sure it's scheduled together rather than assumed free).
Before applying:

- [ ] Confirm the droplet actually has comfortable headroom above the new
      `shared_buffers` (4GB) and the `effective_cache_size` planner
      assumption (8GB) — these are sized for a host with several GB more
      RAM than that, not verified against the real droplet's `free -h`
      here. Applying them blind on an undersized box can make postgres
      fail to start (shared_buffers exceeding available/configured shared
      memory) — this needs a human to check the actual droplet spec first.
- [ ] `docker compose -f docker-compose.prod.yml up -d postgres` after
      confirming headroom, then watch `docker compose logs -f postgres`
      for a clean startup before restarting `bluesky-feed`.

**2. WAL archiving is turned on but not yet wired to a destination.**
`wal_level=replica` (already the default, now pinned explicitly) is
sufficient for pgBackRest — continuous archiving only requires `wal_level`
to be `replica` or higher (PostgreSQL 16 docs,
<https://www.postgresql.org/docs/16/continuous-archiving.html>: "To enable
WAL archiving, set `wal_level` to `replica` or higher, `archive_mode` to
`on`, and specify ... `archive_command`"). `archive_mode=on` is enabled
now, but `archive_command` is set to the no-op `/bin/true` placeholder —
deliberately, so turning archiving on doesn't start failing forever against
a pgBackRest stanza that doesn't exist yet (a permanently-failing
`archive_command` makes postgres retain WAL indefinitely, which is its own
disk-filling incident — exactly what this whole effort is trying to
prevent). The real `archive_command` gets wired during pgBackRest setup
(`ops/pgbackrest/README.md`), and that step is a config **reload**
(`SELECT pg_reload_conf();` or `docker kill -s HUP bluesky-feed-postgres`),
not a second restart.

**3. Per-table autovacuum (migration 030).** Lowers
`autovacuum_vacuum_scale_factor` to 0.02 on the six partitioned tables
(likes/reposts/follows/posts/post_scores/post_score_components — applied to
every existing leaf partition plus baked into
`create_daily_range_partitions()` so future daily partitions get it too)
and to 0.01 on `post_engagement` (not partitioned, so autovacuum is its
only bloat control). This is a normal transactional migration
(`npm run migrate`) — no restart needed, only `npm run migrate`.

**4. Image digests.** `postgres:16` and `redis:7-alpine` are left as tags
in `docker-compose.prod.yml`, with a `TODO(PROJ-917)` comment on each
containing the exact `docker pull` + `docker inspect` commands to resolve
and pin a real digest — no digest was invented here since this environment
can't reach a registry to look one up.

## Ongoing operation (nothing further to do manually)

Once live, `src/maintenance/partition-manager.ts` (registered in
`worker-supervisor.ts`, running alongside `cleanup.ts`,
`interaction-aggregator.ts`, and `disk-monitor.ts`) handles retention
automatically, once per calendar day:

- Creates partitions ahead of time for `[today, today+2]` on every
  partitioned table.
- `DETACH`es + `DROP`s any daily partition whose upper bound has aged past
  that table's retention window, cascading `post_engagement` deletes for
  the `posts` table specifically.
- Sweeps each table's `DEFAULT` partition (the out-of-range safety net) for
  rows that have also aged past retention.

No cron job or manual intervention is required after the rebuild completes.
If `RAW_EVENT_RETENTION_DAYS` or `SCORED_DATA_RETENTION_DAYS` are changed
later, only the *ongoing* retention window changes — it does not
retroactively resize partitions already created by migrations 026-029; that
would require a follow-up migration.
