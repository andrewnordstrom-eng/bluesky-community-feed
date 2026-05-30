-- Migration 021: Long-table decomposition for post score components
--
-- Adds a normalized side table that mirrors the 15 wide columns in post_scores
-- (recency_score/weight/weighted, engagement_score/weight/weighted, ...
--  relevance_score/weight/weighted). This is additive: the wide columns and
-- the unique_post_epoch constraint remain authoritative through PROJ-817 (P4
-- reader migration). PROJ-819 (P5) is the cutover that drops the wide columns
-- and the named-column CHECK constraints.
--
-- The pipeline's storeScore writes both shapes inside one transaction while
-- SCORE_LONGTABLE_DUALWRITE_ENABLED is on (default true). N rows per (post_uri,
-- epoch_id) — one per registered scoring component from DEFAULT_COMPONENTS.
--
-- See PROJ-814 for full packet context; docs/agent/REPO_CONTRACT.md for the
-- "every ranking decision is decomposed and persisted" audit invariant that
-- this packet preserves.

CREATE TABLE IF NOT EXISTS post_score_components (
    post_uri       TEXT NOT NULL REFERENCES posts(uri) ON DELETE CASCADE,
    epoch_id       INTEGER NOT NULL,
    component_key  TEXT NOT NULL,
    raw            FLOAT NOT NULL,
    weight         FLOAT NOT NULL,
    weighted       FLOAT NOT NULL,
    scored_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_uri, epoch_id, component_key)
);

-- Aggregation lookup: "give me every post's value for this component at this epoch"
-- (used by feed-stats.ts and audit-analysis.ts in PROJ-817).
-- The "post + epoch" lookup pattern is served by the PRIMARY KEY (which is itself
-- a btree on (post_uri, epoch_id, component_key) whose leading columns cover the
-- (post_uri, epoch_id) prefix), so no secondary index is needed for that path.
CREATE INDEX IF NOT EXISTS idx_psc_epoch_key ON post_score_components(epoch_id, component_key);
