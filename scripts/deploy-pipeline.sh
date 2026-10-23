#!/usr/bin/env bash
# OWNER-RUN. Deploys the upload path of StudioX-EpisodeAnalysis (Amazon Transcribe -> Normalise, beside
# Prepare playback) and proves it with a real phone-style upload. Prints PASS or FAIL.
#
#   AWS_PROFILE=studiox scripts/deploy-pipeline.sh [options]
#
# Options:
#   --skip-core     deploy StudioXPipeline only. The Transcribe path needs no Core change (the bucket's
#                   EventBridge notifications and the upload API are already in StudioXCore); Core is deployed
#                   by default because it also republishes the phone web app (webapp/link, incl. voice) and the
#                   API Lambda (GET /v1/links/{id}/media for the TV inbox).
#   --skip-deploy   run the smoke test only, against what is deployed now
#   --yes           pass --require-approval never to cdk deploy (otherwise CDK asks before IAM changes)
#   --enable-live   set /studiox/live to "on" if it is off (uploads answer 503 LIVE_OFF while it is off)
#   --apply-docs    after a PASS, git apply docs/local/deploy-transcribe-docs.patch (README and docs move
#                   Amazon Transcribe and playable uploads from BUILT to LIVE)
# Environment: CLIP_SECONDS (default 10), CLIP_SOURCE (default media/tv/science-ep42.mp4),
#              SMOKE_TIMEOUT seconds (default 1500). Region is always us-east-1, like the stacks.
#
# The smoke test uses the same path as a phone: register a TV, pair, redeem (cookie), POST /v1/uploads,
# PUT the part to the presigned URL, POST .../complete. S3 Object Created -> EventBridge -> StartPipelineFn
# -> StudioX-EpisodeAnalysis. It uses 1 of the 10 daily uploads and a few Bedrock calls, and leaves the
# smoke media, link and package in the account.
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.local/aws-cli/v2/current/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DO_CORE=1 DO_DEPLOY=1 YES=0 ENABLE_LIVE=0 APPLY_DOCS=0
for arg in "$@"; do
  case "$arg" in
    --skip-core) DO_CORE=0 ;;
    --skip-deploy) DO_DEPLOY=0 ;;
    --yes) YES=1 ;;
    --enable-live) ENABLE_LIVE=1 ;;
    --apply-docs) APPLY_DOCS=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

export AWS_PROFILE="${AWS_PROFILE:-studiox}"
# The stacks are pinned to us-east-1 (backend/infra/bin/studiox.ts); an inherited AWS_REGION must not win.
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
CLIP_SECONDS="${CLIP_SECONDS:-10}"
CLIP_SOURCE="${CLIP_SOURCE:-media/tv/science-ep42.mp4}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-1500}"
PATCH="docs/local/deploy-transcribe-docs.patch"
LOCK="$HOME/.cache/studiox-heavy.lock"

step() { printf '\n== %s\n' "$*"; }
die() { echo "FAIL: $*" >&2; echo; echo "RESULT: FAIL"; exit 1; }

# ---- Preflight ----------------------------------------------------------------------------------------
step "preflight (profile $AWS_PROFILE, region $AWS_REGION)"
for tool in aws jq curl ffmpeg npx git; do command -v "$tool" >/dev/null || die "missing tool: $tool"; done
aws configure list-profiles 2>/dev/null | grep -qx "$AWS_PROFILE" \
  || die "AWS profile '$AWS_PROFILE' not found in ~/.aws (set AWS_PROFILE to a profile that can deploy)"
CALLER="$(aws sts get-caller-identity --query Arn --output text)" || die "cannot call sts:GetCallerIdentity with $AWS_PROFILE"
case "$CALLER" in
  */claude-code) die "$AWS_PROFILE resolves to the restricted claude-code user (Bedrock only); use the deploy profile" ;;
esac
echo "caller: ${CALLER##*/}"
[ -f "$CLIP_SOURCE" ] || die "clip source not found: $CLIP_SOURCE"
if [ "$APPLY_DOCS" = 1 ]; then
  [ -f "$PATCH" ] || die "$PATCH not found"
  git apply --check "$PATCH" || die "$PATCH no longer applies to the current docs; regenerate it before --apply-docs"
