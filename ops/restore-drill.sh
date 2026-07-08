#!/usr/bin/env bash
# restore-drill.sh — PROJ-917 pgBackRest restore verification drill
#
# STATUS: reviewed artifact, NOT live-tested. Written and checked against
# https://pgbackrest.org/user-guide.html and https://pgbackrest.org/command.html,
# but this environment has no running pgBackRest stanza, no real backup set,
# and no DigitalOcean Spaces credentials to exercise repo2 against. Dry-run
# this by hand (read through it, run it piece by piece) before trusting it
# during a real incident. See ops/pgbackrest/README.md for the setup this
# depends on.
#
# Restores the newest available backup into a throwaway, fully isolated
# postgres container + throwaway Docker volume — never touches the real
# bluesky-feed-postgres container, its volume, or its port — then runs a
# handful of integrity checks and tears the throwaway container/volume
# down. Exits non-zero if the restore fails to come up or any check fails.
#
# Usage: ops/restore-drill.sh
#
# Requires: docker, and pgbackrest reachable via `docker run` against the
# same image family used in production (postgres:16 + pgbackrest — see
# ops/pgbackrest/README.md Option A). If pgbackrest is only installed as a
# bare-metal host sidecar (README Option B), replace the `docker run ...
# pgbackrest restore` invocation below with a direct host `pgbackrest`
# call instead.
#
# If repo1 (local disk) is unavailable or empty, export the repo2 (Spaces)
# secrets before running so pgbackrest can fall back to it:
#   PGBACKREST_REPO2_S3_BUCKET, PGBACKREST_REPO2_S3_KEY, PGBACKREST_REPO2_S3_KEY_SECRET
#
# KNOWN LIMITATION (untested against real infra, so left honest rather than
# silently "fixed"): step 3 below starts the throwaway runtime container
# from plain $POSTGRES_IMAGE (default postgres:16), which does NOT have the
# `pgbackrest` binary installed — unlike step 2's restore container, which
# installs it on the fly via `apt-get` before running `pgbackrest restore`.
# `pgbackrest restore` writes a `restore_command` into the restored
# `postgresql.auto.conf` that shells out to `pgbackrest archive-get`
# (https://pgbackrest.org, `archive-get`/`restore` docs). Postgres prefers
# WAL segments already present in `pg_wal` over calling `restore_command`,
# so this drill only reliably validates the base-backup-to-consistency
# path; if recovery ever needs to replay WAL beyond what was restored
# locally (e.g. a base backup that's old relative to the newest archived
# WAL), postgres's recovery will try to invoke `restore_command`, find no
# `pgbackrest` binary in this container, and fail to start — the drill
# will then time out (see READY_TIMEOUT_SECONDS) and exit non-zero, with
# the real error visible via the container-log dump in `cleanup()` below.
# To actually exercise that path, point POSTGRES_IMAGE at a build that
# already includes pgbackrest (README Option A's Dockerfile, reused for
# this drill) instead of stock postgres:16 — not done here, since building
# and validating that image needs the real droplet this environment
# doesn't have.

set -euo pipefail

STANZA="corgi"
DRILL_NAME="corgi-restore-drill"
DRILL_VOLUME="corgi-restore-drill-data"
DRILL_PORT="${DRILL_PORT:-55433}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16}"
PGBACKREST_CONFIG_DIR="${PGBACKREST_CONFIG_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pgbackrest}"
LOCAL_REPO_PATH="${LOCAL_REPO_PATH:-/mnt/host-backups/pgbackrest}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-180}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

