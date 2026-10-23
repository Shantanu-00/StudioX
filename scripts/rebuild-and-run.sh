#!/usr/bin/env bash
# Memory-safe rebuild: stop the emulator, build, restart the emulator, relaunch the app.
# The build needs a lot of RAM, so on an 8 GB machine the emulator must not be running.
#
# Usage: scripts/rebuild-and-run.sh [--keep-emulator]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VPKG="build/x86_64-debug/studiox_x86_64.vpkg"
APP_ID="com.studiox.app.main"

# shellcheck disable=SC1091
source "$HOME/vega/env"
cd "$REPO_ROOT"

if [ "${1:-}" != "--keep-emulator" ]; then
  echo "[1/4] stopping emulator"
  vega virtual-device stop || true
  sleep 5
fi

echo "[2/4] building (debug)"
nice -n 10 npm run build:debug
test -f "$VPKG" || { echo "Build did not produce $VPKG" >&2; exit 2; }

echo "[3/4] starting emulator"
vega virtual-device start --timeout 300

echo "[4/4] installing and launching"
# "Virtual device ready" can come before run-app can see the device: retry once.
vega run-app "$VPKG" "$APP_ID" -d VirtualDevice || { sleep 20; vega run-app "$VPKG" "$APP_ID" -d VirtualDevice; }
free -h | sed -n 2p
echo "Done."
