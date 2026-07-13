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
