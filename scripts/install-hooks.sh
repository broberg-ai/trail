#!/usr/bin/env bash
# F207.2 — point git at the repo's committed hooks.
#
# .git/hooks cannot be shared through a clone, so the hooks live in .githooks
# and git is told to look there. One command, idempotent, and every clone of
# this repo gets the secret gate by running it once.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

chmod +x .githooks/* 2>/dev/null || true
git config core.hooksPath .githooks

echo "[hooks] core.hooksPath → .githooks"
echo "[hooks] active: $(ls .githooks | tr '\n' ' ')"
