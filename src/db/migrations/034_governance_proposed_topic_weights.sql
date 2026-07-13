-- Keep topic-weight results reviewable alongside signal weights and content
-- rules before an operator approves the complete policy.
ALTER TABLE governance_epochs
ADD COLUMN IF NOT EXISTS proposed_topic_weights JSONB;

COMMENT ON COLUMN governance_epochs.proposed_topic_weights IS
  'Aggregated topic-weight proposal awaiting operator approval in results phase';

-- Approval and the request to score the approved policy must commit together.
-- A generation counter makes retries idempotent while preserving a newer
-- request that arrives during an in-flight scoring run.
CREATE TABLE IF NOT EXISTS governance_rescore_requests (
  epoch_id INTEGER PRIMARY KEY REFERENCES governance_epochs(id) ON DELETE CASCADE,
  requested_generation BIGINT NOT NULL DEFAULT 1,
  completed_generation BIGINT NOT NULL DEFAULT 0,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT governance_rescore_generation_positive
    CHECK (requested_generation >= 1),
  CONSTRAINT governance_rescore_generation_ordered
    CHECK (
      completed_generation >= 0
      AND completed_generation <= requested_generation
    )
);

COMMENT ON TABLE governance_rescore_requests IS
  'Durable generations requiring a full same-epoch rescore after governance policy approval';

-- A pre-review deployment briefly allowed an empty voting window to enter the
-- results phase. Empty results have no community proposal to approve, so put
-- any such active row back into the ordinary running phase. This preserves the
-- already-active policy and records the repair without manufacturing a vote.
WITH reconciled AS (
  UPDATE governance_epochs epoch
  SET phase = 'running',
      voting_started_at = NULL,
      voting_ends_at = NULL,
      voting_closed_at = NULL,
      auto_transition = FALSE,
      proposed_weights = NULL,
      proposed_topic_weights = NULL,
      proposed_content_rules = NULL,
      results_approved_at = NULL,
      results_approved_by = NULL
  WHERE epoch.status = 'active'
    AND epoch.phase = 'results'
    AND NOT EXISTS (
      SELECT 1
      FROM governance_votes vote
      WHERE vote.epoch_id = epoch.id
    )
  RETURNING epoch.id
)
INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
SELECT
  'migration_reconcile_zero_ballot_results',
  'system:migration:034',
  reconciled.id,
  jsonb_build_object(
    'reason', 'results phase had zero ballots',
    'restored_phase', 'running'
  )
FROM reconciled;
