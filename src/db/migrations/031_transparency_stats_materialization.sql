-- migrate: no-transaction
-- Migration 031: Materialized transparency stats
--
-- /api/transparency/stats is public reviewer-facing read traffic. Keep the
-- route on bounded rows by filling the missing feed-stat fields in
-- epoch_metrics during scoring runs instead of recomputing percentiles during
-- every HTTP request.
-- The scoring write path prunes current_feed rows per epoch after each insert;
-- this migration keeps the read path indexed for the latest retained row.

ALTER TABLE epoch_metrics
  ADD COLUMN IF NOT EXISTS run_id TEXT,
  ADD COLUMN IF NOT EXISTS avg_engagement FLOAT,
  ADD COLUMN IF NOT EXISTS median_total FLOAT,
  ADD COLUMN IF NOT EXISTS metrics_source TEXT NOT NULL DEFAULT 'legacy';

DROP INDEX CONCURRENTLY IF EXISTS idx_epoch_metrics_epoch_computed_desc_031_next;
CREATE INDEX CONCURRENTLY idx_epoch_metrics_epoch_computed_desc_031_next
ON epoch_metrics(epoch_id, computed_at DESC);
DROP INDEX CONCURRENTLY IF EXISTS idx_epoch_metrics_epoch_computed_desc;
ALTER INDEX idx_epoch_metrics_epoch_computed_desc_031_next
RENAME TO idx_epoch_metrics_epoch_computed_desc;

DROP INDEX CONCURRENTLY IF EXISTS idx_epoch_metrics_run_id_031_next;
CREATE INDEX CONCURRENTLY idx_epoch_metrics_run_id_031_next
ON epoch_metrics(run_id)
WHERE run_id IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS idx_epoch_metrics_run_id;
ALTER INDEX idx_epoch_metrics_run_id_031_next
RENAME TO idx_epoch_metrics_run_id;
