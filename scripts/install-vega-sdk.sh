#!/usr/bin/env bash
# Install the Vega SDK (and its Simulator package) on a slow or unreliable network.
#
# `vega sdk install` cannot resume a download and has no stall timeout, so this
# wrapper restarts it when progress freezes for 120 s or the connection resets.
# Run `vega` first-time bootstrap (get_vvm.sh) before this; see
# docs/development/getting-started.md.
#
# Usage: scripts/install-vega-sdk.sh [sdk-version]     (default: 0.24.12112)
set -u

VERSION="${1:-0.24.12112}"
MAX_ATTEMPTS=8
STALL_SECONDS=120

# shellcheck disable=SC1091
source "$HOME/vega/env" || { echo "Vega CLI not found; run the bootstrap installer first." >&2; exit 1; }

STATE_DIR="$(mktemp -d "${TMPDIR:-$HOME}/studiox-sdk-install.XXXXXX")"
export TMPDIR="$STATE_DIR"   # keep the download on disk, not in a RAM-backed /tmp
trap 'rm -rf "$STATE_DIR"' EXIT
PROGRESS="$STATE_DIR/progress.jsonl"

field() { grep -o "\"$1\":\"[^\"]*\"" <<<"$2" | cut -d'"' -f4; }

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "=== attempt ${attempt}/${MAX_ATTEMPTS}  $(date '+%H:%M:%S') ==="
  : >"$PROGRESS"
  nice -n 10 vega sdk install "$VERSION" --non-interactive --status-fd 3 \
    3>"$PROGRESS" >"$STATE_DIR/out.log" 2>&1 &
  pid=$!
  last_size=0
  idle=0

  while kill -0 "$pid" 2>/dev/null; do
    sleep 10
    line="$(tail -n 1 "$PROGRESS" 2>/dev/null)"
    echo "$(date '+%H:%M:%S')  $(field message "$line")  $(field speed "$line")  eta $(field eta "$line")"
    size="$(stat -c %s "$PROGRESS")"
    if [ "$size" = "$last_size" ]; then idle=$((idle + 10)); else idle=0; last_size="$size"; fi
    if [ "$idle" -ge "$STALL_SECONDS" ]; then
      echo "STALLED for ${idle}s; restarting"
      kill "$pid"
      break
    fi
  done
  wait "$pid" 2>/dev/null

  if vega sdk list-installed 2>/dev/null | grep -q "$VERSION"; then
    vega sdk use "$VERSION" >/dev/null 2>&1
    echo "SUCCESS: Vega SDK ${VERSION} installed"
    if ls "$HOME/vega/sdk/vega-sdk/main/$VERSION/vvd/images/tv" >/dev/null 2>&1; then
      echo "Virtual device image present."
    else
      echo "WARNING: virtual device image missing; re-run this script." >&2
    fi
    exit 0
  fi
  echo "attempt ${attempt} ended:"; grep -E 'Error|failed' "$STATE_DIR/out.log" | head -2
  rm -rf "$STATE_DIR"/kepler-install-*
  sleep 10
done

echo "FAILED after ${MAX_ATTEMPTS} attempts" >&2
exit 1
