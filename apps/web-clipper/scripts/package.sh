#!/usr/bin/env bash
# F208.4 — build a store-ready zip, reproducibly.
#
# The zip is NOT committed. A binary artefact in git goes stale the moment the
# source moves, and the store would then receive whichever build somebody last
# remembered to regenerate. This script is the artefact; the zip is output.
#
# It also scans what it produced. The zip is what strangers receive, so the
# check belongs on the EXTRACTED CONTENTS, not on the source tree — a
# credential could reach the bundle through a build step that never touches a
# tracked file (F207: a real key shipped in this extension's source for four
# months in a public repo).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT="trail-web-clipper-${VERSION}.zip"

echo "[package] building v${VERSION} …"
pnpm build >/dev/null

rm -f "$OUT"
(cd dist && zip -qr "../$OUT" .)

# --- prove the shipped bundle carries no credential -------------------------
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
unzip -q "$OUT" -d "$TMP"
if grep -rlEq "trail_[0-9a-f]{20,}|AIza[A-Za-z0-9_-]{30,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----" "$TMP" 2>/dev/null; then
  echo "[package] REFUSING — a credential is present in the packaged bundle:"
  grep -rlE "trail_[0-9a-f]{20,}|AIza[A-Za-z0-9_-]{30,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----" "$TMP" | sed "s|$TMP|  |"
  rm -f "$OUT"
  exit 1
fi

# --- and that it is not asking for the world --------------------------------
node -e '
  const m = require(process.argv[1] + "/manifest.json");
  const broad = (m.host_permissions || []).filter((h) => h.includes("<all_urls>") || h === "*://*/*");
  if (broad.length) {
    console.error("[package] REFUSING — host_permissions is broad again: " + broad.join(", "));
    console.error("[package] Chrome shows that as \"Read and change all your data on all websites\".");
    process.exit(1);
  }
  if (m.content_scripts) {
    console.error("[package] REFUSING — a declared content script is back; it runs on every page the user visits.");
    process.exit(1);
  }
' "$TMP"

echo "[package] $OUT  ($(du -h "$OUT" | cut -f1))  — no credential, permissions still narrow"
