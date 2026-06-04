-- Migration 022: Long-table decomposition for governance epoch and vote weights
--
-- Adds two normalized side tables that mirror the 5 wide columns in
-- governance_epochs and governance_votes (recency_weight, engagement_weight,
-- bridging_weight, source_diversity_weight, relevance_weight). This is
-- additive; the wide columns and the existing weights_sum_check /
-- vote_weights_sum_to_one CHECK constraints remain authoritative through
-- PROJ-817 (P4 reader migration). PROJ-819 (P5) drops the wide columns and
-- replaces the CHECK constraints with sum-validation triggers that operate
-- on the long tables.
--
-- During the additive window, epoch-manager.ts and routes/vote.ts dual-write
-- both shapes while GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED is on (default
-- true). The aggregation read branch in src/governance/aggregation.ts can
-- optionally read from the long table when GOVERNANCE_LONGTABLE_READ_ENABLED
-- is on (default false; flipped to true at the end of PROJ-817 / P4).
--
-- See PROJ-815 for full packet context. The append-only governance_audit_log
-- is not modified by this migration.

CREATE TABLE IF NOT EXISTS governance_epoch_weights (
    epoch_id       INTEGER NOT NULL REFERENCES governance_epochs(id) ON DELETE CASCADE,
    component_key  TEXT NOT NULL,
    weight         FLOAT NOT NULL CHECK (weight >= 0 AND weight <= 1),
    PRIMARY KEY (epoch_id, component_key)
);

CREATE TABLE IF NOT EXISTS governance_vote_weights (
    vote_id        UUID NOT NULL REFERENCES governance_votes(id) ON DELETE CASCADE,
    component_key  TEXT NOT NULL,
    weight         FLOAT NOT NULL CHECK (weight >= 0 AND weight <= 1),
    PRIMARY KEY (vote_id, component_key)
);

-- Component-anchored aggregation: "give me every vote's value for this
-- component in this epoch" — used by the read branch in aggregation.ts after
-- PROJ-817 (P4). The PRIMARY KEY already serves vote-anchored lookups via
-- its (vote_id) leading column, so we add only the component-anchored index.
CREATE INDEX IF NOT EXISTS idx_gvw_component ON governance_vote_weights(component_key);
CREATE INDEX IF NOT EXISTS idx_gew_component ON governance_epoch_weights(component_key);
