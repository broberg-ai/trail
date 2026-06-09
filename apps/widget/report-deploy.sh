#!/bin/sh
# F196 — self-report this deploy to upmetrics on boot. Runs from nginx:alpine's
# /docker-entrypoint.d/ before nginx starts. Fail-soft: one success POST,
# never fails the boot (always exits 0). Dormant (no-op) until UPMETRICS_API_KEY
# + UPMETRICS_SITE are both set. Contract: F196 plan-doc / upmetrics #4223.
set +e
if [ -n "$UPMETRICS_API_KEY" ] && [ -n "$UPMETRICS_SITE" ]; then
  SHA="${GIT_SHA:-unknown}"
  BASE="${UPMETRICS_BASE_URL:-https://upmetrics.org}"
  ORIGINATOR="${UPMETRICS_ORIGINATOR:-trail}"
  curl -fsS -m 5 -X POST "$BASE/api/deploys" \
    -H "X-Upmetrics-Key: $UPMETRICS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"site\":\"$UPMETRICS_SITE\",\"deploy_id\":\"$SHA-$UPMETRICS_SITE\",\"status\":\"success\",\"sha\":\"$SHA\",\"originator\":\"$ORIGINATOR\",\"provider\":\"fly\"}" \
    >/dev/null 2>&1 || true
fi
exit 0
