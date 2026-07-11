-- Migration 032: Trustworthy Corgi policy and ranking-run contracts
--
-- This migration is additive. Existing scoring and feed publication remain
-- authoritative until a later, separately governed cutover packet.

CREATE TABLE IF NOT EXISTS governance_policy_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  community_id TEXT NOT NULL,
  epoch_id INTEGER NOT NULL REFERENCES governance_epochs(id) ON DELETE RESTRICT,
  algorithm_version TEXT NOT NULL CHECK (length(algorithm_version) > 0),
  weights JSONB NOT NULL CHECK (jsonb_typeof(weights) = 'object'),
  topic_weights JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(topic_weights) = 'object'),
  content_rules JSONB NOT NULL CHECK (jsonb_typeof(content_rules) = 'object'),
  effective_at TIMESTAMPTZ NOT NULL,
  provenance_references JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(provenance_references) = 'array'),
  policy_hash CHAR(64) NOT NULL CHECK (policy_hash ~ '^[0-9a-f]{64}$'),
  reconciliation_status TEXT NOT NULL
    CHECK (reconciliation_status IN ('match', 'incomplete_evidence', 'conflict_preserved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (community_id, epoch_id, algorithm_version, policy_hash),
  UNIQUE (id, policy_hash)
);

CREATE INDEX IF NOT EXISTS idx_governance_policy_versions_current
  ON governance_policy_versions (community_id, effective_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS governance_policy_reconciliation_events (
  id BIGSERIAL PRIMARY KEY,
  policy_version_id UUID NOT NULL REFERENCES governance_policy_versions(id) ON DELETE RESTRICT,
  community_id TEXT NOT NULL,
  epoch_id INTEGER NOT NULL REFERENCES governance_epochs(id) ON DELETE RESTRICT,
  reconciliation_status TEXT NOT NULL
    CHECK (reconciliation_status IN ('match', 'incomplete_evidence', 'conflict_preserved')),
  serving_weights JSONB NOT NULL CHECK (jsonb_typeof(serving_weights) = 'object'),
  wide_weights JSONB NOT NULL CHECK (jsonb_typeof(wide_weights) = 'object'),
  audit_weights JSONB CHECK (audit_weights IS NULL OR jsonb_typeof(audit_weights) = 'object'),
  audit_log_ids BIGINT[] NOT NULL DEFAULT '{}'::bigint[],
  evidence_hash CHAR(64) NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy_version_id, evidence_hash)
);

CREATE OR REPLACE FUNCTION corgi_reject_immutable_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only and immutable', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS governance_policy_versions_immutable ON governance_policy_versions;
CREATE TRIGGER governance_policy_versions_immutable
  BEFORE UPDATE OR DELETE ON governance_policy_versions
  FOR EACH ROW EXECUTE FUNCTION corgi_reject_immutable_mutation();

DROP TRIGGER IF EXISTS governance_policy_reconciliation_events_immutable
  ON governance_policy_reconciliation_events;
CREATE TRIGGER governance_policy_reconciliation_events_immutable
  BEFORE UPDATE OR DELETE ON governance_policy_reconciliation_events
  FOR EACH ROW EXECUTE FUNCTION corgi_reject_immutable_mutation();

CREATE TABLE IF NOT EXISTS ranking_runs (
  id UUID PRIMARY KEY,
  community_id TEXT NOT NULL,
  policy_version_id UUID NOT NULL,
  policy_hash CHAR(64) NOT NULL CHECK (policy_hash ~ '^[0-9a-f]{64}$'),
  as_of TIMESTAMPTZ NOT NULL,
  code_sha TEXT NOT NULL CHECK (code_sha ~ '^[0-9a-f]{40,64}$'),
  configuration_hash CHAR(64) NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  algorithm_version TEXT NOT NULL CHECK (length(algorithm_version) > 0),
  state TEXT NOT NULL CHECK (
    state IN ('requested', 'running', 'validated', 'published', 'failed', 'superseded', 'rejected')
  ),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count >= 0 AND selected_count <= 1000),
  exclusion_count INTEGER NOT NULL DEFAULT 0 CHECK (exclusion_count >= 0),
  timings JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(timings) = 'object'),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  failure JSONB CHECK (failure IS NULL OR jsonb_typeof(failure) = 'object'),
  snapshot_id TEXT,
  input_checksum CHAR(64) CHECK (input_checksum IS NULL OR input_checksum ~ '^[0-9a-f]{64}$'),
  receipt_checksum CHAR(64) CHECK (receipt_checksum IS NULL OR receipt_checksum ~ '^[0-9a-f]{64}$'),
  receipt JSONB CHECK (receipt IS NULL OR jsonb_typeof(receipt) = 'object'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  retain_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ranking_runs_policy_identity_fk
    FOREIGN KEY (policy_version_id, policy_hash)
    REFERENCES governance_policy_versions(id, policy_hash) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_ranking_runs_community_as_of
  ON ranking_runs (community_id, as_of DESC);
CREATE INDEX IF NOT EXISTS idx_ranking_runs_state_requested
  ON ranking_runs (state, requested_at);

CREATE TABLE IF NOT EXISTS ranking_run_events (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  previous_state TEXT,
  next_state TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION corgi_protect_ranking_run_child()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
  END IF;
  IF EXISTS (SELECT 1 FROM ranking_runs WHERE id = OLD.run_id) THEN
    RAISE EXCEPTION '% rows can only be deleted through retained run cleanup', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS ranking_run_events_immutable ON ranking_run_events;
CREATE TRIGGER ranking_run_events_immutable
  BEFORE UPDATE OR DELETE ON ranking_run_events
  FOR EACH ROW EXECUTE FUNCTION corgi_protect_ranking_run_child();

CREATE OR REPLACE FUNCTION corgi_validate_ranking_run_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transition_allowed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'requested' THEN
      RAISE EXCEPTION 'ranking run must begin in requested state, got %', NEW.state;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.state IN ('published', 'failed', 'superseded', 'rejected') THEN
    RAISE EXCEPTION 'terminal ranking run % in state % is immutable', OLD.id, OLD.state;
  END IF;

  IF OLD.state = 'validated' AND NEW.state = 'validated' THEN
    RAISE EXCEPTION 'validated ranking run % is immutable until terminal transition', OLD.id;
  END IF;

  IF ROW(
    NEW.id, NEW.community_id, NEW.policy_version_id, NEW.policy_hash,
    NEW.as_of, NEW.code_sha, NEW.configuration_hash, NEW.algorithm_version
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.community_id, OLD.policy_version_id, OLD.policy_hash,
    OLD.as_of, OLD.code_sha, OLD.configuration_hash, OLD.algorithm_version
  ) THEN
    RAISE EXCEPTION 'ranking run identity is immutable for run %', OLD.id;
  END IF;

  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  IF OLD.state = 'validated' AND ROW(
    NEW.candidate_count, NEW.selected_count, NEW.exclusion_count,
    NEW.timings, NEW.metrics, NEW.failure, NEW.input_checksum,
    NEW.receipt_checksum, NEW.receipt
  ) IS DISTINCT FROM ROW(
    OLD.candidate_count, OLD.selected_count, OLD.exclusion_count,
    OLD.timings, OLD.metrics, OLD.failure, OLD.input_checksum,
    OLD.receipt_checksum, OLD.receipt
  ) THEN
    RAISE EXCEPTION 'validated ranking result is immutable for run %', OLD.id;
  END IF;

  transition_allowed :=
    (OLD.state = 'requested' AND NEW.state IN ('running', 'failed', 'superseded', 'rejected')) OR
    (OLD.state = 'running' AND NEW.state IN ('validated', 'failed', 'superseded', 'rejected')) OR
    (OLD.state = 'validated' AND NEW.state IN ('published', 'failed', 'superseded', 'rejected'));

  IF NOT transition_allowed THEN
    RAISE EXCEPTION 'invalid ranking run transition % -> % for run %', OLD.state, NEW.state, OLD.id;
  END IF;

  IF NEW.state = 'running' THEN
    NEW.started_at := COALESCE(NEW.started_at, NOW());
  ELSIF NEW.state = 'validated' THEN
    NEW.validated_at := COALESCE(NEW.validated_at, NOW());
  ELSIF NEW.state = 'published' THEN
    NEW.published_at := COALESCE(NEW.published_at, NOW());
    NEW.finished_at := COALESCE(NEW.finished_at, NOW());
  ELSIF NEW.state IN ('failed', 'superseded', 'rejected') THEN
    NEW.finished_at := COALESCE(NEW.finished_at, NOW());
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION corgi_record_ranking_run_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO ranking_run_events (run_id, event_type, previous_state, next_state)
    VALUES (NEW.id, 'state_transition', NULL, NEW.state);
  ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO ranking_run_events (run_id, event_type, previous_state, next_state)
    VALUES (NEW.id, 'state_transition', OLD.state, NEW.state);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ranking_runs_validate_transition ON ranking_runs;
CREATE TRIGGER ranking_runs_validate_transition
  BEFORE INSERT OR UPDATE ON ranking_runs
  FOR EACH ROW EXECUTE FUNCTION corgi_validate_ranking_run_transition();

DROP TRIGGER IF EXISTS ranking_runs_record_event ON ranking_runs;
CREATE TRIGGER ranking_runs_record_event
  AFTER INSERT OR UPDATE ON ranking_runs
  FOR EACH ROW EXECUTE FUNCTION corgi_record_ranking_run_event();

CREATE TABLE IF NOT EXISTS ranking_run_items (
  run_id UUID NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 1000),
  post_uri TEXT NOT NULL,
  post_created_at TIMESTAMPTZ NOT NULL,
  author_did TEXT NOT NULL,
  component_decomposition JSONB NOT NULL CHECK (jsonb_typeof(component_decomposition) = 'object'),
  candidate_sources TEXT[] NOT NULL CHECK (
    cardinality(candidate_sources) > 0
    AND candidate_sources <@ ARRAY[
      'newest', 'engagement', 'policy_relevance', 'previous_snapshot', 'preliminary_fill'
    ]::TEXT[]
  ),
  diversity_context JSONB NOT NULL CHECK (jsonb_typeof(diversity_context) = 'object'),
  base_score DOUBLE PRECISION NOT NULL CHECK (
    base_score NOT IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)
  ),
  final_score DOUBLE PRECISION NOT NULL CHECK (
    final_score NOT IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, position),
  UNIQUE (run_id, post_uri, post_created_at)
);