fi

with_lock() {  # the TV build shares this machine (7 GB); never run cdk beside it
  mkdir -p "$(dirname "$LOCK")"
  if command -v flock >/dev/null; then flock "$LOCK" "$@"; else "$@"; fi
}

# ---- Deploy -------------------------------------------------------------------------------------------
if [ "$DO_DEPLOY" = 1 ]; then
  step "ffmpeg layer (Prepare playback)"
  backend/scripts/fetch_ffmpeg.sh
  step "cdk deploy"
  ( cd backend/infra
    [ -d node_modules ] || npm ci
    STACKS=(StudioXPipeline); [ "$DO_CORE" = 1 ] && STACKS=(StudioXCore StudioXPipeline)
    APPROVAL=(); [ "$YES" = 1 ] && APPROVAL=(--require-approval never)
    # Core first: the pipeline reads /studiox/bucket and /studiox/table at deploy time.
    for s in "${STACKS[@]}"; do
      echo "-- $s"
      with_lock npx cdk deploy "$s" "${APPROVAL[@]}"
    done )
fi

# ---- Resolve the deployed names -----------------------------------------------------------------------
out() { aws cloudformation describe-stacks --stack-name "$1" \
  --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text; }
DOMAIN="$(out StudioXCore CloudFrontDomain)"; BUCKET="$(out StudioXCore BucketName)"
SM="$(out StudioXPipeline StateMachineArn)"
[ -n "$DOMAIN" ] && [ -n "$BUCKET" ] && [ -n "$SM" ] && [ "$SM" != None ] || die "could not read the stack outputs"
BASE="https://$DOMAIN/v1"
echo "domain $DOMAIN · state machine ${SM##*:}"

param() { aws ssm get-parameter --name "$1" --query Parameter.Value --output text 2>/dev/null || echo "?"; }
step "switches"
LIVE="$(param /studiox/live)"
if [ "$LIVE" != on ]; then
  if [ "$ENABLE_LIVE" = 1 ]; then
    aws ssm put-parameter --overwrite --type String --name /studiox/live --value on >/dev/null
    echo "/studiox/live: $LIVE -> on (the API caches SSM values for 30 s; waiting 35 s)"; sleep 35
  else
    die "/studiox/live is '$LIVE'; uploads answer 503 LIVE_OFF. Re-run with --enable-live, or: aws ssm put-parameter --overwrite --type String --name /studiox/live --value on"
  fi
fi
for a in analyst coviewer; do
  v="$(param "/studiox/agents/$a/arn")"
  [ "$v" != unset ] && [ "$v" != "?" ] || die "/studiox/agents/$a/arn is '$v': the analysis after Transcribe needs the AgentCore runtime ARN"
done
echo "live on; agent ARNs set"

# ---- Smoke test: a phone upload of a short clip -------------------------------------------------------
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
JAR="$TMP/jar"; NAME="studiox-smoke-$(date -u +%Y%m%dT%H%M%S).mp4"; CLIP="$TMP/$NAME"
api() { curl -fsS --retry 3 --retry-all-errors --retry-delay 2 -H 'content-type: application/json' "$@"; }

step "cut ${CLIP_SECONDS}s of $CLIP_SOURCE"
ffmpeg -hide_banner -loglevel error -nostdin -y -i "$CLIP_SOURCE" -t "$CLIP_SECONDS" -c copy -movflags +faststart "$CLIP"
SIZE="$(stat -c %s "$CLIP")"; echo "$NAME: $SIZE bytes"

step "pair a smoke TV and phone"
DEV="$(api -X POST "$BASE/devices" -d '{"name":"Smoke TV (Transcribe)"}')"
AUTH="Authorization: Device $(jq -r .deviceId <<<"$DEV"):$(jq -r .deviceSecret <<<"$DEV")"
CODE="$(api -X POST -H "$AUTH" "$BASE/pairings" | jq -r .code)"
LINK="$(api -c "$JAR" -X POST "$BASE/pairings/$CODE/redeem" -d '{"phoneName":"Smoke phone"}' | jq -r .linkId)"
[ -n "$LINK" ] && [ "$LINK" != null ] || die "pairing failed"
echo "link $LINK"

