#!/usr/bin/env bash
# claude-wrapper.sh — Wraps Claude Code CLI with rate-limit and network resilience
# Used inside klaude Docker containers

set -euo pipefail

STATUS_FILE="/tmp/klaude-status.json"
LOG_FILE="/tmp/klaude-run.log"
PROMPT_FILE="$1"
MAX_RETRIES="${2:-999}"  # effectively unlimited for overnight mode

# Backoff settings
RATE_LIMIT_BACKOFFS=(60 120 300 600 900)  # 1min, 2min, 5min, 10min, 15min cap
NETWORK_BACKOFFS=(30 60 120 300)           # 30s, 1min, 2min, 5min cap

rate_limit_count=0
network_error_count=0
attempt=0

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
  # Test connectivity to Anthropic API
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

# Read prompt
if [[ -f "$PROMPT_FILE" ]]; then
  PROMPT=$(cat "$PROMPT_FILE")
else
  PROMPT="$PROMPT_FILE"
fi

log "Starting claude-wrapper with prompt: ${PROMPT:0:100}..."

while [[ $attempt -lt $MAX_RETRIES ]]; do
  attempt=$((attempt + 1))
  write_status "running" "Attempt $attempt"
  log "Attempt $attempt/$MAX_RETRIES"

  # Run Claude Code in non-interactive print mode
  # Capture both stdout and stderr, don't fail on non-zero exit
  OUTPUT=""
  EXIT_CODE=0
  OUTPUT=$(claude --print --dangerously-skip-permissions "$PROMPT" 2>&1) || EXIT_CODE=$?

  # Check for rate limit
  if is_rate_limit "$OUTPUT"; then
    rate_limit_count=$((rate_limit_count + 1))

    # Try to parse reset time from output (e.g. "resets 12am", "resets 3pm")
    reset_hour=""
    if echo "$OUTPUT" | grep -qoiE "resets [0-9]+[ap]m"; then
      reset_hour=$(echo "$OUTPUT" | grep -oiE "resets [0-9]+[ap]m" | head -1 | grep -oiE "[0-9]+[ap]m")
    fi

    if [[ -n "$reset_hour" ]]; then
      # Calculate seconds until reset
      reset_epoch=$(date -d "today $reset_hour" +%s 2>/dev/null || date -d "tomorrow $reset_hour" +%s 2>/dev/null || echo "")
      now_epoch=$(date +%s)
      if [[ -n "$reset_epoch" ]] && [[ "$reset_epoch" -gt "$now_epoch" ]]; then
        backoff=$(( reset_epoch - now_epoch + 60 ))  # +60s margin
        log "Daily limit hit (#$rate_limit_count). Waiting until $reset_hour (~${backoff}s)..."
      else
        # Reset time is in the past — it's tomorrow
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

  # Check for network error
  if is_network_error "$OUTPUT"; then
    network_error_count=$((network_error_count + 1))
    backoff=$(get_backoff NETWORK_BACKOFFS $((network_error_count - 1)))

    log "Network error (#$network_error_count). Checking connectivity..."
    write_status "network_wait" "Network error #$network_error_count, checking connectivity"

    # Wait for network to come back
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

  # If exit code is 0, we're done
  if [[ $EXIT_CODE -eq 0 ]]; then
    log "Task completed successfully."
    write_status "completed" "Done"
    echo "$OUTPUT"
    exit 0
  fi

  # Non-rate-limit, non-network error — retry up to 2 extra times
  if [[ $attempt -ge 3 ]]; then
    log "Failed after $attempt attempts. Last output: ${OUTPUT:0:500}"
    write_status "failed" "Failed after $attempt attempts: ${OUTPUT:0:200}"
    echo "$OUTPUT" >&2
    exit 1
  fi

  log "Non-fatal error (exit $EXIT_CODE), retrying in 10s..."
  write_status "running" "Retrying after error (attempt $attempt)"
  sleep 10
done

log "Max retries ($MAX_RETRIES) exceeded."
write_status "failed" "Max retries exceeded"
exit 1
