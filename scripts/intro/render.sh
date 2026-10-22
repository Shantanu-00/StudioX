#!/usr/bin/env bash
# Rebuild the 10-second StudioX intro from its editable Blender scene.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
OUTPUT="${STUDIOX_INTRO_OUTPUT:-$ROOT/docs/local/intro/render}"
REFERENCE="${1:-$ROOT/docs/local/intro/reference/reference.mp4}"
mkdir -p "$OUTPUT/frames"

for program in blender ffmpeg ffprobe python3; do
  command -v "$program" >/dev/null || {
    printf 'Missing required program: %s\n' "$program" >&2
    exit 1
  }
done
if [[ ! -f "$REFERENCE" ]]; then
  printf 'Reference video not found: %s\nPass its path as the first argument.\n' "$REFERENCE" >&2
  exit 1
fi

# Preserve the source pitch while shortening its reveal, impact, and decay.
# Original impact ~10.8s maps to 5.43s, matching build_scene.py.
ffmpeg -hide_banner -loglevel warning -y -i "$REFERENCE" -vn \
  -af 'atrim=start=3.4:end=17.461,asetpts=N/SR/TB,atempo=1.4570984456,asetpts=N/SR/TB,afade=t=in:st=0:d=0.015,adelay=350:all=1,asetpts=N/SR/TB,apad,atrim=duration=10,afade=t=out:st=9.85:d=0.15' \
  -ar 48000 -ac 2 -c:a pcm_s24le "$OUTPUT/studiox-reference-soundtrack.wav"

blender -b -t 4 --factory-startup --python scripts/intro/build_scene.py -- \
  --output "$OUTPUT" --width 1920 --height 1080 --samples 24 --render \
  > "$OUTPUT/blender-render.log" 2>&1

ffmpeg -hide_banner -loglevel warning -y \
  -framerate 30 -start_number 1 -i "$OUTPUT/frames/%04d.png" \
  -i "$OUTPUT/studiox-reference-soundtrack.wav" \
  -vf "lutrgb=r='if(lte(val,1),0,val)':g='if(lte(val,1),0,val)':b='if(lte(val,1),0,val)'" \
  -map 0:v:0 -map 1:a:0 -c:v libx264 -preset slow -crf 16 -threads 2 \
  -force_key_frames 0,9.7 \
  -pix_fmt yuv420p -c:a aac -b:a 256k -ar 48000 -t 10 \
  -movflags +faststart "$OUTPUT/studiox-intro-10s.mp4"

ffmpeg -hide_banner -loglevel warning -y -i "$OUTPUT/studiox-intro-10s.mp4" \
  -map 0:v:0 -c:v copy -an "$OUTPUT/studiox-intro-10s-silent.mp4"
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate,sample_rate,channels \
  -of json "$OUTPUT/studiox-intro-10s.mp4" > "$OUTPUT/media-info.json"
python3 scripts/intro/verify.py "$OUTPUT/studiox-intro-10s.mp4" > "$OUTPUT/verification.json"
printf 'Rendered: %s\nEditable scene: %s\n' \
  "$OUTPUT/studiox-intro-10s.mp4" "$OUTPUT/studiox-intro.blend"
