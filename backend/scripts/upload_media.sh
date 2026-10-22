#!/usr/bin/env bash
# OWNER-RUN (needs S3 + CloudFront rights; the restricted claude-code profile cannot).
# Uploads media/tv/*.mp4 (and *.frag.mp4) to s3://<bucket>/media/ and invalidates /media/*.
# Usage: AWS_PROFILE=studiox backend/scripts/upload_media.sh   [STACK=StudioXCore]
#
# Licence note: the clips are built from Pexels footage. Pexels licence allows free use but not
# redistribution of the footage as stock. Here it is served for in-app playback only: do not offer
# it as a download or list it anywhere as a file collection.
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.local/aws-cli/v2/current/bin:$PATH"
cd "$(dirname "$0")/../.."
STACK="${STACK:-StudioXCore}"; REGION="${AWS_REGION:-us-east-1}"
out() { aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET="$(out BucketName)"; CFDOMAIN="$(out CloudFrontDomain)"
DIST="$(aws cloudfront list-distributions --query "DistributionList.Items[?DomainName=='$CFDOMAIN'].Id | [0]" --output text)"
[ -n "$BUCKET" ] && [ "$DIST" != None ] || { echo "could not resolve bucket/distribution" >&2; exit 1; }
shopt -s nullglob
files=(media/tv/*.mp4)
[ ${#files[@]} -gt 0 ] || { echo "no media/tv/*.mp4" >&2; exit 1; }
for f in "${files[@]}"; do
  aws s3 cp "$f" "s3://$BUCKET/media/$(basename "$f")" --content-type video/mp4 \
    --cache-control "public, max-age=86400"
done
INV="$(aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/media/*' --query Invalidation.Id --output text)"
echo "uploaded ${#files[@]} files to s3://$BUCKET/media/; invalidation $INV"
echo "check: curl -sI https://$CFDOMAIN/media/science-ep42.mp4 | head -5"
