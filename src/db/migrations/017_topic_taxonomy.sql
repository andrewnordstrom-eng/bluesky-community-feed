-- Topic taxonomy: curated catalog of topics the community can vote on
CREATE TABLE IF NOT EXISTS topic_catalog (
    id            SERIAL PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE,             -- 'software-development'
    name          TEXT NOT NULL,                    -- 'Software Development'
    description   TEXT,                             -- For voting UI
    parent_slug   TEXT REFERENCES topic_catalog(slug),
    terms         TEXT[] NOT NULL DEFAULT '{}',     -- Primary matching terms
    context_terms TEXT[] NOT NULL DEFAULT '{}',     -- Co-occurrence disambiguation
    anti_terms    TEXT[] NOT NULL DEFAULT '{}',     -- Terms that EXCLUDE this topic match
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_topic_catalog_active ON topic_catalog(slug) WHERE is_active = TRUE;
CREATE INDEX idx_topic_catalog_parent ON topic_catalog(parent_slug);

-- Add topic_vector to posts table (populated by classifier in Phase 2)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS topic_vector JSONB DEFAULT '{}';
CREATE INDEX idx_posts_topic_vector ON posts USING GIN (topic_vector);

-- Add topic_weights to governance_epochs (populated by voting in Phase 3)
ALTER TABLE governance_epochs ADD COLUMN IF NOT EXISTS topic_weights JSONB DEFAULT '{}';

-- Add topic_weight_votes to governance_votes (populated by voting in Phase 3)
ALTER TABLE governance_votes ADD COLUMN IF NOT EXISTS topic_weight_votes JSONB DEFAULT '{}';
