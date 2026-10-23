#!/usr/bin/env bash
# Upload the voiced demo episodes to the CDN (retries for a flaky network), then clear CloudFront.
#   AWS_PROFILE=default scripts/upload-voiced.sh
set -uo pipefail
cd "$(dirname "$0")/.."
export AWS_PROFILE="${AWS_PROFILE:-studiox}" AWS_REGION=us-east-1 AWS_RETRY_MODE=adaptive AWS_MAX_ATTEMPTS=10
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
P=(--profile "$AWS_PROFILE" --region us-east-1)
out() { aws cloudformation describe-stacks "${P[@]}" --stack-name StudioXCore \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET=$(out BucketName); CFDOMAIN=$(out CloudFrontDomain)
DIST=$(aws cloudfront list-distributions --profile "$AWS_PROFILE" \
  --query "DistributionList.Items[?DomainName=='$CFDOMAIN'].Id | [0]" --output text)
ok=1
for id in crime-case104 science-ep42; do
  for ext in frag.mp4 mp4; do
    aws s3 ls "${P[@]}" "s3://$BUCKET/media/$id.silent.$ext" >/dev/null 2>&1 \
      || aws s3 cp "${P[@]}" "s3://$BUCKET/media/$id.$ext" "s3://$BUCKET/media/$id.silent.$ext" >/dev/null
    for try in 1 2 3 4 5; do
      aws s3 cp "${P[@]}" "media/tv/$id.voiced.$ext" "s3://$BUCKET/media/$id.$ext" \
        --content-type video/mp4 --cache-control "public, max-age=86400" --only-show-errors \
        && { echo "uploaded $id.$ext"; break; }
      echo "retry $try for $id.$ext"; sleep $((try * 5))
      [ $try = 5 ] && ok=0
    done
  done
done
aws cloudfront create-invalidation --profile "$AWS_PROFILE" --distribution-id "$DIST" \
  --paths "/media/*" >/dev/null && echo "CloudFront cleared"
for id in crime-case104 science-ep42; do
  cdn=$(curl -sI "https://$CFDOMAIN/media/$id.frag.mp4" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}')
  echo "$id: CDN $cdn bytes, voiced $(stat -c %s media/tv/$id.voiced.frag.mp4) bytes"
done
[ $ok = 1 ] && echo RESULT: PASS || echo RESULT: FAIL
