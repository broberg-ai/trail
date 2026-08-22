#!/usr/bin/env bash
# F201 — the native harness gate. Runs the headless proofs that DON'T need a
# human TCC grant, so a broken menubar icon (F201.3) or OCR/delta path (F201.5)
# fails the build instead of shipping silently. Skips LOUDLY on machines
# without Swift (Linux CI) rather than failing the turbo graph.
set -euo pipefail
cd "$(dirname "$0")/.."

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

echo "[ambient-capture] --ocrtest (on-device Vision OCR + delta guard)"
"$BIN" --ocrtest

echo "[ambient-capture] --audiotest (VAD segmentation + WAV round-trip + deny-list)"
"$BIN" --audiotest

echo "[ambient-capture] --dicttest (F201.14 ordbog: whole-word STT corrections + biasing terms)"
"$BIN" --dicttest

echo "[ambient-capture] --minetest (F201.14 mining: near-miss detection + no false positives)"
"$BIN" --minetest
