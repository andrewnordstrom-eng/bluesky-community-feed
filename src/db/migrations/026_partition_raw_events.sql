-- Migration 026: Partition raw event tables (likes, reposts, follows)
-- PROJ-917: native time-partitioned schema rebuild
--
-- ROOT CAUSE THIS FIXES: migration 025 added a plain b-tree on created_at so
-- the hourly guarded-DELETE retention cleanup (src/maintenance/cleanup.ts)
-- could at least find rows to delete without seq-scanning 48M rows. That
-- band-aid still leaves retention as an indexed DELETE — bounded by
-- statement_timeout, competing with autovacuum/bloat, and never truly
-- instant. This migration replaces the unpartitioned tables with declarative
-- RANGE partitioning on created_at, so retention becomes ALTER TABLE ...
-- DETACH PARTITION + DROP TABLE (src/maintenance/partition-manager.ts) —
-- a metadata-only operation independent of row count.
--
-- RETENTION WINDOW: 14 days (RAW_EVENT_RETENTION_DAYS in src/config.ts).
-- Daily partitions are created spanning [today - 16d, today + 2d] (14d
-- retention + 2d safety buffer on each side) so partition-manager.ts always
-- has a couple of days of slack before it must create the next day's
-- partition or drop the oldest one.
--
-- APPROACH: stop-the-line blocking rebuild (no real users yet — see PROJ-917
-- packet). For each table: create a new RANGE-partitioned parent with the
-- same columns (`LIKE <table> INCLUDING DEFAULTS`), widen the PK to include
-- the partition key (required — see PG16 docs below), recreate the existing
-- secondary indexes, copy rows inside the retention window from the old
-- table, then rename-swap the old table out of the way (kept as `_legacy`,
-- NOT dropped — see docs/PARTITION_REBUILD.md for the manual verify+drop
-- step) and the new table into its place.
--
-- PG16 CONSTRAINT (cited): "To create a unique or primary key constraint on
-- a partitioned table, ... the constraint's columns must include all of the
-- partition key columns." — PostgreSQL 16 docs, "5.11.2.3. Limitations"
-- (https://www.postgresql.org/docs/16/ddl-partitioning.html). This is why
-- the PK below becomes (uri, created_at) instead of (uri) alone: a
-- partitioned table cannot enforce global uniqueness on a column that isn't
-- part of the partition key, because each partition only enforces
-- uniqueness within itself.
--
-- CALLER IMPACT: every `ON CONFLICT (uri) DO NOTHING` against these three
-- tables (like-handler.ts, repost-handler.ts, follow-handler.ts, and the A1
-- simulation harness/stress seeders) must widen to
-- `ON CONFLICT (uri, created_at) DO NOTHING` to keep matching a real unique
-- constraint — done in the same PROJ-917 commit as this migration.
--
-- No FK changes needed here: likes/reposts/follows never had a foreign key
-- to posts (see cleanup.ts's header comment — orphan cleanup already
-- handles that gap), so nothing to re-point.

-- Reusable helper: create one daily RANGE partition per day in [start_date,
-- end_date] (inclusive) for a given partitioned parent. Shared by every
-- PROJ-917 partitioning migration (026-029) and by
-- src/maintenance/partition-manager.ts's "create tomorrow's partition"
-- step, so the partition-naming convention (`<prefix>_p<YYYYMMDD>`) and
-- creation DDL live in exactly one place.
CREATE OR REPLACE FUNCTION create_daily_range_partitions(
  parent_table text,
  partition_prefix text,
  start_date date,
  end_date date
) RETURNS void AS $$
DECLARE
  d date := start_date;
  partition_name text;
BEGIN
  IF end_date < start_date THEN
    RETURN;
  END IF;

  WHILE d <= end_date LOOP
    partition_name := format('%s_p%s', partition_prefix, to_char(d, 'YYYYMMDD'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
      partition_name, parent_table, d::text, (d + 1)::text
    );
    d := d + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- likes
-- ============================================================

CREATE TABLE likes_new (
  LIKE likes INCLUDING DEFAULTS,
  PRIMARY KEY (uri, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_likes_subject_new ON likes_new(subject_uri);
CREATE INDEX idx_likes_author_new ON likes_new(author_did);
CREATE INDEX idx_likes_created_new ON likes_new(created_at);

-- Default partition: safety net for any row whose created_at falls outside
-- every explicit daily range (clock skew, backfill replay, a missed
-- partition-manager run). Without one, an out-of-range INSERT hard-fails
-- ("no partition of relation found for row"). partition-manager.ts sweeps
-- this partition on its own retention cadence (see its header comment).
CREATE TABLE likes_default PARTITION OF likes_new DEFAULT;

SELECT create_daily_range_partitions(
  'likes_new', 'likes',
  (CURRENT_DATE - INTERVAL '16 days')::date,
  (CURRENT_DATE + INTERVAL '2 days')::date
);

INSERT INTO likes_new
SELECT * FROM likes
WHERE created_at >= (CURRENT_DATE - INTERVAL '16 days');

ALTER TABLE likes RENAME TO likes_legacy;
ALTER INDEX idx_likes_subject RENAME TO idx_likes_subject_legacy;
ALTER INDEX idx_likes_author RENAME TO idx_likes_author_legacy;
ALTER INDEX idx_likes_created RENAME TO idx_likes_created_legacy;

ALTER TABLE likes_new RENAME TO likes;
ALTER INDEX idx_likes_subject_new RENAME TO idx_likes_subject;
ALTER INDEX idx_likes_author_new RENAME TO idx_likes_author;
ALTER INDEX idx_likes_created_new RENAME TO idx_likes_created;

-- ============================================================
-- reposts
-- ============================================================

CREATE TABLE reposts_new (
  LIKE reposts INCLUDING DEFAULTS,
  PRIMARY KEY (uri, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_reposts_subject_new ON reposts_new(subject_uri);
CREATE INDEX idx_reposts_created_new ON reposts_new(created_at);

CREATE TABLE reposts_default PARTITION OF reposts_new DEFAULT;

SELECT create_daily_range_partitions(
  'reposts_new', 'reposts',
  (CURRENT_DATE - INTERVAL '16 days')::date,
  (CURRENT_DATE + INTERVAL '2 days')::date
);

INSERT INTO reposts_new
SELECT * FROM reposts
WHERE created_at >= (CURRENT_DATE - INTERVAL '16 days');

ALTER TABLE reposts RENAME TO reposts_legacy;
ALTER INDEX idx_reposts_subject RENAME TO idx_reposts_subject_legacy;
ALTER INDEX idx_reposts_created RENAME TO idx_reposts_created_legacy;

ALTER TABLE reposts_new RENAME TO reposts;
ALTER INDEX idx_reposts_subject_new RENAME TO idx_reposts_subject;
ALTER INDEX idx_reposts_created_new RENAME TO idx_reposts_created;

-- ============================================================
-- follows
-- ============================================================

CREATE TABLE follows_new (
  LIKE follows INCLUDING DEFAULTS,
  PRIMARY KEY (uri, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_follows_author_new ON follows_new(author_did) WHERE deleted = FALSE;
CREATE INDEX idx_follows_subject_new ON follows_new(subject_did) WHERE deleted = FALSE;
CREATE INDEX idx_follows_created_new ON follows_new(created_at);

CREATE TABLE follows_default PARTITION OF follows_new DEFAULT;

SELECT create_daily_range_partitions(
  'follows_new', 'follows',
  (CURRENT_DATE - INTERVAL '16 days')::date,
  (CURRENT_DATE + INTERVAL '2 days')::date
);

INSERT INTO follows_new
SELECT * FROM follows
WHERE created_at >= (CURRENT_DATE - INTERVAL '16 days');

ALTER TABLE follows RENAME TO follows_legacy;
ALTER INDEX idx_follows_author RENAME TO idx_follows_author_legacy;
ALTER INDEX idx_follows_subject RENAME TO idx_follows_subject_legacy;
ALTER INDEX idx_follows_created RENAME TO idx_follows_created_legacy;

ALTER TABLE follows_new RENAME TO follows;
ALTER INDEX idx_follows_author_new RENAME TO idx_follows_author;
ALTER INDEX idx_follows_subject_new RENAME TO idx_follows_subject;
ALTER INDEX idx_follows_created_new RENAME TO idx_follows_created;
