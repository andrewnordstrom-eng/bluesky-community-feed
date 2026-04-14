#!/usr/bin/env bash
set -euo pipefail

KEEP_VALID_DUMPS="${KEEP_VALID_DUMPS:-5}"
BACKUP_MOUNT_ROOT="${BACKUP_MOUNT_ROOT:-/mnt/host-backups}"
POSTGRES_DIR="${POSTGRES_BACKUP_DIR:-${BACKUP_MOUNT_ROOT}/postgres}"
LOCK_FILE="${BACKUP_LOCK_FILE:-/var/lock/bluesky-backups.lock}"

log() {
  logger -t bluesky-ops-retention "$*"
}

require_backup_mount() {
  if ! findmnt -T "${BACKUP_MOUNT_ROOT}" >/dev/null 2>&1; then
    log "error backup_mount_missing path=${BACKUP_MOUNT_ROOT}"
    exit 1
  fi
}

acquire_backup_lock() {
  mkdir -p "$(dirname "${LOCK_FILE}")"
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    log "lock_held file=${LOCK_FILE}"
    exit 0
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

prune_postgres_backups() {
  local -a backups=()
  local valid_count=0
  local invalid_removed=0
  local synthetic_removed=0
  local old_removed=0
  local backup_name=""
  local backup_path=""
  local dump_date=""
  local kept_count=0
  local today=""

  today="$(date +%F)"

  mapfile -t backups < <(
    find "${POSTGRES_DIR}" -maxdepth 1 -type f -name '*.sql.gz' -printf '%f\n' | sort -r
  )

  for backup_name in "${backups[@]}"; do
    backup_path="${POSTGRES_DIR}/${backup_name}"

    if ! dump_date="$(canonical_dump_date "${backup_name}")"; then
      rm -f "${backup_path}"
      invalid_removed=$((invalid_removed + 1))
      synthetic_removed=$((synthetic_removed + 1))
      log "remove_synthetic_dump file=${backup_path} reason=noncanonical_name"
      continue
    fi

    if [[ "${dump_date}" > "${today}" ]]; then
      rm -f "${backup_path}"
      invalid_removed=$((invalid_removed + 1))
      synthetic_removed=$((synthetic_removed + 1))
      log "remove_synthetic_dump file=${backup_path} reason=future_date"
      continue
    fi

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
  log "postgres_backup_retention kept=${kept_count} invalid_removed=${invalid_removed} synthetic_removed=${synthetic_removed} old_removed=${old_removed} limit=${KEEP_VALID_DUMPS}"
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

if ! command -v python3 >/dev/null 2>&1; then
  echo "error python3_required" >&2
  log "error python3_required"
  exit 1
fi

require_backup_mount
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
