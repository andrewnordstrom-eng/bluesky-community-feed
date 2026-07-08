-- Migration 029: Partition post_score_components
-- PROJ-917: native time-partitioned schema rebuild (see 026/027/028 for the
-- raw events, posts, and post_scores halves, full rationale, and PG16
-- partitioning citations).
--
-- RETENTION WINDOW: 30 days (SCORED_DATA_RETENTION_DAYS), same window and
-- same reasoning as post_scores (migration 028): a new `created_at` column
-- denormalizes the scored post's `posts.created_at` (immutable) rather than
-- reusing `scored_at` (bumped on every rescore, which would otherwise cause
-- cross-partition row movement on every incremental scoring cycle).
--
-- `created_at` is populated the same way as post_scores: directly in the
-- INSERT's VALUES/SELECT list (never via a BEFORE INSERT trigger — see
-- migration 028's header for the PG16 citation on why triggers can't drive
-- partition routing). src/scoring/pipeline.ts's storeScoreComponents() adds
-- a `(SELECT created_at FROM posts WHERE uri = $N)` scalar subquery per
-- component row, reusing the already-bound post_uri parameter for that row;
-- scripts/backfill-score-components.ts's batch UNNEST insert instead JOINs
-- against posts once for the whole batch.
--
-- PRIMARY KEY widens from (post_uri, epoch_id, component_key) to
-- (post_uri, epoch_id, component_key, created_at) — required so the
-- constraint includes the full partition key (PG16 docs, "5.11.2.3.
-- Limitations", cited in 026/027). Every `ON CONFLICT (post_uri, epoch_id,
-- component_key)` clause (src/scoring/pipeline.ts's storeScoreComponents,
-- scripts/backfill-score-components.ts) widens to match in the same commit.
--
-- FK: post_score_components.post_uri's FK to posts(uri) was already dropped
-- in migration 027.

-- ============================================================
-- post_score_components
-- ============================================================

CREATE TABLE post_score_components_new (
  LIKE post_score_components INCLUDING DEFAULTS,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (post_uri, epoch_id, component_key, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_psc_epoch_key_new ON post_score_components_new(epoch_id, component_key);

CREATE TABLE post_score_components_default PARTITION OF post_score_components_new DEFAULT;

SELECT create_daily_range_partitions(
  'post_score_components_new', 'post_score_components',
  (CURRENT_DATE - INTERVAL '32 days')::date,
  (CURRENT_DATE + INTERVAL '2 days')::date
);

-- Copy step: JOIN against posts (already the new partitioned table) both to
-- source created_at and to naturally scope the copy to components whose
-- post survived posts' own 30d-window copy.
INSERT INTO post_score_components_new (
  post_uri, epoch_id, component_key, raw, weight, weighted, scored_at, created_at
)
SELECT
  c.post_uri, c.epoch_id, c.component_key, c.raw, c.weight, c.weighted, c.scored_at, p.created_at
FROM post_score_components c
JOIN posts p ON p.uri = c.post_uri;

ALTER TABLE post_score_components RENAME TO post_score_components_legacy;
ALTER INDEX idx_psc_epoch_key RENAME TO idx_psc_epoch_key_legacy;

ALTER TABLE post_score_components_new RENAME TO post_score_components;
ALTER INDEX idx_psc_epoch_key_new RENAME TO idx_psc_epoch_key;
