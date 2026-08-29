#!/bin/sh
# F196 — self-report this deploy to upmetrics on boot. Runs from nginx:alpine's
# /docker-entrypoint.d/ before nginx starts. Fail-soft: one success POST,
# never fails the boot (always exits 0). Dormant (no-op) until UPMETRICS_API_KEY
# + UPMETRICS_SITE are both set. Contract: F196 plan-doc / upmetrics #4223.
#
# F196.5 — warn when this deploy cannot name its own commit. A bare
# `flyctl deploy` is `pnpm ship:*` minus --build-arg GIT_SHA, so the Dockerfile's
# `ARG GIT_SHA=unknown` default wins and the register gets a row that says a
# deploy happened but not WHICH code. Measured 2026-08-29 on the engine: four
# hours of sha="unknown", and a fix that was live could not be shown to be.
# The report still goes out — a deploy that happened must always be recorded.
set +e
if [ -n "$UPMETRICS_API_KEY" ] && [ -n "$UPMETRICS_SITE" ]; then
  SHA="${GIT_SHA:-unknown}"
  BASE="${UPMETRICS_BASE_URL:-https://upmetrics.org}"
  ORIGINATOR="${UPMETRICS_ORIGINATOR:-trail}"
  if [ -z "$GIT_SHA" ] || [ "$SHA" = "unknown" ]; then
    echo "[deploy] WARN $UPMETRICS_SITE: GIT_SHA is unset — reporting sha=\"unknown\", so this deploy cannot be traced to a commit. Deploy with \`pnpm ship:*\` (it passes --build-arg GIT_SHA), not a bare \`flyctl deploy\`." >&2
  fi
  curl -fsS -m 5 -X POST "$BASE/api/deploys" \
    -H "X-Upmetrics-Key: $UPMETRICS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"site\":\"$UPMETRICS_SITE\",\"deploy_id\":\"$SHA-$UPMETRICS_SITE\",\"status\":\"success\",\"sha\":\"$SHA\",\"originator\":\"$ORIGINATOR\",\"provider\":\"fly\"}" \
    >/dev/null 2>&1 || true
fi
exit 0