step "upload through the phone API"
UP="$(api -b "$JAR" -X POST "$BASE/uploads" -d "$(jq -nc --arg n "$NAME" --argjson s "$SIZE" '{name:$n,size:$s,type:"video/mp4"}')")" \
  || die "POST /v1/uploads failed (503 LIVE_OFF, 429 QUOTA_EXCEEDED: 10 uploads per UTC day)"
MEDIA="$(jq -r .mediaId <<<"$UP")"; PSIZE="$(jq -r .partSize <<<"$UP")"
NPARTS=$(( (SIZE + PSIZE - 1) / PSIZE ))
[ "$(jq '.parts | length' <<<"$UP")" -ge "$NPARTS" ] || die "clip needs $NPARTS parts; keep CLIP_SECONDS short"
PARTS='[]'
for N in $(seq 1 "$NPARTS"); do
  URL="$(jq -r ".parts[] | select(.n==$N) | .url" <<<"$UP")"
  dd if="$CLIP" bs="$PSIZE" skip=$((N - 1)) count=1 of="$TMP/part" 2>/dev/null
  HTTP="$(curl -sS --retry 3 --retry-all-errors -D "$TMP/hdr" -o "$TMP/body" -w '%{http_code}' -X PUT -T "$TMP/part" "$URL")" || true
  ETAG="$(tr -d '\r' < "$TMP/hdr" | awk 'tolower($1)=="etag:" {print $2}' | tail -1)"
  [ "$HTTP" = 200 ] && [ -n "$ETAG" ] || die "part $N: HTTP $HTTP $(head -c 300 "$TMP/body")"
  PARTS="$(jq -c ". + [{\"n\":$N,\"etag\":$ETAG}]" <<<"$PARTS")"
done
api -b "$JAR" -X POST "$BASE/uploads/$MEDIA/complete" -d "{\"parts\":$PARTS}" >/dev/null
echo "mediaId $MEDIA uploaded as uploads/$MEDIA/$NAME"

step "wait for EventBridge to start the execution"
EXEC=""
for _ in $(seq 1 24); do
  for arn in $(aws stepfunctions list-executions --state-machine-arn "$SM" --max-results 20 \
      --query 'executions[].executionArn' --output text); do
    mid="$(aws stepfunctions describe-execution --execution-arn "$arn" --query input --output text | jq -r '.mediaId // empty')"
    if [ "$mid" = "$MEDIA" ]; then EXEC="$arn"; break; fi
  done
  [ -n "$EXEC" ] && break
  sleep 5
done
[ -n "$EXEC" ] || die "no execution for $MEDIA after 2 min (EventBridge rule OnUpload / StartPipelineFn logs)"
EXEC_NAME="${EXEC##*:}"; echo "execution $EXEC_NAME"

step "poll the execution (timeout ${SMOKE_TIMEOUT}s)"
START=$(date +%s); LAST=""
while :; do
  ST="$(aws stepfunctions describe-execution --execution-arn "$EXEC" --query status --output text)"
  M="$(api -b "$JAR" "$BASE/media/$MEDIA" 2>/dev/null | jq -r '"\(.status) \(.progress // "")"' || echo "?")"
  [ "$ST $M" != "$LAST" ] && { echo "$(( $(date +%s) - START ))s  execution $ST · media $M"; LAST="$ST $M"; }
  [ "$ST" != RUNNING ] && break
  [ $(( $(date +%s) - START )) -lt "$SMOKE_TIMEOUT" ] || die "execution still RUNNING after ${SMOKE_TIMEOUT}s"
  sleep 15
done

# ---- Checks -------------------------------------------------------------------------------------------
step "checks"
OK=1
check() { if [ "$2" = 1 ]; then echo "PASS  $1"; else echo "FAIL  $1"; OK=0; fi; }
s3json() { local v; v="$(aws s3 cp "s3://$BUCKET/$1" - 2>/dev/null)" || v=""; jq -e . >/dev/null 2>&1 <<<"$v" || v="{}"; printf '%s' "$v"; }

TR="$(s3json "runs/$MEDIA/$EXEC_NAME/transcribe.json")"
N_ITEMS="$(jq -r '[.results.items[]? | select(.type=="pronunciation")] | length' <<<"$TR" 2>/dev/null || echo 0)"
check "Amazon Transcribe wrote runs/$MEDIA/$EXEC_NAME/transcribe.json ($N_ITEMS words, status $(jq -r '.status // "?"' <<<"$TR" 2>/dev/null))" \
  "$([ "${N_ITEMS:-0}" -gt 0 ] && echo 1 || echo 0)"

NT="$(s3json "transcripts/$MEDIA.json")"
N_SENT="$(jq -r 'if .source=="transcribe" then (.sentences|length) else 0 end' <<<"$NT" 2>/dev/null || echo 0)"
check "Normalise wrote transcripts/$MEDIA.json (source transcribe, $N_SENT sentences)" \
  "$([ "${N_SENT:-0}" -gt 0 ] && echo 1 || echo 0)"
jq -r '.sentences[:2][]? | "      \(.t0)-\(.t1) \(.speaker): \(.text)"' <<<"$NT" 2>/dev/null || true

check "execution $EXEC_NAME ended SUCCEEDED (was $ST)" "$([ "$ST" = SUCCEEDED ] && echo 1 || echo 0)"
if [ "$ST" != SUCCEEDED ]; then
  aws stepfunctions get-execution-history --execution-arn "$EXEC" --reverse-order --max-results 25 \
    --query 'events[?contains(type, `Failed`) || contains(type, `Aborted`) || contains(type, `TimedOut`)].[type, executionFailedEventDetails.cause || taskFailedEventDetails.cause || lambdaFunctionFailedEventDetails.cause]' \
    --output text | head -5 | cut -c1-400 || true
fi

PKG="$(s3json "packages/$MEDIA/latest.json")"
PKG_OK="$(jq -r --arg m "$MEDIA" 'if .mediaId==$m and .provenance=="pipeline" then 1 else 0 end' <<<"$PKG" 2>/dev/null || echo 0)"
check "Publish wrote packages/$MEDIA/latest.json ($(jq -r '"\(.segments|length) segments, \(.widgets|length) cards"' <<<"$PKG" 2>/dev/null || echo none))" "$PKG_OK"

ROW="$(api -H "$AUTH" "$BASE/links/$LINK/media" 2>/dev/null | jq -c --arg m "$MEDIA" '.media[]? | select(.mediaId==$m)' || true)"
[ -n "$ROW" ] || ROW='{}'
MURL="$(jq -r '.mediaUrl // empty' <<<"$ROW")"
HEAD_CODE="$( [ -n "$MURL" ] && curl -s -o /dev/null -w '%{http_code}' -r 0-1023 "$MURL" || echo none)"
check "Prepare playback: playable=$(jq -r '.playable' <<<"$ROW"), $MURL answers $HEAD_CODE" \
  "$([ "$(jq -r '.playable' <<<"$ROW")" = true ] && { [ "$HEAD_CODE" = 200 ] || [ "$HEAD_CODE" = 206 ]; } && echo 1 || echo 0)"

DUR="$(aws stepfunctions describe-execution --execution-arn "$EXEC" --query '[startDate, stopDate]' --output text)"
echo
echo "evidence: execution $EXEC_NAME, mediaId $MEDIA, ${CLIP_SECONDS}s clip, start/stop $DUR"
echo "          https://$AWS_REGION.console.aws.amazon.com/states/home?region=$AWS_REGION#/v2/executions/details/$EXEC"

if [ "$OK" != 1 ]; then echo; echo "RESULT: FAIL"; exit 1; fi
echo; echo "RESULT: PASS"

if [ "$APPLY_DOCS" = 1 ]; then
  step "apply the docs patch"
  git apply "$PATCH"
  git diff --stat
  echo "Docs now say LIVE. Record the evidence line above in submission/aws-builder-log.md (Transcribe -> LIVE)."
fi
