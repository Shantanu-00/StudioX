#!/usr/bin/env bash
# Turn the live backend off again after recording (uploads and live AI answer 503 LIVE_OFF).
#   AWS_PROFILE=default scripts/go-offline.sh            # live off
#   AWS_PROFILE=default scripts/go-offline.sh --silent   # also put the silent episodes back on the CDN
#   then remove src/config.local.ts and rebuild for a demo (offline) TV build.
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_PROFILE="${AWS_PROFILE:-studiox}" AWS_REGION=us-east-1
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
P=(--profile "$AWS_PROFILE" --region us-east-1)
aws ssm put-parameter "${P[@]}" --overwrite --type String --name /studiox/live --value off >/dev/null
echo "/studiox/live = off"
if [ "${1:-}" = --silent ]; then
  BUCKET=$(aws cloudformation describe-stacks "${P[@]}" --stack-name StudioXCore \
    --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)
  for id in crime-case104 science-ep42; do for ext in frag.mp4 mp4; do
    aws s3 cp "${P[@]}" "s3://$BUCKET/media/$id.silent.$ext" "s3://$BUCKET/media/$id.$ext" >/dev/null && echo "restored $id.$ext"
  done; done
  echo "clear CloudFront /media/* if you restored files"
fi
