#!/usr/bin/env bash
# One command for the recording: everything live, voiced episodes, live TV build.
#
#   scripts/go-live.sh            (uses AWS profile "studiox"; override with AWS_PROFILE=...)
#
# 1. Turns the backend on: /studiox/live = on, and an access code (kept if already set).
# 2. Deploys StudioXCore (API + phone app with voice ask) and StudioXPipeline (Transcribe uploads),
#    runs the upload smoke test, and updates the docs only if it passes.
# 3. Generates the podcast voices with Amazon Polly, fits them to the captions, uploads the voiced
#    episodes to the CDN (silent originals kept as .silent.*), invalidates CloudFront.
# 4. Writes src/config.local.ts (APP_MODE live + the access code) and rebuilds and launches the TV app
#    on the Virtual Device.
# A failed step is reported and the script carries on with the next one; the summary is at the end.
set -uo pipefail
cd "$(dirname "$0")/.."
export AWS_PROFILE="${AWS_PROFILE:-studiox}" AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
# Environment keys (the restricted claude-code user) would win over AWS_PROFILE.
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
P=(--profile "$AWS_PROFILE" --region us-east-1)
declare -A RESULT
step() { echo; echo "==== $1"; }

aws sts get-caller-identity "${P[@]}" --query Arn --output text \
  || { echo "AWS profile '$AWS_PROFILE' does not work. Run: aws configure --profile $AWS_PROFILE"; exit 1; }

step "1/4 Backend switches"
aws ssm put-parameter "${P[@]}" --overwrite --type String --name /studiox/live --value on >/dev/null \
  && echo "/studiox/live = on"
CODE=$(aws ssm get-parameter "${P[@]}" --name /studiox/access-code --query Parameter.Value --output text 2>/dev/null || echo unset)
if [ -z "$CODE" ] || [ "$CODE" = unset ] || [ "$CODE" = None ]; then
  CODE=$(python3 -c "import secrets; print(secrets.token_hex(8))")
  aws ssm put-parameter "${P[@]}" --overwrite --type String --name /studiox/access-code --value "$CODE" >/dev/null
  echo "new access code set in /studiox/access-code"
else
  echo "access code already set (kept)"
fi
RESULT[switches]=ok

step "2/4 Deploy Core + Pipeline, smoke test, docs"
if scripts/deploy-pipeline.sh --yes --enable-live --apply-docs; then RESULT[deploy]=PASS; else RESULT[deploy]="FAIL (see output above)"; fi

step "3/4 Podcast voices (Polly) and CDN upload"
VOICE_OK=1
python3 scripts/podcast-audio/lines.py || VOICE_OK=0
[ $VOICE_OK = 1 ] && { scripts/podcast-audio/polly.sh || VOICE_OK=0; }
if [ $VOICE_OK = 1 ]; then
  python3 scripts/podcast-audio/assemble.py; rc=$?
  # 2 = some line needed more than 1.25x; the files are still written, so carry on.
  [ $rc -ne 0 ] && [ $rc -ne 2 ] && VOICE_OK=0
  [ $rc -eq 2 ] && echo "note: some lines run past their caption window (report above)"
fi
for id in crime-case104 science-ep42; do
  [ -f "media/tv/$id.voiced.frag.mp4" ] && [ -f "media/tv/$id.voiced.mp4" ] || VOICE_OK=0
done
if [ $VOICE_OK = 1 ]; then
  out() { aws cloudformation describe-stacks "${P[@]}" --stack-name StudioXCore \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
  BUCKET=$(out BucketName); CFDOMAIN=$(out CloudFrontDomain)
  DIST=$(aws cloudfront list-distributions --profile "$AWS_PROFILE" \
    --query "DistributionList.Items[?DomainName=='$CFDOMAIN'].Id | [0]" --output text)
  for id in crime-case104 science-ep42; do
    for ext in frag.mp4 mp4; do
      aws s3 ls "${P[@]}" "s3://$BUCKET/media/$id.silent.$ext" >/dev/null 2>&1 \
        || aws s3 cp "${P[@]}" "s3://$BUCKET/media/$id.$ext" "s3://$BUCKET/media/$id.silent.$ext" >/dev/null
      aws s3 cp "${P[@]}" "media/tv/$id.voiced.$ext" "s3://$BUCKET/media/$id.$ext" \
        --content-type video/mp4 --cache-control "public, max-age=86400" >/dev/null || VOICE_OK=0
    done
  done
  aws cloudfront create-invalidation --profile "$AWS_PROFILE" --distribution-id "$DIST" \
    --paths /media/crime-case104.frag.mp4 /media/crime-case104.mp4 /media/science-ep42.frag.mp4 /media/science-ep42.mp4 >/dev/null \
    && echo "uploaded voiced episodes; CloudFront invalidated"
fi
RESULT[voices]=$([ $VOICE_OK = 1 ] && echo ok || echo "FAIL (see output above)")

step "4/4 Live TV build on the Virtual Device"
cat > src/config.local.ts <<EOF
// Written by scripts/go-live.sh. Git-ignored: never commit.
export const APP_MODE = 'live';
export const ACCESS_CODE = '$CODE';
EOF
if bash scripts/rebuild-and-run.sh; then RESULT[tv]=ok; else RESULT[tv]="FAIL (see output above)"; fi

echo; echo "==== Summary"
for k in switches deploy voices tv; do printf '  %-9s %s\n' "$k" "${RESULT[$k]}"; done
echo "  Phone: open the Link tab on the TV, scan the QR, then use the mic button (Chrome or Safari)."
