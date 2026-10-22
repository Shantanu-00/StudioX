#!/usr/bin/env bash
# Fetch a static linux x86_64 ffmpeg+ffprobe (johnvansickle.com) into layers/ffmpeg/bin (Lambda layer: /opt/bin/ffmpeg).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/layers/ffmpeg/bin"
BASE="https://johnvansickle.com/ffmpeg/releases"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [ -x "$DEST/ffmpeg" ] && [ -x "$DEST/ffprobe" ]; then echo "already present: $DEST"; exit 0; fi
cd "$TMP"
curl -fL --retry 3 -o ffmpeg.tar.xz "$BASE/ffmpeg-release-amd64-static.tar.xz"
curl -fL --retry 3 -o ffmpeg.tar.xz.md5 "$BASE/ffmpeg-release-amd64-static.tar.xz.md5"
EXPECTED="$(awk '{print $1}' ffmpeg.tar.xz.md5)"
ACTUAL="$(md5sum ffmpeg.tar.xz | awk '{print $1}')"
[ "$EXPECTED" = "$ACTUAL" ] || { echo "md5 mismatch: $EXPECTED vs $ACTUAL" >&2; exit 1; }
mkdir x
tar -xJf ffmpeg.tar.xz -C x --wildcards '*/ffmpeg' '*/ffprobe' --strip-components=1
mkdir -p "$DEST"
install -m 0755 x/ffmpeg x/ffprobe "$DEST/"
"$DEST/ffmpeg" -version | head -1
"$DEST/ffprobe" -version | head -1
du -sh "$DEST"
