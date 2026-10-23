#!/usr/bin/env bash
# OWNER-RUN (needs polly:SynthesizeSpeech; the restricted claude-code IAM user cannot call Polly).
# Synthesise every line of media/audio/<id>/lines.json with Amazon Polly to media/audio/<id>/lines/NN.mp3.
#
# Usage:
#   AWS_PROFILE=studiox scripts/podcast-audio/polly.sh                 # both demo episodes
#   AWS_PROFILE=studiox scripts/podcast-audio/polly.sh science-ep42
#   AWS_PROFILE=studiox FORCE=1 ENGINE=neural scripts/podcast-audio/polly.sh crime-case104
#
# Env:
#   AWS_PROFILE  required. Passed as --profile so it wins over any AWS_ACCESS_KEY_ID in the shell
#                (the CLI prefers environment keys over AWS_PROFILE, but never over --profile).
#   AWS_REGION   default us-east-1 (generative voices: us-east-1, us-west-2, eu-central-1, ...).
#   ENGINE       override the manifest engine (generative | neural). If generative fails for a line,
#                the line is retried once with neural.
#   FORCE=1      re-synthesise lines that already have a file.
#   AWS_CLI      path of the aws binary (default: aws on PATH; used to dry-run with a stub).
# Output is MP3 at 24 kHz (Polly's generative/neural maximum); assemble.py resamples to 48 kHz.
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.local/aws-cli/v2/current/bin:$PATH"
cd "$(dirname "$0")/../.."
: "${AWS_PROFILE:?set AWS_PROFILE to a profile allowed to call polly:SynthesizeSpeech}"
REGION="${AWS_REGION:-us-east-1}"
ids=("$@"); [ ${#ids[@]} -gt 0 ] || ids=(crime-case104 science-ep42)

synth() { # engine voice ssml out
  "${AWS_CLI:-aws}" polly synthesize-speech --profile "$AWS_PROFILE" --region "$REGION" \
    --engine "$1" --voice-id "$2" --text-type ssml --text "$3" \
    --output-format mp3 --sample-rate 24000 "$4" >/dev/null </dev/null
}

for id in "${ids[@]}"; do
  manifest="media/audio/$id/lines.json"
  [ -f "$manifest" ] || { echo "missing $manifest: run scripts/podcast-audio/lines.py $id" >&2; exit 1; }
  mkdir -p "media/audio/$id/lines"
  # n <TAB> voice <TAB> engine <TAB> ssml   (one line per manifest entry)
  while IFS=$'\t' read -r n voice engine ssml; do
    out="media/audio/$id/lines/$n.mp3"
    if [ -s "$out" ] && [ "${FORCE:-0}" != 1 ]; then echo "$id #$n exists, skipping ($out)"; continue; fi
    engine="${ENGINE:-$engine}"
    if ! synth "$engine" "$voice" "$ssml" "$out"; then
      [ "$engine" = neural ] && { echo "$id #$n failed with neural" >&2; exit 1; }
      echo "$id #$n: $engine failed, retrying with neural" >&2
      synth neural "$voice" "$ssml" "$out"
    fi
    echo "$id #$n $voice ($engine) -> $out"
  done < <(python3 - "$manifest" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
for ln in m["lines"]:
    v = m["voices"][ln["speaker"]]["polly"]
    print(f"{ln['n']:02d}\t{ln['voice']}\t{v['engine']}\t{ln['ssml']}")
PY
  )
  echo "$id: done"
done
echo "next: python3 scripts/podcast-audio/assemble.py ${ids[*]}"
