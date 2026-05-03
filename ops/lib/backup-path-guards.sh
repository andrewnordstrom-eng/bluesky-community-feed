#!/usr/bin/env bash

backup_guard_emit_error() {
  local message="$1"

  if declare -F log >/dev/null 2>&1; then
    log "${message}"
    return
  fi

  echo "${message}" >&2
}

backup_guard_mount_error() {
  local mounted_target="$1"

  case "${BACKUP_GUARD_CONTEXT}" in
    daily)
      backup_guard_emit_error "ERROR: backup mount missing at ${BACKUP_MOUNT_ROOT} mounted_target=${mounted_target:-none}"
      ;;
    retention)
      backup_guard_emit_error "error backup_mount_missing path=${BACKUP_MOUNT_ROOT} mounted_target=${mounted_target:-none}"
      ;;
    install)
      backup_guard_emit_error "ERROR: required backup mount missing at ${BACKUP_MOUNT_ROOT} mounted_target=${mounted_target:-none}"
      ;;
    *)
      backup_guard_emit_error "ERROR: unknown backup guard context=${BACKUP_GUARD_CONTEXT:-unset}"
      ;;
  esac
}

backup_guard_python_error() {
  case "${BACKUP_GUARD_CONTEXT}" in
    retention)
      backup_guard_emit_error "error python3_required_for_backup_path_validation"
      ;;
    *)
      backup_guard_emit_error "ERROR: python3 required for backup path validation"
      ;;
  esac
}

backup_guard_descendant_error() {
  local label="$1"
  local path="$2"

  case "${BACKUP_GUARD_CONTEXT}" in
    retention)
      backup_guard_emit_error "error backup_path_outside_mount label=${label} path=${path} mount=${BACKUP_MOUNT_ROOT}"
      ;;
    *)
      backup_guard_emit_error "ERROR: ${label} must be under ${BACKUP_MOUNT_ROOT}; got ${path}"
      ;;
  esac
}

normalize_mount_path() {
  local path="$1"

  if [[ -z "${path}" ]]; then
    printf '%s\n' ""
    return
  fi

  while [[ "${path}" != "/" && "${path}" == */ ]]; do
    path="${path%/}"
  done

  printf '%s\n' "${path}"
}

require_backup_mount() {
  local mounted_target=""
  local expected_target=""

  expected_target="$(normalize_mount_path "${BACKUP_MOUNT_ROOT}")"
  mounted_target="$(findmnt -n -o TARGET --target "${expected_target}" 2>/dev/null || true)"
  mounted_target="$(normalize_mount_path "${mounted_target}")"
  if [[ -z "${mounted_target}" || "${mounted_target}" != "${expected_target}" ]]; then
    backup_guard_mount_error "${mounted_target}"
    exit 1
  fi
}

normalize_backup_path() {
  local path="$1"

  if ! command -v python3 >/dev/null 2>&1; then
    backup_guard_python_error
    exit 1
  fi
  python3 - "${path}" <<'PY'
import os
import sys

print(os.path.realpath(sys.argv[1]))
PY
}

require_backup_descendant() {
  local label="$1"
  local path="$2"
  local mount_root=""
  local normalized_path=""

  mount_root="$(normalize_backup_path "${BACKUP_MOUNT_ROOT}")"
  normalized_path="$(normalize_backup_path "${path}")"
  case "${normalized_path}" in
    "${mount_root}"/*)
      return
      ;;
  esac

  backup_guard_descendant_error "${label}" "${path}"
  exit 1
}
