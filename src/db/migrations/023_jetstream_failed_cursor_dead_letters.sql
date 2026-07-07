-- Durable audit log for Jetstream events skipped after failed-cursor pin limits.
CREATE TABLE IF NOT EXISTS jetstream_failed_cursor_dead_letters (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL,
  cursor_us BIGINT NOT NULL,
  generation INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('retry_limit', 'pin_limit', 'age_limit')),
  failure_count INTEGER NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jetstream_failed_cursor_dead_letters_cursor
  ON jetstream_failed_cursor_dead_letters (cursor_us, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jetstream_failed_cursor_dead_letters_reason
  ON jetstream_failed_cursor_dead_letters (reason, created_at DESC);
