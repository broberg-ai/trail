#!/bin/bash
# F222.3 — daily per-tenant DB backup to object storage (the engine's
# VACUUM-INTO rung, relocated to the machine that owns the files).
#
# Per tenant: sqlite3 ".backup" (transactionally consistent, works on a
# live WAL database) → gzip → rclone to the Tigris bucket under
# _db-backups/<slug>/<ISO-date>.db.gz. Retention: 30 days.
#
# Env (same AWS_* set flyctl storage injects, reused as rclone config):
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_ENDPOINT_URL_S3 / BUCKET_NAME
#
# Runs immediately on boot (so a fresh deploy proves the rung works,
# rather than promising tonight will), then every 24h. Failures are
# LOGGED and the loop continues — a broken backup must be visible in
# logs, but must not take the serving processes down with it.
set -uo pipefail

DATA_ROOT=/var/lib/sqld

export RCLONE_CONFIG_TIGRIS_TYPE=s3
export RCLONE_CONFIG_TIGRIS_PROVIDER=Other
export RCLONE_CONFIG_TIGRIS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
export RCLONE_CONFIG_TIGRIS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"
export RCLONE_CONFIG_TIGRIS_ENDPOINT="${AWS_ENDPOINT_URL_S3:-}"

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${BUCKET_NAME:-}" ]; then
  echo "[trail-db-backup] AWS_*/BUCKET_NAME not set — backup sidecar INERT (ship dark)" >&2
  # Stay alive doing nothing: an inert sidecar must not kill the machine.
  while true; do sleep 86400; done
fi

while true; do
  IFS=',' read -ra PAIRS <<< "${TRAIL_DB_TENANTS:-}"
  for pair in "${PAIRS[@]}"; do
    slug="${pair%%:*}"
    src="$DATA_ROOT/$slug/iku.db/dbs/default/data"
    if [ ! -f "$src" ]; then
      echo "[trail-db-backup] $slug: no data file yet at $src — skipping" >&2
      continue
    fi
    stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
    tmp="/tmp/backup-$slug.db"
    if sqlite3 "$src" ".backup $tmp"; then
      gzip -f "$tmp"
      dest="tigris:$BUCKET_NAME/_db-backups/$slug/$stamp.db.gz"
      if rclone copyto "$tmp.gz" "$dest" 2>&1; then
        size=$(stat -c%s "$tmp.gz" 2>/dev/null || echo '?')
        echo "[trail-db-backup] $slug: uploaded $dest ($size bytes)"
      else
        echo "[trail-db-backup] $slug: UPLOAD FAILED to $dest" >&2
      fi
      rm -f "$tmp.gz"
    else
      echo "[trail-db-backup] $slug: sqlite3 .backup FAILED on $src" >&2
    fi
  done
  # 30-day retention, per tenant prefix.
  rclone delete "tigris:$BUCKET_NAME/_db-backups/" --min-age 30d 2>/dev/null || true
  sleep 86400
done
