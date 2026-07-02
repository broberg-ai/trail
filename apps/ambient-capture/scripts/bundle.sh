#!/usr/bin/env bash
# F201.3 — build the SPM executable and assemble "Trail Ambient.app".
# Turbo entry point (package.json `build`). Skips LOUDLY on machines
# without Swift (Linux CI/Docker builders) instead of failing the graph.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v swift >/dev/null 2>&1; then
  echo "[ambient-capture] swift not found on this machine — SKIPPING native build (expected on Linux CI)."
  exit 0
fi

swift build -c release

APP="dist/Trail Ambient.app"
BIN=".build/release/TrailAmbient"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/TrailAmbient"

# App icon — draw the Trail mark via the built binary, then iconutil → .icns.
ICONWORK="$(mktemp -d)"
"$BIN" --genicon "$ICONWORK" >/dev/null 2>&1 || true
if [ -d "$ICONWORK/AppIcon.iconset" ] && command -v iconutil >/dev/null 2>&1; then
  iconutil -c icns "$ICONWORK/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns" 2>/dev/null \
    && echo "[ambient-capture] app icon: Trail mark → AppIcon.icns"
fi
rm -rf "$ICONWORK"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.broberg.trail-ambient</string>
  <key>CFBundleName</key><string>Trail Ambient</string>
  <key>CFBundleExecutable</key><string>TrailAmbient</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <!-- No Dock icon; presence lives in the menubar status item (F201.3). -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
# Ad-hoc signing keeps a stable TCC identity across local rebuilds, so the
# Accessibility grant doesn't have to be re-approved on every build.
codesign --force --sign - "$APP" 2>/dev/null || true
echo "[ambient-capture] built $APP"
