-- Keep topic-weight results reviewable alongside signal weights and content
-- rules before an operator approves the complete policy.
ALTER TABLE governance_epochs
ADD COLUMN IF NOT EXISTS proposed_topic_weights JSONB;

COMMENT ON COLUMN governance_epochs.proposed_topic_weights IS
  'Aggregated topic-weight proposal awaiting operator approval in results phase';
