-- Migration 028: Partition post_scores
-- PROJ-917: native time-partitioned schema rebuild (see 026/027 for the raw
-- events + posts halves, full rationale, and PG16 partitioning citations).
--
-- RETENTION WINDOW: 30 days (SCORED_DATA_RETENTION_DAYS), same window as
-- posts (migration 027) — post_scores rows age out together with the post
-- they score.
--
-- NEW COLUMN: post_scores gains a `created_at` column — a denormalized copy
-- of the scored post's `posts.created_at` (NOT `scored_at`, which changes on
-- every rescore). This is the partitioning key. Rationale for denormalizing
-- rather than partitioning by `scored_at`: `scored_at` is bumped on every
-- `ON CONFLICT ... DO UPDATE` rescore (src/scoring/pipeline.ts's storeScore,
-- which runs every ~5 minutes per SCORING_INTERVAL_MS), and PostgreSQL moves
-- a row to a different partition when an UPDATE changes its partition-key
-- value — so partitioning by `scored_at` would make every incremental
-- rescore a cross-partition row migration. Partitioning by the post's own
-- (immutable) `created_at` instead means a row is written to its partition
-- once and never moves.
--
-- WHY NOT A TRIGGER: a `BEFORE INSERT` trigger cannot populate `created_at`
-- to drive partition routing — "`BEFORE ROW` triggers on `INSERT` cannot
-- change which partition is the final destination for a new row." (PostgreSQL
-- 16 docs, "5.11.2.3. Limitations",
-- https://www.postgresql.org/docs/16/ddl-partitioning.html). `created_at`
-- must instead be supplied directly in the INSERT's VALUES list — done via a
-- `(SELECT created_at FROM posts WHERE uri = $1)` scalar subquery in
-- src/scoring/pipeline.ts's storeScore(), which the query planner evaluates
-- while constructing the row (before routing), and in
-- scripts/backfill-score-components.ts's batch UNNEST insert via a JOIN.
-- Both reuse the already-bound post_uri parameter, so no new bind parameter
-- is introduced.
--
-- CONSTRAINT WIDENING: `unique_post_epoch UNIQUE(post_uri, epoch_id)` widens
-- to `UNIQUE(post_uri, epoch_id, created_at)` because PG16 requires a
-- partitioned table's unique constraints to include the full partition key
-- (see 026/027 for the exact citation). `post_uri` determines `created_at`
-- 1:1 in practice (a post's created_at never changes), so this widening adds
-- no real ambiguity — it only satisfies PostgreSQL's per-partition
-- enforcement mechanism. `storeScore()`'s `ON CONFLICT` target widens to
-- match; `created_at` is never in the `DO UPDATE SET` list since it's
-- immutable once written.
--
-- FK: post_scores.post_uri's FK to posts(uri) was already dropped in
-- migration 027 (it has to be dropped before posts' PK changes shape).

-- ============================================================
-- post_scores
-- ============================================================

-- Constraint (and its backing index) named unique_post_epoch_new, not
-- unique_post_epoch: the OLD post_scores table's own unique_post_epoch
-- constraint still exists at this point (only renamed out of the way
-- below, after this CREATE TABLE), and constraint/index names must be
-- unique per schema — the same reason every index below is created with a
-- _new suffix first.
CREATE TABLE post_scores_new (
  LIKE post_scores INCLUDING DEFAULTS,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, created_at),
  CONSTRAINT unique_post_epoch_new UNIQUE (post_uri, epoch_id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_scores_epoch_total_new ON post_scores_new(epoch_id, total_score DESC);
CREATE INDEX idx_scores_post_new ON post_scores_new(post_uri);
CREATE INDEX idx_scores_scored_at_new ON post_scores_new(scored_at DESC);
-- Mirrors migration 024's expression index (run-scoped transparency reads).
CREATE INDEX idx_scores_epoch_run_total_new
ON post_scores_new (epoch_id, (component_details->>'run_id'), total_score DESC)
WHERE component_details ? 'run_id';

CREATE TABLE post_scores_default PARTITION OF post_scores_new DEFAULT;

SELECT create_daily_range_partitions(
  'post_scores_new', 'post_scores',
  (CURRENT_DATE - INTERVAL '32 days')::date,
  (CURRENT_DATE + INTERVAL '2 days')::date
);

-- Copy step: JOIN against posts (already the new partitioned table as of
-- migration 027) both to source the new created_at column AND to naturally
-- scope the copy to scores whose post survived posts' own 30d-window copy —
-- no separate age filter needed on post_scores itself.
INSERT INTO post_scores_new (
  id, post_uri, epoch_id,
  recency_score, engagement_score, bridging_score, source_diversity_score, relevance_score,
  recency_weight, engagement_weight, bridging_weight, source_diversity_weight, relevance_weight,
  recency_weighted, engagement_weighted, bridging_weighted, source_diversity_weighted, relevance_weighted,
  total_score, component_details, scored_at, classification_method, created_at
)
SELECT
  s.id, s.post_uri, s.epoch_id,
  s.recency_score, s.engagement_score, s.bridging_score, s.source_diversity_score, s.relevance_score,
  s.recency_weight, s.engagement_weight, s.bridging_weight, s.source_diversity_weight, s.relevance_weight,
  s.recency_weighted, s.engagement_weighted, s.bridging_weighted, s.source_diversity_weighted, s.relevance_weighted,
  s.total_score, s.component_details, s.scored_at, s.classification_method, p.created_at
FROM post_scores s
JOIN posts p ON p.uri = s.post_uri;

ALTER TABLE post_scores RENAME TO post_scores_legacy;
ALTER INDEX idx_scores_epoch_total RENAME TO idx_scores_epoch_total_legacy;
ALTER INDEX idx_scores_post RENAME TO idx_scores_post_legacy;
ALTER INDEX idx_scores_scored_at RENAME TO idx_scores_scored_at_legacy;
ALTER INDEX idx_scores_epoch_run_total RENAME TO idx_scores_epoch_run_total_legacy;
ALTER TABLE post_scores_legacy RENAME CONSTRAINT unique_post_epoch TO unique_post_epoch_legacy;

ALTER TABLE post_scores_new RENAME TO post_scores;
ALTER INDEX idx_scores_epoch_total_new RENAME TO idx_scores_epoch_total;
ALTER INDEX idx_scores_post_new RENAME TO idx_scores_post;
ALTER INDEX idx_scores_scored_at_new RENAME TO idx_scores_scored_at;
ALTER INDEX idx_scores_epoch_run_total_new RENAME TO idx_scores_epoch_run_total;
ALTER TABLE post_scores RENAME CONSTRAINT unique_post_epoch_new TO unique_post_epoch;
