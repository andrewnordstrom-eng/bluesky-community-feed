#!/usr/bin/env bash
set -euo pipefail

DATE="$(date +%Y-%m-%d)"
KEEP_VALID_DUMPS="${KEEP_VALID_DUMPS:-5}"
MIN_DUMP_BYTES="${MIN_DUMP_BYTES:-1048576}"
BACKUP_MOUNT_ROOT="${BACKUP_MOUNT_ROOT:-/mnt/host-backups}"
POSTGRES_DIR="${POSTGRES_BACKUP_DIR:-${BACKUP_MOUNT_ROOT}/postgres}"
IGOR_DIR="${IGOR_BACKUP_DIR:-${BACKUP_MOUNT_ROOT}/igor/daily}"
LOCK_FILE="${BACKUP_LOCK_FILE:-/var/lock/bluesky-backups.lock}"
SQLITE_BACKUP_TIMEOUT_SECONDS="${SQLITE_BACKUP_TIMEOUT_SECONDS:-600}"
DUMP_FILE="${POSTGRES_DIR}/dump-${DATE}.sql.gz"
TMP_DUMP=""
DUMP_STDERR=""
IGOR_TMP=""
IGOR_TMP_GZ=""

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

source_backup_guard_library() {
  local script_dir=""
  local guard_path=""

  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for guard_path in "${script_dir}/lib/backup-path-guards.sh" "/opt/backups/lib/backup-path-guards.sh" "/opt/bluesky-feed/ops/lib/backup-path-guards.sh"; do
    if [[ -r "${guard_path}" ]]; then
      # shellcheck source=/dev/null
      source "${guard_path}"
      return
    fi
  done

  log "ERROR: required backup guard library missing"
  exit 1
}

BACKUP_GUARD_CONTEXT="daily"
source_backup_guard_library

acquire_backup_lock() {
  mkdir -p "$(dirname "${LOCK_FILE}")"
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    log "lock_held file=${LOCK_FILE}"
    exit 0
  fi
}

cleanup_tmp_artifacts() {
  if [[ -n "${TMP_DUMP}" && -f "${TMP_DUMP}" ]]; then
    rm -f "${TMP_DUMP}"
  fi
  if [[ -n "${DUMP_STDERR}" && -f "${DUMP_STDERR}" ]]; then
    rm -f "${DUMP_STDERR}"
  fi
  if [[ -n "${IGOR_TMP}" && -f "${IGOR_TMP}" ]]; then
    rm -f "${IGOR_TMP}"
  fi
  if [[ -n "${IGOR_TMP_GZ}" && -f "${IGOR_TMP_GZ}" ]]; then
    rm -f "${IGOR_TMP_GZ}"
  fi
}

validate_gzip_dump() {
  gzip -t "$1" >/dev/null 2>&1
}

canonical_dump_date() {
  local filename="$1"
  local dump_date=""
  if [[ "${filename}" =~ ^dump-([0-9]{4}-[0-9]{2}-[0-9]{2})\.sql\.gz$ ]]; then
    dump_date="${BASH_REMATCH[1]}"
    if ! python3 - "${dump_date}" <<'PY'
import datetime
import sys

try:
    datetime.date.fromisoformat(sys.argv[1])
except ValueError:
    raise SystemExit(1)
PY
    then
      return 1
    fi
    printf '%s\n' "${dump_date}"
    return 0
  fi
  return 1
}

create_sqlite_backup() {
  timeout --foreground "${SQLITE_BACKUP_TIMEOUT_SECONDS}s" python3 - "$1" "$2" <<'PY'
import sqlite3
import sys

source_path, backup_path = sys.argv[1], sys.argv[2]

source = sqlite3.connect(source_path)
target = sqlite3.connect(backup_path)
try:
    source.backup(target)
finally:
    target.close()
    source.close()
PY
}

validate_sqlite_backup() {
  python3 - "$1" <<'PY'
import sqlite3
import sys

database_path = sys.argv[1]

connection = sqlite3.connect(database_path)
try:
    result = connection.execute("PRAGMA integrity_check").fetchone()
finally:
    connection.close()

if not result or result[0] != "ok":
    raise SystemExit(1)
PY
}