CREATE INDEX IF NOT EXISTS idx_ranking_run_items_post
  ON ranking_run_items (post_uri, post_created_at DESC);

DROP TRIGGER IF EXISTS ranking_run_items_immutable ON ranking_run_items;
CREATE TRIGGER ranking_run_items_immutable
  BEFORE UPDATE OR DELETE ON ranking_run_items
  FOR EACH ROW EXECUTE FUNCTION corgi_protect_ranking_run_child();

CREATE TABLE IF NOT EXISTS ranking_run_inputs (
  run_id UUID PRIMARY KEY REFERENCES ranking_runs(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL DEFAULT 'application/json',
  content_encoding TEXT NOT NULL DEFAULT 'gzip' CHECK (content_encoding = 'gzip'),
  payload BYTEA NOT NULL,
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  candidate_count INTEGER NOT NULL CHECK (candidate_count >= 0),
  uncompressed_bytes BIGINT NOT NULL CHECK (uncompressed_bytes >= 0),
  compressed_bytes BIGINT NOT NULL CHECK (compressed_bytes >= 0),
  retained_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION corgi_protect_retained_ranking_input()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ranking_run_inputs is immutable';
  END IF;
  IF OLD.retained_until > clock_timestamp() THEN
    RAISE EXCEPTION 'ranking input for run % is retained until %', OLD.run_id, OLD.retained_until;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS ranking_run_inputs_retention ON ranking_run_inputs;
CREATE TRIGGER ranking_run_inputs_retention
  BEFORE UPDATE OR DELETE ON ranking_run_inputs
  FOR EACH ROW EXECUTE FUNCTION corgi_protect_retained_ranking_input();

CREATE OR REPLACE FUNCTION corgi_protect_ranking_run_manifest()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.retain_until > clock_timestamp() THEN
    RAISE EXCEPTION 'ranking run % is retained until %', OLD.id, OLD.retain_until;
  END IF;
  IF OLD.state NOT IN ('published', 'failed', 'superseded', 'rejected') THEN
    RAISE EXCEPTION 'non-terminal ranking run % cannot be deleted', OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS ranking_runs_retention ON ranking_runs;
CREATE TRIGGER ranking_runs_retention
  BEFORE DELETE ON ranking_runs
  FOR EACH ROW EXECUTE FUNCTION corgi_protect_ranking_run_manifest();

CREATE TABLE IF NOT EXISTS ranking_run_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  idempotency_key TEXT NOT NULL UNIQUE,
  community_id TEXT NOT NULL,
  request_kind TEXT NOT NULL
    CHECK (request_kind IN ('scheduled', 'manual', 'replacement', 'reconciliation')),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'claimed', 'completed', 'cancelled', 'failed')),
  requested_by TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  not_before TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  ranking_run_id UUID UNIQUE REFERENCES ranking_runs(id) ON DELETE SET NULL,
  failure JSONB CHECK (failure IS NULL OR jsonb_typeof(failure) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ranking_run_requests_pending
  ON ranking_run_requests (not_before, requested_at)
  WHERE state = 'pending';
