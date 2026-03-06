-- Migration 015: Feed Interactions (sendInteractions API)
--
-- Stores interaction signals reported by Bluesky clients via
-- app.bsky.feed.sendInteractions (e.g. requestMore, requestLess).
-- Retention: 30 days for raw data (same as feed_requests).

CREATE TABLE IF NOT EXISTS feed_interactions (
    id               BIGSERIAL PRIMARY KEY,
    requester_did    TEXT NOT NULL,
    post_uri         TEXT NOT NULL,
    interaction_type TEXT NOT NULL,
    feed_context     TEXT,
    reported_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    epoch_id         INTEGER
);

CREATE INDEX IF NOT EXISTS idx_feed_interactions_time
  ON feed_interactions(reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_feed_interactions_user
  ON feed_interactions(requester_did, reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_feed_interactions_post
  ON feed_interactions(post_uri, interaction_type);

CREATE INDEX IF NOT EXISTS idx_feed_interactions_epoch
  ON feed_interactions(epoch_id, interaction_type);
