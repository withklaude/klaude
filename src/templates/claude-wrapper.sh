#!/usr/bin/env bash
# claude-wrapper.sh — Starts Claude Code with agent.md instructions.
# Handles ONLY error recovery: rate limits, network errors, crashes.
# On failure, resumes the same session with --continue.
#
# Usage: claude-wrapper [MAX_RETRIES]

set -euo pipefail

STATUS_FILE="/tmp/klaude-status.json"
LOG_FILE="/tmp/klaude-run.log"
MAX_RETRIES="${1:-999}"

RATE_LIMIT_BACKOFFS=(60 120 300 600 900)
NETWORK_BACKOFFS=(30 60 120 300)

rate_limit_count=0
network_error_count=0
attempt=0
has_session=false

START_PROMPT="Read /agent.md and follow the instructions to execute all tasks."
RESUME_PROMPT="The session was interrupted. Read /tmp/klaude-tasks-status.json to see what is already done, then continue with the remaining tasks."

write_status() {
  local status="$1"
  local message="${2:-}"
  local retry_at="${3:-}"
  cat > "$STATUS_FILE" <<STATUSEOF
{
  "status": "$status",
  "message": "$message",
  "retry_at": "$retry_at",
  "rate_limits_hit": $rate_limit_count,
  "network_errors": $network_error_count,
  "attempt": $attempt,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
STATUSEOF
}

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

get_backoff() {
  local -n arr=$1
  local count=$2
  local idx=$((count < ${#arr[@]} ? count : ${#arr[@]} - 1))
  echo "${arr[$idx]}"
}

check_network() {
  curl -s --max-time 10 -o /dev/null -w "%{http_code}" https://api.anthropic.com/ 2>/dev/null || echo "000"
}

is_rate_limit() {
  local output="$1"
  echo "$output" | grep -qiE "(rate.?limit.*(exceeded|hit|error|retry)|HTTP 429|too many requests|resource.+exhausted|overloaded|hit your limit|limit.+resets)" 2>/dev/null
}

is_network_error() {
  local output="$1"
  echo "$output" | grep -qiE "(ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network error|connection refused|getaddrinfo|EHOSTUNREACH)" 2>/dev/null
}

log "Starting claude-wrapper (agent mode)..."

while [[ $attempt -lt $MAX_RETRIES ]]; do
  attempt=$((attempt + 1))
  write_status "running" "Attempt $attempt"
  log "Attempt $attempt/$MAX_RETRIES"

  OUTPUT=""
  EXIT_CODE=0

  if ! $has_session; then
    OUTPUT=$(claude --print --dangerously-skip-permissions "$START_PROMPT" 2>&1) || EXIT_CODE=$?
  else
    log "Resuming session with --continue..."
    OUTPUT=$(claude --print --dangerously-skip-permissions --continue "$RESUME_PROMPT" 2>&1) || EXIT_CODE=$?
  fi

  # Rate limit → backoff and retry
  if is_rate_limit "$OUTPUT"; then
    has_session=true
    rate_limit_count=$((rate_limit_count + 1))

    reset_hour=""
    if echo "$OUTPUT" | grep -qoiE "resets [0-9]+[ap]m"; then
      reset_hour=$(echo "$OUTPUT" | grep -oiE "resets [0-9]+[ap]m" | head -1 | grep -oiE "[0-9]+[ap]m")
    fi

    if [[ -n "$reset_hour" ]]; then
      reset_epoch=$(date -d "today $reset_hour" +%s 2>/dev/null || date -d "tomorrow $reset_hour" +%s 2>/dev/null || echo "")
      now_epoch=$(date +%s)
      if [[ -n "$reset_epoch" ]] && [[ "$reset_epoch" -gt "$now_epoch" ]]; then
        backoff=$(( reset_epoch - now_epoch + 60 ))
        log "Daily limit hit (#$rate_limit_count). Waiting until $reset_hour (~${backoff}s)..."
      else
        reset_epoch=$(date -d "tomorrow $reset_hour" +%s 2>/dev/null || echo "")
        if [[ -n "$reset_epoch" ]]; then
          backoff=$(( reset_epoch - now_epoch + 60 ))
          log "Daily limit hit (#$rate_limit_count). Waiting until tomorrow $reset_hour (~${backoff}s)..."
        else
          backoff=$(get_backoff RATE_LIMIT_BACKOFFS $((rate_limit_count - 1)))
          log "Rate limit hit (#$rate_limit_count). Waiting ${backoff}s..."
        fi
      fi
    else
      backoff=$(get_backoff RATE_LIMIT_BACKOFFS $((rate_limit_count - 1)))
      log "Rate limit hit (#$rate_limit_count). Waiting ${backoff}s..."
    fi

    retry_at=$(date -u -d "+${backoff} seconds" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
    write_status "rate_limited" "Rate limit #$rate_limit_count, waiting ${backoff}s" "$retry_at"
    sleep "$backoff"
    continue
  fi

  # Network error → wait for connectivity and retry
  if is_network_error "$OUTPUT"; then
    has_session=true
    network_error_count=$((network_error_count + 1))
    backoff=$(get_backoff NETWORK_BACKOFFS $((network_error_count - 1)))

    log "Network error (#$network_error_count). Checking connectivity..."
    write_status "network_wait" "Network error #$network_error_count, checking connectivity"

    while true; do
      sleep "$backoff"
      http_code=$(check_network)
      if [[ "$http_code" != "000" ]]; then
        log "Network restored (HTTP $http_code). Resuming..."
        break
      fi
      log "Still no connectivity. Waiting ${backoff}s more..."
      write_status "network_wait" "Waiting for network... (${backoff}s intervals)"
    done
    continue
  fi

  # Success → done
  if [[ $EXIT_CODE -eq 0 ]]; then
    log "Session completed successfully."
    write_status "completed" "Done"
    echo "$OUTPUT"
    exit 0
  fi

  # Fatal auth error → stop immediately
  if echo "$OUTPUT" | grep -qiE "(Invalid API key|invalid.*auth|unauthorized|forbidden.*api|expired.*token|Fix external API key|invalid_api_key)"; then
    log "FATAL: Authentication error."
    write_status "failed" "Auth error — check API key or Claude config"
    echo "$OUTPUT" >&2
    exit 1
  fi

  # Non-fatal error → resume with --continue
  has_session=true
  log "Non-fatal error (exit $EXIT_CODE), resuming in 10s..."
  write_status "running" "Resuming after error (attempt $attempt)"
  sleep 10
done

log "Max retries ($MAX_RETRIES) exceeded."
write_status "failed" "Max retries exceeded"
exit 1
