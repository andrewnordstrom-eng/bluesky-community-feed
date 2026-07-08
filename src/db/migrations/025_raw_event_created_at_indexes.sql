-- migrate: no-transaction
-- Migration 025: created_at indexes on raw event tables (retention root-cause fix)
--
-- The hourly retention cleanup (src/maintenance/cleanup.ts) deletes rows from
-- likes/reposts/follows filtered by `created_at < NOW() - <window>`. Migration
-- 001 created only subject_uri/author_did indexes on these tables, so every
-- retention DELETE seq-scans the full table (likes ~48M rows) and hits the
-- 120s statement_timeout (SQLSTATE 57014) before deleting a single row. In
-- production this made retention a no-op on every run and let the tables grow
-- unbounded until the root disk filled.
--
-- A plain b-tree on created_at lets the delete subqueries drain oldest-first via
-- an index scan. The NOT EXISTS(post_scores) guard references another table, so
-- a partial predicate index is not applicable; a plain index is correct here.
-- Built concurrently on live production data, so this file opts out of the
-- migration runner's transaction wrapper.
--
-- Rollback, if needed:
--   DROP INDEX CONCURRENTLY IF EXISTS idx_likes_created;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_reposts_created;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_follows_created;

-- Larger sort memory speeds the build; session-scoped, reverts on disconnect.
SET maintenance_work_mem = '512MB';

-- This file's own header notes the cleanup path hits a 120s statement_timeout
-- on these same high-volume tables (likes ~48M rows). If that (or any)
-- statement_timeout applies to the migration session, a CREATE INDEX
-- CONCURRENTLY build that runs long can be canceled mid-build and leave an
-- INVALID index behind (visible via pg_index.indisvalid = false) rather than
-- rolling back cleanly, since CONCURRENTLY does not run inside a transaction.
-- Disabling it for this session (scoped to this connection; reverts on
-- disconnect, same as maintenance_work_mem above) lets all three builds run
-- to completion regardless of how long they take.
SET statement_timeout = 0;

-- Build order smallest/fastest-growing first (follows deleter is unconditional).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follows_created ON follows (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reposts_created ON reposts (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_likes_created   ON likes (created_at);
