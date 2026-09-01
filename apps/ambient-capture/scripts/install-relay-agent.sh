#!/usr/bin/env bash
# F201.21 — make the ambient relay durable.
#
# The Swift agent captures into ~/Library/Logs/TrailAmbient/focus.jsonl. A
# SEPARATE Bun process (@trail/ambient-gate relay) is what reads that file and
# posts to Trail. Nothing started it automatically, so from the day someone's
# terminal closed, Ambient captured into a local file and saved nothing — for
# two months, while the menubar stayed green because the AGENT was still running.
#
# This installs the relay as a LaunchAgent so it starts at login and is
# restarted if it exits. The Swift app already does the same for itself via
# SMAppService (F201.20); this closes the other half of the pair.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LABEL="ai.broberg.trail-ambient-relay"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BUN="$(command -v bun)"
LOGDIR="$HOME/Library/Logs/TrailAmbient"

[ -n "$BUN" ] || { echo "bun not on PATH — cannot install relay agent" >&2; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>run</string>
    <string>$REPO/packages/ambient-gate/src/relay.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO/packages/ambient-gate</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGDIR/relay.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/relay.err.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
echo "[relay] installed as $LABEL"
echo "[relay] logs: $LOGDIR/relay.log"
