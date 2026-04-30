#!/bin/sh
# F168 — Beam: engine-side import script.
#
# Untars an incoming beam-tar, verifies trail.db sha256 against the
# expected value, and atomically renames staging → /data/{slug}/.
# If a tenant directory already exists at the destination, it is moved
# to /data/_archive/{slug}-{timestamp} rather than deleted (defensive
# against accidental data loss; manual cleanup later).
#
# Usage: beam-import.sh <tar-file> <slug> <expected_sha256_of_trail_db>
#
# Exit codes:
#   0 — imported successfully
#   1 — input validation failed (missing args, missing tar)
#   2 — tar extraction failed
#   3 — sha256 mismatch
#   4 — atomic rename failed
#
# Run as: invoked over `fly ssh console -C` from the local beam.ts CLI.

set -eu

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <tar-file> <slug> <expected_sha256>" >&2
  exit 1
fi

TAR="$1"
SLUG="$2"
EXPECTED_SHA="$3"

DATA_DIR="/data"
STAGING="${DATA_DIR}/_staging-${SLUG}-$$"
DEST="${DATA_DIR}/${SLUG}"
ARCHIVE_DIR="${DATA_DIR}/_archive"

if [ ! -f "${TAR}" ]; then
  echo "ERROR: tar file not found: ${TAR}" >&2
  exit 1
fi

mkdir -p "${ARCHIVE_DIR}"
mkdir -p "${STAGING}"

echo "[beam-import] Extracting ${TAR} → ${STAGING}..."
if ! tar -xf "${TAR}" -C "${STAGING}"; then
  rm -rf "${STAGING}"
  echo "ERROR: tar extraction failed" >&2
  exit 2
fi

if [ ! -f "${STAGING}/trail.db" ]; then
  echo "ERROR: ${STAGING}/trail.db missing after extract" >&2
  rm -rf "${STAGING}"
  exit 2
fi

echo "[beam-import] Verifying sha256..."
ACTUAL_SHA=$(sha256sum "${STAGING}/trail.db" | awk '{print $1}')
if [ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]; then
  echo "ERROR: sha256 mismatch" >&2
  echo "  expected: ${EXPECTED_SHA}" >&2
  echo "  actual:   ${ACTUAL_SHA}" >&2
  rm -rf "${STAGING}"
  exit 3
fi
echo "[beam-import] ✓ sha256 matches"

# Reorganize staging so its layout matches /data/{slug}/ exactly.
# beam.ts produces:
#   staging/
#     trail.db
#     uploads/{tenant_id}/{kb_id}/...
#     manifest.json
# Engine reads:
#   /data/{slug}/trail.db        ← DB file
#   /data/{slug}/uploads/...     ← blob tree
# So no rearrangement needed; just move staging → /data/{slug}/.

if [ -d "${DEST}" ]; then
  TS=$(date +%s)
  ARCHIVE_TARGET="${ARCHIVE_DIR}/${SLUG}-${TS}"
  echo "[beam-import] Archiving existing ${DEST} → ${ARCHIVE_TARGET}"
  if ! mv "${DEST}" "${ARCHIVE_TARGET}"; then
    rm -rf "${STAGING}"
    echo "ERROR: failed to archive existing destination" >&2
    exit 4
  fi
fi

echo "[beam-import] Renaming staging → ${DEST}"
if ! mv "${STAGING}" "${DEST}"; then
  echo "ERROR: failed to rename staging into place" >&2
  exit 4
fi

# Clean up tar so /data/_incoming/ doesn't accumulate
rm -f "${TAR}"

# Reverse of fly ssh console's typical newline-stripping: print one final
# OK line that the calling beam.ts can grep for.
echo "[beam-import] OK ${SLUG}"
