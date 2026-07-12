-- Migration 033: support community-scoped ranking request claim scans.

CREATE INDEX IF NOT EXISTS idx_ranking_run_requests_community_state_due
  ON ranking_run_requests (community_id, state, not_before, requested_at, id);
