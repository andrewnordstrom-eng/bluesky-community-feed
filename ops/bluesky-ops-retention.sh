#!/usr/bin/env bash
set -euo pipefail

KEEP_VALID_DUMPS="${KEEP_VALID_DUMPS:-5}"
POSTGRES_DIR="${POSTGRES_BACKUP_DIR:-/opt/backups/postgres}"
LOCK_FILE="${BACKUP_LOCK_FILE:-/var/lock/bluesky-backups.lock}"
LOCK_FD=9

log() {
  logger -t bluesky-ops-retention "$*"
}

acquire_backup_lock() {
  mkdir -p "$(dirname "${LOCK_FILE}")"
  eval "exec ${LOCK_FD}>\"${LOCK_FILE}\""
  if ! flock -n "${LOCK_FD}"; then
    log "lock_held file=${LOCK_FILE}"
    exit 0
  fi
}

validate_gzip_dump() {
  gzip -t "$1" >/dev/null 2>&1
}

prune_postgres_backups() {
  local valid_count=0
  local invalid_removed=0
  local old_removed=0
  local backup_name=""
  local backup_path=""
  local kept_count=0

  mapfile -t backups < <(
    find "${POSTGRES_DIR}" -maxdepth 1 -type f -name 'dump-*.sql.gz' -printf '%f\n' | sort -r
  )

  for backup_name in "${backups[@]}"; do
    backup_path="${POSTGRES_DIR}/${backup_name}"

    if ! validate_gzip_dump "${backup_path}"; then
      rm -f "${backup_path}"
      invalid_removed=$((invalid_removed + 1))
      log "remove_invalid_dump file=${backup_path}"
      continue
    fi

    valid_count=$((valid_count + 1))
    if (( valid_count > KEEP_VALID_DUMPS )); then
      rm -f "${backup_path}"
      old_removed=$((old_removed + 1))
      log "remove_out_of_retention_dump file=${backup_path}"
    fi
  done

  find "${POSTGRES_DIR}" -maxdepth 1 -type f -name 'dump-*.sql' -delete -print 2>/dev/null | while read -r deleted; do
    log "remove_plain_dump file=${deleted}"
  done

  kept_count=$(( valid_count > KEEP_VALID_DUMPS ? KEEP_VALID_DUMPS : valid_count ))
  log "postgres_backup_retention kept=${kept_count} invalid_removed=${invalid_removed} old_removed=${old_removed} limit=${KEEP_VALID_DUMPS}"
}

MODE="${1:-full}"
if [[ "${MODE}" != "full" && "${MODE}" != "--postgres-only" ]]; then
  echo "usage: $0 [--postgres-only]" >&2
  exit 2
fi

if [[ ! -d "${POSTGRES_DIR}" ]]; then
  log "skip postgres_dir_missing path=${POSTGRES_DIR}"
  exit 0
fi

acquire_backup_lock

if [[ "${MODE}" == "--postgres-only" ]]; then
  prune_postgres_backups
  exit 0
fi

root_usage_before="$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
log "start root_usage=${root_usage_before}%"

/usr/sbin/logrotate -f /etc/logrotate.conf >/dev/null 2>&1 || log "warning: logrotate failed"
/usr/bin/journalctl --vacuum-size=300M >/dev/null 2>&1 || true

prune_postgres_backups

/usr/bin/docker container prune -f >/dev/null 2>&1 || true
/usr/bin/docker image prune -f >/dev/null 2>&1 || true

root_usage_after="$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
log "complete root_usage=${root_usage_after}%"
