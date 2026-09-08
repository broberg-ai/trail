#!/usr/bin/env bash
# F201 — the native harness gate. Runs the headless proofs that DON'T need a
# human TCC grant, so a broken menubar icon (F201.3) or OCR/delta path (F201.5)
# fails the build instead of shipping silently. Skips LOUDLY on machines
# without Swift (Linux CI) rather than failing the turbo graph.
set -euo pipefail
cd "$(dirname "$0")/.."

# F263.3 — spærren mod den BETALTE vej kører FØR platform-tjekket, med vilje.
# Den er ren grep og har ingen Swift- eller macOS-afhængighed, så den skal også
# være rød på Linux-CI. Lægges den efter tjekket nedenfor, springes præcis den
# regel over netop dér hvor ingen sidder og kigger.
bash scripts/guard-no-metered-claude.sh

# The guard used to ask "is swift installed?", which is the wrong question:
# GitHub's ubuntu runner HAS swift, so the check passed and the build then died
# on AppKit/AVFoundation/CoreML — this is a macOS menubar app and cannot be
# built anywhere else. Ask about the platform instead (F206.2).
if [ "$(uname -s)" != "Darwin" ]; then
  echo "[ambient-capture] not macOS — SKIPPING native tests (this is a macOS-only app)."
  exit 0
fi

if ! command -v swift >/dev/null 2>&1; then
  echo "[ambient-capture] swift not found — SKIPPING native tests."
  exit 0
fi

swift build >/dev/null
BIN=".build/debug/TrailAmbient"

echo "[ambient-capture] --selftest (pause gate + menubar icon visibility)"
"$BIN" --selftest

echo "[ambient-capture] --spawntest (Ambient åbner selv sessionen — og ALDRIG med -p)"
"$BIN" --spawntest

echo "[ambient-capture] --statustest (MÅLINGEN slår indstillingen i statuslinjen)"
"$BIN" --statustest

echo "[ambient-capture] --tenanttest (konto-lageret: én nøgle pr. konto + arvet parring)"
# Ren lokal prøve i sit eget navnerum — rører hverken den rigtige Keychain
# eller netværket, så den kan køre ved hver `pnpm test`.
"$BIN" --tenanttest

echo "[ambient-capture] --enginetest (motor-kontakten LÆSER buddys jobs)"
# KUN læsning. `--enginetoggletest` findes ved siden af og beviser at kontakten
# SKRIVER — men den slår rigtige jobs fra og til igen, så den køres i hånden,
# ikke ved hver `pnpm test`. En prøvesuite der flipper produktions-jobs er en
# prøvesuite folk holder op med at køre.
"$BIN" --enginetest

echo "[ambient-capture] --ocrtest (on-device Vision OCR + delta guard)"
"$BIN" --ocrtest

echo "[ambient-capture] --audiotest (VAD segmentation + WAV round-trip + deny-list)"
"$BIN" --audiotest

echo "[ambient-capture] --dicttest (F201.14 ordbog: whole-word STT corrections + biasing terms)"
"$BIN" --dicttest

echo "[ambient-capture] --minetest (F201.14 mining: near-miss detection + no false positives)"
"$BIN" --minetest
