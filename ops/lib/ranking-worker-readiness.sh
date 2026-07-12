#!/usr/bin/env bash

RANKING_WORKER_HEARTBEAT_PREFIX="corgi:ranking-worker:heartbeat"
RANKING_WORKER_DEFAULT_COMMUNITY_ID="community-gov"
RANKING_WORKER_DEFAULT_SCORING_TIMEOUT_MS=240000
RANKING_WORKER_MIN_STOP_MARGIN_MS=60000

reject_shared_process_role() {
  local env_file="$1"
  if [ -f "$env_file" ] && grep -Eq '^[[:space:]]*(export[[:space:]]+)?PROCESS_ROLE[[:space:]]*=' "$env_file"; then
    echo "ERROR: ${env_file} must not define PROCESS_ROLE; shared EnvironmentFile values override both systemd unit roles" >&2
    return 1
  fi
}

resolve_ranking_community_id() {
  local env_file="$1"
  local community_id="${RANKING_WORKER_DEFAULT_COMMUNITY_ID}"
  local configured=""

  if [ -f "$env_file" ]; then
    if ! configured=$(sed -n 's/^[[:space:]]*RANKING_COMMUNITY_ID[[:space:]]*=[[:space:]]*//p' "$env_file" | tail -1); then
      echo "ERROR: could not read RANKING_COMMUNITY_ID from ${env_file}" >&2
      return 1
    fi
    configured=$(printf '%s' "$configured" | tr -d "\r\"'")
    if [ -n "$configured" ]; then
      community_id="$configured"
    fi
  fi

  printf '%s\n' "$community_id"
}

validate_ranking_worker_stop_timeout() {
  local unit_file="$1"
  local env_file="$2"
  local scoring_timeout_ms="${RANKING_WORKER_DEFAULT_SCORING_TIMEOUT_MS}"
  local configured_timeout=""
  local stop_timeout_seconds=""
  local stop_timeout_ms

  if [ ! -r "$unit_file" ]; then
    echo "ERROR: ranking worker unit is unreadable: ${unit_file}" >&2
    return 1
  fi
  if [ -f "$env_file" ]; then
    if ! configured_timeout=$(sed -n 's/^[[:space:]]*SCORING_TIMEOUT_MS[[:space:]]*=[[:space:]]*//p' "$env_file" | tail -1); then
      echo "ERROR: could not read SCORING_TIMEOUT_MS from ${env_file}" >&2
      return 1
    fi
    configured_timeout=$(printf '%s' "$configured_timeout" | tr -d "\r\"'")
    if [ -n "$configured_timeout" ]; then
      scoring_timeout_ms="$configured_timeout"
    fi
  fi
  if ! [[ "$scoring_timeout_ms" =~ ^[0-9]+$ ]]; then
    echo "ERROR: SCORING_TIMEOUT_MS must be an integer, got ${scoring_timeout_ms}" >&2
    return 1
  fi
  if ! stop_timeout_seconds=$(sed -n 's/^[[:space:]]*TimeoutStopSec[[:space:]]*=[[:space:]]*//p' "$unit_file" | tail -1); then
    echo "ERROR: could not read TimeoutStopSec from ${unit_file}" >&2
    return 1
  fi
  if ! [[ "$stop_timeout_seconds" =~ ^[0-9]+$ ]]; then
    echo "ERROR: TimeoutStopSec must be an integer number of seconds, got ${stop_timeout_seconds:-missing}" >&2
    return 1
  fi

  stop_timeout_ms=$((stop_timeout_seconds * 1000))
  if (( stop_timeout_ms - scoring_timeout_ms < RANKING_WORKER_MIN_STOP_MARGIN_MS )); then
    echo "ERROR: TimeoutStopSec=${stop_timeout_seconds} must exceed SCORING_TIMEOUT_MS=${scoring_timeout_ms} by at least ${RANKING_WORKER_MIN_STOP_MARGIN_MS}ms" >&2
    return 1
  fi
}

ranking_worker_heartbeat_is_healthy() {
  local heartbeat_json="$1"
  local restart_epoch_ms="$2"
  HEARTBEAT_JSON="$heartbeat_json" WORKER_RESTART_EPOCH_MS="$restart_epoch_ms" python3 -c 'import datetime, json, os; payload=json.loads(os.environ["HEARTBEAT_JSON"]); updated=datetime.datetime.fromisoformat(payload["updatedAt"].replace("Z", "+00:00")); age=(datetime.datetime.now(datetime.timezone.utc)-updated).total_seconds(); updated_ms=int(updated.timestamp()*1000); restart_ms=int(os.environ["WORKER_RESTART_EPOCH_MS"]); raise SystemExit(0 if 0 <= age <= 60 and updated_ms >= restart_ms and payload.get("state") != "failed" else 1)' 2>/dev/null
}

probe_ranking_worker_heartbeat_with_compose() {
  local timeout_seconds="$1"
  local compose_file="$2"
  local heartbeat_key="$3"
  timeout "$timeout_seconds" sudo docker compose -f "$compose_file" exec -T redis redis-cli --raw GET "$heartbeat_key" 2>/dev/null
}

probe_ranking_worker_heartbeat_with_docker() {
  local timeout_seconds="$1"
  local container_name="$2"
  local heartbeat_key="$3"
  timeout "$timeout_seconds" docker exec "$container_name" redis-cli --raw GET "$heartbeat_key" 2>/dev/null
}

wait_for_ranking_worker_ready() {
  local community_id="$1"
  local restart_epoch_ms="$2"
  local attempts="$3"
  local retry_delay_seconds="$4"
  local probe_function="$5"
  local heartbeat_key="${RANKING_WORKER_HEARTBEAT_PREFIX}:${community_id}"
  local attempt
  local heartbeat

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    heartbeat=""
    if ! heartbeat=$("$probe_function" "$heartbeat_key"); then
      echo "Ranking worker heartbeat probe failed (attempt ${attempt}/${attempts})" >&2
    elif [ -n "$heartbeat" ] && ranking_worker_heartbeat_is_healthy "$heartbeat" "$restart_epoch_ms"; then
      echo "Ranking worker heartbeat passed (attempt ${attempt}/${attempts})"
      return 0
    else
      echo "Ranking worker heartbeat is missing, malformed, stale, or failed (attempt ${attempt}/${attempts})" >&2
    fi
    if [ "$attempt" -lt "$attempts" ]; then
      sleep "$retry_delay_seconds"
    fi
  done

  return 1
}
