-- Migration 030: Per-table autovacuum tuning (PROJ-917 production hardening)
--
-- Lowers autovacuum_vacuum_scale_factor (the fraction of a table's rows that
-- must be dead before autovacuum fires; PostgreSQL default is 0.2 = 20%) on
-- the seven highest-churn tables in this system, so autovacuum runs much
-- more often and keeps dead-tuple bloat down between runs, rather than
-- letting 20% of a many-million-row table accumulate before it kicks in.
-- Cited: https://www.postgresql.org/docs/16/runtime-config-autovacuum.html
-- ("autovacuum_vacuum_scale_factor ... specifies a fraction of the table
-- size to add to autovacuum_vacuum_threshold").
--
-- Values applied:
--   - 0.02 (2%) on the six PROJ-917 partitioned tables (migrations 026-029):
--     likes, reposts, follows, posts, post_scores, post_score_components.
--   - 0.01 (1%, more aggressive) on post_engagement specifically: it is NOT
--     partitioned (still a single ever-growing table) and therefore can't
--     fall back on partition-manager.ts's instant DETACH+DROP retention the
--     way the six tables above can — autovacuum is the only bloat control
--     it has, so it gets the tighter number.
--
-- IMPORTANT CAVEAT (verified against the live PostgreSQL 16 docs, not
-- assumed): storage parameters including autovacuum_vacuum_scale_factor
-- CANNOT be set directly on a partitioned (parent) table — "Specifying
-- these parameters for partitioned tables is not supported, but you may
-- specify them for individual leaf partitions." (CREATE TABLE docs,
-- "Storage Parameters", https://www.postgresql.org/docs/16/sql-createtable.html).
-- A bare `ALTER TABLE posts SET (autovacuum_vacuum_scale_factor = 0.02)`
-- would therefore fail outright against posts/post_scores/etc. (they are
-- partitioned parents). This migration instead:
--
--   1. Updates the shared create_daily_range_partitions() helper (defined
--      in migration 026, reused by every PROJ-917 partitioning migration
--      AND by src/maintenance/partition-manager.ts's ongoing create-ahead
--      job) so every NEWLY created daily leaf partition, from now on,
--      is created WITH (autovacuum_vacuum_scale_factor = 0.02) directly —
--      leaf partitions DO support storage parameters (same doc citation
--      above: "... but you may specify them for individual leaf
--      partitions").
--   2. Walks pg_inherits for each of the six parent tables and applies the
--      same setting to every EXISTING leaf partition (including each
--      table's DEFAULT partition), since those were created before this
--      migration existed and won't pick up the function change
--      retroactively.
--
-- post_engagement is a plain (non-partitioned) table, so it takes the
-- ALTER TABLE directly with no such restriction.
--
-- Rollback, if needed:
--   ALTER TABLE post_engagement RESET (autovacuum_vacuum_scale_factor);
--   -- plus a DO block mirroring the one below, calling RESET instead of
--   -- SET, for each existing leaf partition of the six tables; and
--   -- re-running CREATE OR REPLACE FUNCTION create_daily_range_partitions
--   -- with the WITH clause removed (see migration 026 for the prior body).

-- ── 1. Future leaf partitions: bake the setting into the creation helper ──

CREATE OR REPLACE FUNCTION create_daily_range_partitions(
  parent_table text,
  partition_prefix text,
  start_date date,
  end_date date
) RETURNS void AS $$
DECLARE
  d date := start_date;
  partition_name text;
  default_name text := format('%s_default', partition_prefix);
BEGIN
  -- Bound every lock this function waits on (the default-partition EXCLUSIVE
  -- lock and the ATTACH's ACCESS EXCLUSIVE on the parent). If a concurrent
  -- long-running writer holds a conflicting lock, fail fast with a lock_timeout
  -- error instead of hanging indefinitely — partition-manager catches it per
  -- table and retries on the next run rather than silently stalling partition
  -- creation. Scoped to this transaction; reverts on commit.
  SET LOCAL lock_timeout = '5s';

  IF end_date < start_date THEN
    RETURN;
  END IF;

  WHILE d <= end_date LOOP
    partition_name := format('%s_p%s', partition_prefix, to_char(d, 'YYYYMMDD'));

    -- Skip if it already exists (idempotent, like the prior CREATE ... IF NOT
    -- EXISTS). Otherwise create the leaf as a STANDALONE table, drain any rows
    -- the DEFAULT partition already holds for this day, then ATTACH it.
    --
    -- Why not a plain `CREATE TABLE ... PARTITION OF`: ATTACH (and the implicit
    -- attach that PARTITION OF performs) fails if the default partition
    -- contains rows that fall in the new partition's range — which is exactly
    -- what happens when a partition-manager create-ahead run is missed and live
    -- inserts fall through to the default. Draining those rows into the new
    -- leaf first makes the attach valid. On a fresh table (initial migration)
    -- the default is empty, so the drain is a no-op and this reduces to
    -- create + attach.
    IF to_regclass(partition_name) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I (LIKE %I INCLUDING DEFAULTS) WITH (autovacuum_vacuum_scale_factor = 0.02)',
        partition_name, parent_table
      );

      IF to_regclass(default_name) IS NOT NULL THEN
        -- Block concurrent inserts into the default partition for the rest of
        -- this transaction, so no new row can land in [d, d+1) between the drain
        -- below and the ATTACH — which would otherwise make the attach abort on
        -- the missed-run path. EXCLUSIVE mode conflicts with the ROW EXCLUSIVE
        -- lock INSERT takes (blocks writes) while still allowing reads; it
        -- releases when the surrounding transaction (the migration, or
        -- partition-manager's SELECT create_daily_range_partitions(...)) commits.
        EXECUTE format('LOCK TABLE %I IN EXCLUSIVE MODE', default_name);
        EXECUTE format(
          'WITH moved AS (DELETE FROM %I WHERE created_at >= %L AND created_at < %L RETURNING *) '
          'INSERT INTO %I SELECT * FROM moved',
          default_name, d::text, (d + 1)::text, partition_name
        );
      END IF;

      EXECUTE format(
        'ALTER TABLE %I ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)',
        parent_table, partition_name, d::text, (d + 1)::text
      );
    END IF;

    d := d + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Existing leaf partitions: apply the same setting retroactively ──

DO $$
DECLARE
  parent_name text;
  leaf record;
BEGIN
  FOREACH parent_name IN ARRAY ARRAY['likes', 'reposts', 'follows', 'posts', 'post_scores', 'post_score_components']
  LOOP
    FOR leaf IN
      SELECT c.relname AS partition_name
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = parent_name::regclass
    LOOP
      EXECUTE format('ALTER TABLE %I SET (autovacuum_vacuum_scale_factor = 0.02)', leaf.partition_name);
    END LOOP;
  END LOOP;
END;
$$;

-- ── 3. post_engagement: plain table, more aggressive factor ──

ALTER TABLE post_engagement SET (autovacuum_vacuum_scale_factor = 0.01);