cleanup() {
  local exit_code=$?
  # Any non-zero exit — a failed run_check under `set -e`, the readiness
  # timeout, or anything else — lands here before the container is torn
  # down. Dump its logs first so a failed drill still leaves diagnostics;
  # this is the highest-cost place to lose them (a disaster-recovery drill
  # failure is exactly when you need to know why).
  if [ "$exit_code" -ne 0 ]; then
    log "Drill exiting with status ${exit_code} — dumping container logs before cleanup..."
    docker logs "$DRILL_NAME" 2>&1 || true
  fi
  log "Cleaning up throwaway restore container/volume..."
  docker rm -f "$DRILL_NAME" >/dev/null 2>&1 || true
  docker volume rm "$DRILL_VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "Starting restore drill for stanza=${STANZA} (throwaway target only — production is never touched)"

# 1. Fresh, empty data volume as the restore target.
docker volume create "$DRILL_VOLUME" >/dev/null

# 2. Restore the newest backup into that volume. pgbackrest auto-selects
# the latest backup when --set is not given. Runs inside a throwaway
# container built from the same image family as production so the
# pgbackrest binary/version matches what actually wrote the backup.
docker run --rm \
  -v "${DRILL_VOLUME}:/var/lib/postgresql/data" \
  -v "${PGBACKREST_CONFIG_DIR}/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro" \
  -v "${LOCAL_REPO_PATH}:${LOCAL_REPO_PATH}:ro" \
  -e PGBACKREST_REPO2_S3_BUCKET \
  -e PGBACKREST_REPO2_S3_KEY \
  -e PGBACKREST_REPO2_S3_KEY_SECRET \
  --user root \
  "$POSTGRES_IMAGE" \
  bash -c "apt-get update -qq && apt-get install -y -qq pgbackrest >/dev/null && \
    pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=${STANZA} \
      --pg1-path=/var/lib/postgresql/data --log-level-console=info restore"

# 3. Start a throwaway postgres against the restored volume. No
# POSTGRES_USER/PASSWORD needed — PGDATA is already initialized (restored
# from a real cluster), so the entrypoint skips initdb and starts as-is
# with whatever roles the backup already contains.
#
# NOTE: $POSTGRES_IMAGE here has no pgbackrest binary — see the
# "KNOWN LIMITATION" note in the file header. If recovery needs
# restore_command/archive-get, this container will fail to come up.
docker run -d --name "$DRILL_NAME" \
  -v "${DRILL_VOLUME}:/var/lib/postgresql/data" \
  -p "127.0.0.1:${DRILL_PORT}:5432" \
  "$POSTGRES_IMAGE"

# 4. Wait for it to become ready (WAL replay during recovery can take a
# while depending on how far behind the base backup is).
log "Waiting up to ${READY_TIMEOUT_SECONDS}s for restored postgres to become ready..."
elapsed=0
until docker exec "$DRILL_NAME" pg_isready -U feed >/dev/null 2>&1; do
  sleep 5
  elapsed=$((elapsed + 5))
  if [ "$elapsed" -ge "$READY_TIMEOUT_SECONDS" ]; then
    log "ERROR: restored postgres did not become ready within ${READY_TIMEOUT_SECONDS}s"
    # Logs are dumped uniformly by the cleanup trap below on any non-zero exit.
    exit 1
  fi
done
log "Restored postgres is ready after ${elapsed}s"

# 5. Integrity checks.
run_check() {
  local description="$1" sql="$2"
  local result
  result="$(docker exec "$DRILL_NAME" psql -U feed -d bluesky_feed -tA -c "$sql")"
  log "CHECK: ${description} => ${result}"
  printf '%s' "$result"
}

log "Running integrity checks against the restored database..."

posts_count="$(run_check "posts row count" "SELECT COUNT(*) FROM posts;")"
likes_count="$(run_check "likes row count" "SELECT COUNT(*) FROM likes;")"
reposts_count="$(run_check "reposts row count" "SELECT COUNT(*) FROM reposts;")"
follows_count="$(run_check "follows row count" "SELECT COUNT(*) FROM follows;")"

active_epochs="$(run_check "active governance epoch count (expect 1)" \
  "SELECT COUNT(*) FROM governance_epochs WHERE status = 'active';")"

orphaned_scores="$(run_check "orphaned post_scores count (expect 0)" \
  "SELECT COUNT(*) FROM post_scores ps WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.uri = ps.post_uri);")"

schema_migrations_count="$(run_check "schema_migrations row count" \
  "SELECT COUNT(*) FROM schema_migrations;")"

log "Summary: posts=${posts_count} likes=${likes_count} reposts=${reposts_count} follows=${follows_count} active_epochs=${active_epochs} orphaned_scores=${orphaned_scores} schema_migrations=${schema_migrations_count}"

failed=0
if [ "$active_epochs" != "1" ]; then
  log "FAIL: expected exactly 1 active governance epoch, got ${active_epochs}"
  failed=1
fi
if [ "$orphaned_scores" != "0" ]; then
  log "FAIL: expected 0 orphaned post_scores rows, got ${orphaned_scores}"
  failed=1
fi
if [ "$schema_migrations_count" -lt 1 ]; then
  log "FAIL: schema_migrations table is empty — restore looks incomplete"
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  log "RESTORE DRILL FAILED — see FAIL lines above"
  exit 1
fi

log "RESTORE DRILL PASSED"
