#!/usr/bin/env bash
set -euo pipefail

DATE="$(date +%Y-%m-%d)"
KEEP_VALID_DUMPS="${KEEP_VALID_DUMPS:-5}"
MIN_DUMP_BYTES="${MIN_DUMP_BYTES:-1048576}"
POSTGRES_DIR="${POSTGRES_BACKUP_DIR:-/opt/backups/postgres}"
IGOR_DIR="${IGOR_BACKUP_DIR:-/opt/backups/igor}"
LOCK_FILE="${BACKUP_LOCK_FILE:-/var/lock/bluesky-backups.lock}"
LOCK_FD=9
DUMP_FILE="${POSTGRES_DIR}/dump-${DATE}.sql.gz"
TMP_DUMP=""

log() {
  echo "[$(date --iso-8601=seconds)] $*"
}

acquire_backup_lock() {
  mkdir -p "$(dirname "${LOCK_FILE}")"
  eval "exec ${LOCK_FD}>\"${LOCK_FILE}\""
  if ! flock -n "${LOCK_FD}"; then
    log "lock_held file=${LOCK_FILE}"
    exit 0
  fi
}

cleanup_tmp_dump() {
  if [[ -n "${TMP_DUMP}" && -f "${TMP_DUMP}" ]]; then
    rm -f "${TMP_DUMP}"
  fi
}

validate_gzip_dump() {
  gzip -t "$1" >/dev/null 2>&1
}

prune_postgres_backups() {
  local valid_count=0
  local backup_name=""
  local backup_path=""

  mapfile -t backups < <(
    find "${POSTGRES_DIR}" -maxdepth 1 -type f -name 'dump-*.sql.gz' -printf '%f\n' | sort -r
  )

  for backup_name in "${backups[@]}"; do
    backup_path="${POSTGRES_DIR}/${backup_name}"
    if ! validate_gzip_dump "${backup_path}"; then
      log "Removing invalid PostgreSQL dump: ${backup_path}"
      rm -f "${backup_path}"
      continue
    fi

    valid_count=$((valid_count + 1))
    if (( valid_count > KEEP_VALID_DUMPS )); then
      log "Removing out-of-retention PostgreSQL dump: ${backup_path}"
      rm -f "${backup_path}"
    fi
  done

  find "${POSTGRES_DIR}" -maxdepth 1 -type f -name 'dump-*.sql' -delete -print || true
}

trap cleanup_tmp_dump EXIT

mkdir -p "${POSTGRES_DIR}" "${IGOR_DIR}"
acquire_backup_lock

log "Starting daily backup..."

DISK_PCT="$(df / --output=pcent | tail -1 | tr -d ' %')"
if [ "${DISK_PCT}" -gt 85 ]; then
  log "WARNING: Disk usage at ${DISK_PCT}% before backup"
fi

TMP_DUMP="$(mktemp "${POSTGRES_DIR}/.dump-${DATE}.sql.gz.tmp.XXXXXX")"

log "Dumping PostgreSQL..."
if ! docker exec bluesky-feed-postgres pg_dumpall -U feed 2>/dev/null | gzip -c > "${TMP_DUMP}"; then
  log "ERROR: PostgreSQL dump failed before validation"
  exit 1
fi

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
  cp "${IGOR_DB}" "${IGOR_DIR}/igor-${DATE}.db"
  gzip -f "${IGOR_DIR}/igor-${DATE}.db"
  log "Igor backup: ${IGOR_DIR}/igor-${DATE}.db.gz"
else
  log "No Igor SQLite found — skipping"
fi

log "Pruning PostgreSQL backups to latest ${KEEP_VALID_DUMPS} valid dumps..."
prune_postgres_backups

find "${IGOR_DIR}" -maxdepth 1 -type f -name 'igor-*.db.gz' -mtime +7 -delete -print || true

log "Backup complete."
