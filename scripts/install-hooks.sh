#!/usr/bin/env bash
# F207.2 — point git at the repo's committed hooks.
#
# .git/hooks cannot be shared through a clone, so the hooks live in .githooks
# and git is told to look there. One command, idempotent, and every clone of
# this repo gets the secret gate by running it once.
set -euo pipefail

# A Docker build has no .git — and root package.json runs this from `prepare`,
# so every `pnpm install` in a container hit `git rev-parse` and died. That
# broke EVERY deploy from 2026-08-23 (when the hook was added) until this fix,
# silently: the engine simply kept serving the 2026-07-04 image while each
# deploy failed on a git hook that has no business running there.
if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "[hooks] not a git checkout (container build?) — nothing to install"
  exit 0
fi

cd "$(git rev-parse --show-toplevel)"

chmod +x .githooks/* 2>/dev/null || true
git config core.hooksPath .githooks

echo "[hooks] core.hooksPath → .githooks"
echo "[hooks] active: $(ls .githooks | tr '\n' ' ')"
