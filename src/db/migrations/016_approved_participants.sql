CREATE TABLE IF NOT EXISTS approved_participants (
    id         SERIAL PRIMARY KEY,
    did        TEXT NOT NULL UNIQUE,
    handle     TEXT,
    added_by   TEXT NOT NULL,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at TIMESTAMPTZ,
    notes      TEXT
);

CREATE INDEX IF NOT EXISTS idx_approved_participants_active
  ON approved_participants(did) WHERE removed_at IS NULL;