prune_postgres_backups() {
  local -a backups=()
  local valid_count=0
  local invalid_removed=0
  local synthetic_removed=0
  local old_removed=0
  local backup_name=""
  local backup_path=""
  local dump_date=""
  local today=""

  today="$(date +%F)"

  mapfile -t backups < <(
    find "${POSTGRES_DIR}" -maxdepth 1 -type f -name '*.sql.gz' -printf '%f\n' | sort -r
  )

  for backup_name in "${backups[@]}"; do
    backup_path="${POSTGRES_DIR}/${backup_name}"

    if ! dump_date="$(canonical_dump_date "${backup_name}")"; then
      log "Removing synthetic PostgreSQL dump: ${backup_path} (reason=noncanonical_name)"
      rm -f "${backup_path}"
      invalid_removed=$((invalid_removed + 1))
      synthetic_removed=$((synthetic_removed + 1))
      continue
    fi

    if [[ "${dump_date}" > "${today}" ]]; then
      log "Removing synthetic PostgreSQL dump: ${backup_path} (reason=future_date)"
      rm -f "${backup_path}"
      invalid_removed=$((invalid_removed + 1))
      synthetic_removed=$((synthetic_removed + 1))
      continue
    fi

    if ! validate_gzip_dump "${backup_path}"; then
      log "Removing invalid PostgreSQL dump: ${backup_path}"
      rm -f "${backup_path}"
      invalid_removed=$((invalid_removed + 1))
      continue
    fi

    valid_count=$((valid_count + 1))
    if (( valid_count > KEEP_VALID_DUMPS )); then
      log "Removing out-of-retention PostgreSQL dump: ${backup_path}"
      rm -f "${backup_path}"
      old_removed=$((old_removed + 1))
    fi
  done

  find "${POSTGRES_DIR}" -maxdepth 1 -type f -name 'dump-*.sql' -delete -print || true
  log "PostgreSQL retention summary: kept=$(( valid_count > KEEP_VALID_DUMPS ? KEEP_VALID_DUMPS : valid_count )) invalid_removed=${invalid_removed} synthetic_removed=${synthetic_removed} old_removed=${old_removed} limit=${KEEP_VALID_DUMPS}"
}

trap cleanup_tmp_artifacts EXIT

require_backup_mount
require_backup_descendant "POSTGRES_BACKUP_DIR" "${POSTGRES_DIR}"
require_backup_descendant "IGOR_BACKUP_DIR" "${IGOR_DIR}"
mkdir -p "${POSTGRES_DIR}" "${IGOR_DIR}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "error python3_required" >&2
  log "ERROR: python3 required for backup retention validation"
  exit 1
fi

acquire_backup_lock

log "Starting daily backup..."

DISK_PCT="$(df / --output=pcent | tail -1 | tr -d ' %')"
if [ "${DISK_PCT}" -gt 85 ]; then
  log "WARNING: Disk usage at ${DISK_PCT}% before backup"
fi

TMP_DUMP="$(mktemp "${POSTGRES_DIR}/.dump-${DATE}.sql.gz.tmp.XXXXXX")"
DUMP_STDERR="$(mktemp)"

log "Dumping PostgreSQL..."
if ! docker exec bluesky-feed-postgres pg_dumpall -U feed 2>"${DUMP_STDERR}" | gzip -c > "${TMP_DUMP}"; then
  stderr_snippet="$(head -c 500 "${DUMP_STDERR}" | tr '\n' ' ')"
  log "ERROR: PostgreSQL dump failed before validation: ${stderr_snippet:-unknown error}"
  exit 1
fi
rm -f "${DUMP_STDERR}"
DUMP_STDERR=""

DUMP_SIZE="$(stat -c%s "${TMP_DUMP}" 2>/dev/null || echo 0)"
if [ "${DUMP_SIZE}" -lt "${MIN_DUMP_BYTES}" ]; then
  log "ERROR: Dump file suspiciously small (${DUMP_SIZE} bytes) — refusing to retain"
  exit 1
fi

if ! validate_gzip_dump "${TMP_DUMP}"; then
  log "ERROR: Dump file failed gzip integrity validation — refusing to retain"
  exit 1
fi

mv -f "${TMP_DUMP}" "${DUMP_FILE}"
TMP_DUMP=""
log "PostgreSQL dump: ${DUMP_FILE} ($(du -h "${DUMP_FILE}" | cut -f1))"

IGOR_DB=""
if [ -f /opt/igor/data/igor-queue.sqlite ]; then
  IGOR_DB="/opt/igor/data/igor-queue.sqlite"
elif [ -f /opt/igor/data/igor.db ]; then
  IGOR_DB="/opt/igor/data/igor.db"
elif [ -f /opt/igor/igor.db ]; then
  IGOR_DB="/opt/igor/igor.db"
fi

if [ -n "${IGOR_DB}" ]; then
  log "Copying Igor SQLite..."
  IGOR_TMP="${IGOR_DIR}/.igor-${DATE}.db.tmp"
  if ! create_sqlite_backup "${IGOR_DB}" "${IGOR_TMP}"; then
    log "ERROR: Igor SQLite backup failed during snapshot creation"
    exit 1
  fi

  if ! validate_sqlite_backup "${IGOR_TMP}"; then
    log "ERROR: Igor SQLite backup failed integrity_check"
    exit 1
  fi

  gzip -f "${IGOR_TMP}"
  IGOR_TMP_GZ="${IGOR_TMP}.gz"
  if ! validate_gzip_dump "${IGOR_TMP_GZ}"; then
    log "ERROR: Igor SQLite backup failed gzip validation"
    exit 1
  fi

  mv -f "${IGOR_TMP_GZ}" "${IGOR_DIR}/igor-${DATE}.db.gz"
  IGOR_TMP=""
  IGOR_TMP_GZ=""
  log "Igor backup: ${IGOR_DIR}/igor-${DATE}.db.gz"
else
  log "No Igor SQLite found — skipping"
fi

log "Pruning PostgreSQL backups to latest ${KEEP_VALID_DUMPS} valid dumps..."
prune_postgres_backups

find "${IGOR_DIR}" -maxdepth 1 -type f -name 'igor-*.db.gz' -mtime +7 -delete -print || true

log "Backup complete."
