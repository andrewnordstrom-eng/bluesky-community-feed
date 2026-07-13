-- Waitlist for the voting pilot.
--
-- Public intake stores a normalized Bluesky handle (lowercased, no leading '@')
-- plus an optional requester note. Admins approve or reject; approval resolves
-- the handle to a DID and inserts into approved_participants (the login/voting
-- allowlist). Rejections are sticky for re-submissions (ON CONFLICT DO NOTHING
-- at intake) but admins can always approve directly via the participants API.

CREATE TABLE IF NOT EXISTS waitlist_requests (
    id          SERIAL PRIMARY KEY,
    handle      TEXT NOT NULL,
    did         TEXT,
    note        TEXT,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at  TIMESTAMPTZ,
    decided_by  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_handle
    ON waitlist_requests(handle);

CREATE INDEX IF NOT EXISTS idx_waitlist_status_created
    ON waitlist_requests(status, created_at DESC);
