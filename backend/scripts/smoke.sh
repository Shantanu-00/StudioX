#!/usr/bin/env bash
# End-to-end smoke test of API contract v1. Usage: DOMAIN=dxxxx.cloudfront.net ./smoke.sh
set -euo pipefail
: "${DOMAIN:?set DOMAIN to the CloudFront domain}"
BASE="https://$DOMAIN/v1"
JAR="$(mktemp)"; FILE="$(mktemp)"; trap 'rm -f "$JAR" "$FILE" "$FILE.part" "$FILE.hdr" "$FILE.body"' EXIT
step() { printf '\n== %s\n' "$*"; }
api() { curl -fsS --retry 3 --retry-all-errors --retry-delay 2 -H 'content-type: application/json' "$@"; }

step "register device"
DEV=$(api -X POST "$BASE/devices" -d '{"name":"Smoke TV"}')
AUTH="Authorization: Device $(jq -r .deviceId <<<"$DEV"):$(jq -r .deviceSecret <<<"$DEV")"

step "create pairing"
PAIR=$(api -X POST -H "$AUTH" "$BASE/pairings"); echo "$PAIR"
CODE=$(jq -r .code <<<"$PAIR")
[ "$(api -H "$AUTH" "$BASE/pairings/$CODE" | jq -r .status)" = waiting ]

step "redeem with cookie jar"
REDEEM=$(api -c "$JAR" -X POST "$BASE/pairings/$CODE/redeem" -d '{"phoneName":"Smoke phone"}'); echo "$REDEEM"
LINK=$(jq -r .linkId <<<"$REDEEM")
[ "$(api -H "$AUTH" "$BASE/pairings/$CODE" | jq -r .status)" = linked ]

step "GET /me"
api -b "$JAR" -c "$JAR" "$BASE/me"

step "phone posts a message; TV reads it"
api -b "$JAR" -X POST "$BASE/links/$LINK/messages" -d '{"kind":"text","text":"hello from the phone"}'
MSGS=$(api -H "$AUTH" "$BASE/links/$LINK/messages"); echo "$MSGS"
[ "$(jq -r '.messages[0].text' <<<"$MSGS")" = "hello from the phone" ]

step "TV reports what is playing; phone reads it"
api -H "$AUTH" -X PUT "$BASE/links/$LINK/now" -d '{"mediaId":"demo","title":"Demo","t":12.5,"playing":true}'
api -b "$JAR" "$BASE/links/$LINK/now"

step "upload a 20 MB file in 2 parts"
head -c 20000000 /dev/urandom > "$FILE"
UP=$(api -b "$JAR" -X POST "$BASE/uploads" -d '{"name":"smoke.mp4","size":20000000,"type":"video/mp4"}')
MEDIA=$(jq -r .mediaId <<<"$UP"); PSIZE=$(jq -r .partSize <<<"$UP")
[ "$(jq '.parts | length' <<<"$UP")" = 2 ]
PARTS='[]'
for N in 1 2; do
  URL=$(jq -r ".parts[] | select(.n==$N) | .url" <<<"$UP")
  dd if="$FILE" bs="$PSIZE" skip=$((N - 1)) count=1 of="$FILE.part" 2>/dev/null
  CODE=$(curl -sS --retry 3 --retry-all-errors --retry-delay 3 -D "$FILE.hdr" -o "$FILE.body" \
    -w '%{http_code}' -X PUT -T "$FILE.part" "$URL") || true
  ETAG=$(tr -d '\r' < "$FILE.hdr" | awk 'tolower($1)=="etag:" {print $2}' | tail -1)
  [ "$CODE" = 200 ] && [ -n "$ETAG" ] || { echo "part $N failed: HTTP $CODE"; head -c 600 "$FILE.body"; echo; exit 1; }
  PARTS=$(jq -c ". + [{\"n\":$N,\"etag\":$ETAG}]" <<<"$PARTS")
done
echo "parts: $PARTS"

step "complete"
api -b "$JAR" -X POST "$BASE/uploads/$MEDIA/complete" -d "{\"parts\":$PARTS}"

step "GET /media shows PROCESSING"
STATUS=$(api -b "$JAR" "$BASE/media/$MEDIA" | tee /dev/stderr | jq -r .status)
[ "$STATUS" = PROCESSING ]

step "unauthenticated /me is 401"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/me")" = 401 ]

echo; echo "SMOKE OK"
