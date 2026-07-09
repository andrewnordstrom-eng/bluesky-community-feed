-- Migration 027: Partition the posts table
-- PROJ-917: native time-partitioned schema rebuild (see 026 for the raw-event
-- half and full PROJ-917 rationale/PG16 citations).
--
-- RETENTION WINDOW: 30 days (SCORED_DATA_RETENTION_DAYS in src/config.ts).
-- Daily partitions span [today - 32d, today + 2d] (30d retention + 2d
-- safety buffer).
--
-- FOREIGN KEY FALLOUT (the "cross-partitioned-table FK" question the PROJ-917
-- packet asks to resolve): post_engagement.post_uri, post_scores.post_uri,
-- and post_score_components.post_uri all currently
-- `REFERENCES posts(uri) ON DELETE CASCADE`. PG16 requires a partitioned
-- table's PK/unique constraints to include the full partition key ("5.11.2.3.
-- Limitations", https://www.postgresql.org/docs/16/ddl-partitioning.html) —
-- so once posts' PK becomes (uri, created_at), `posts(uri)` alone is no
-- longer backed by any unique constraint and can no longer be a valid FK
-- target. Chosen approach: DROP these three FK constraints outright rather
-- than widen every child to carry a denormalized created_at AND repoint the
-- FK at the composite (uri, created_at) key. Rationale:
--   1. Even a same-day-partition-aligned composite FK does not remove the
--      operational problem this whole rebuild exists to solve: PG requires a
--      SHARE lock against every table with an FK pointing at a partitioned
--      table's partition before that partition can be detached (see
--      "ALTER TABLE ... DETACH PARTITION",
--      https://www.postgresql.org/docs/16/sql-altertable.html), which
--      reintroduces cross-table coordination on every retention drop —
--      exactly the kind of coupling instant-drop retention is meant to
--      eliminate.
--   2. Referential integrity is preserved by construction instead of by
--      constraint: post_scores/post_score_components rows are only ever
--      written by the scoring pipeline immediately after it reads the
--      corresponding row from `posts` (src/scoring/pipeline.ts), and their
--      retention windows are driven by the SAME 30-day config value and the
--      same partition-manager job, so parent and child data age out
--      together. post_engagement is handled by an explicit
--      application-level cascade in partition-manager.ts's drop step (per
--      this packet's instructions) plus an orphan-sweep in cleanup.ts,
--      mirroring the pattern this codebase already uses for likes/reposts
--      (which never had an FK to posts at all — see cleanup.ts's header
--      comment).
--
-- Every `INSERT INTO posts ... ON CONFLICT (uri) DO NOTHING` call site
-- widens to `ON CONFLICT (uri, created_at) DO NOTHING` in the same commit
-- (post-handler.ts, the A1 harness seeders, the concurrent-writes stress
-- scenario).

-- Reusable helper: drop whichever FK constraint (if any) currently makes
-- `child_table.<col>` reference `parent_table`, without hardcoding
-- PostgreSQL's auto-generated constraint name (`<table>_<column>_fkey`) —
-- looked up from pg_constraint instead so this is correct even if a
-- constraint was given a custom name. Shared by every PROJ-917 migration
-- that has to detach a table from the posts partitioning rebuild (027-029).
CREATE OR REPLACE FUNCTION drop_fk_referencing(
  child_table text,
  parent_table text
) RETURNS void AS $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = child_table::regclass
    AND confrelid = parent_table::regclass
    AND contype = 'f';

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', child_table, fk_name);
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT drop_fk_referencing('post_engagement', 'posts');
SELECT drop_fk_referencing('post_scores', 'posts');
SELECT drop_fk_referencing('post_score_components', 'posts');

-- ============================================================
-- posts
-- ============================================================

CREATE TABLE posts_new (
  LIKE posts INCLUDING DEFAULTS,
  PRIMARY KEY (uri, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_posts_author_new ON posts_new(author_did);
CREATE INDEX idx_posts_created_new ON posts_new(created_at DESC);
CREATE INDEX idx_posts_indexed_new ON posts_new(indexed_at DESC);
CREATE INDEX idx_posts_reply_root_new ON posts_new(reply_root) WHERE reply_root IS NOT NULL;
CREATE INDEX idx_posts_active_new ON posts_new(created_at DESC) WHERE deleted = FALSE;
CREATE INDEX idx_posts_text_trgm_new ON posts_new USING gin (text gin_trgm_ops) WHERE deleted = FALSE;
CREATE INDEX idx_posts_topic_vector_new ON posts_new USING GIN (topic_vector);
CREATE INDEX idx_posts_classification_method_new ON posts_new(classification_method) WHERE classification_method IS NOT NULL;
CREATE INDEX idx_posts_embed_url_new ON posts_new(embed_url) WHERE embed_url IS NOT NULL;

CREATE TABLE posts_default PARTITION OF posts_new DEFAULT;

SELECT create_daily_range_partitions(
  'posts_new', 'posts',
  (CURRENT_DATE - INTERVAL '32 days')::date,
  (CURRENT_DATE + INTERVAL '2 days')::date
);

INSERT INTO posts_new
SELECT * FROM posts
WHERE created_at >= (CURRENT_DATE - INTERVAL '32 days');

ALTER TABLE posts RENAME TO posts_legacy;
ALTER INDEX idx_posts_author RENAME TO idx_posts_author_legacy;
ALTER INDEX idx_posts_created RENAME TO idx_posts_created_legacy;
ALTER INDEX idx_posts_indexed RENAME TO idx_posts_indexed_legacy;
ALTER INDEX idx_posts_reply_root RENAME TO idx_posts_reply_root_legacy;
ALTER INDEX idx_posts_active RENAME TO idx_posts_active_legacy;
ALTER INDEX idx_posts_text_trgm RENAME TO idx_posts_text_trgm_legacy;
ALTER INDEX idx_posts_topic_vector RENAME TO idx_posts_topic_vector_legacy;
ALTER INDEX idx_posts_classification_method RENAME TO idx_posts_classification_method_legacy;
ALTER INDEX idx_posts_embed_url RENAME TO idx_posts_embed_url_legacy;

ALTER TABLE posts_new RENAME TO posts;
ALTER INDEX idx_posts_author_new RENAME TO idx_posts_author;
ALTER INDEX idx_posts_created_new RENAME TO idx_posts_created;
ALTER INDEX idx_posts_indexed_new RENAME TO idx_posts_indexed;
ALTER INDEX idx_posts_reply_root_new RENAME TO idx_posts_reply_root;
ALTER INDEX idx_posts_active_new RENAME TO idx_posts_active;
ALTER INDEX idx_posts_text_trgm_new RENAME TO idx_posts_text_trgm;
ALTER INDEX idx_posts_topic_vector_new RENAME TO idx_posts_topic_vector;
ALTER INDEX idx_posts_classification_method_new RENAME TO idx_posts_classification_method;
ALTER INDEX idx_posts_embed_url_new RENAME TO idx_posts_embed_url;
