-- migrate: no-transaction
-- Migration 024: Run-scoped post score lookup index
--
-- Current-run transparency reads filter post_scores by:
--   epoch_id = ?
--   component_details->>'run_id' = ?
--
-- Without an expression index, production stats/rank queries can scan a large
-- active-epoch score set before narrowing to the latest scoring run. This must
-- be built concurrently on production data, so this file opts out of the
-- migration runner's transaction wrapper. Keep the index partial so legacy rows
-- without run metadata do not bloat it.
--
-- Rollback, if needed:
--   DROP INDEX CONCURRENTLY IF EXISTS idx_scores_epoch_run_total;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_epoch_run_total
ON post_scores (epoch_id, (component_details->>'run_id'), total_score DESC)
WHERE component_details ? 'run_id';
