#!/bin/bash
# F222.3 — start one sqld per tenant + the backup sidecar.
#
# TRAIL_DB_TENANTS  "fd-aalborg:6001,broberg-ai:6002" — slug:port pairs.
# SQLD_JWT_KEY_<SLUG> (slug uppercased, - → _) — the tenant's Ed25519
#   PUBLIC key as URL-safe base64 (raw 32 bytes). Auth is MANDATORY:
#   a tenant listed without a key refuses to start, loudly. Public keys
#   are not secrets, but they live in env so rotation is a config push,
#   not an image rebuild.
#
# If ANY sqld process dies, the whole machine exits non-zero so Fly
# restarts it — a half-alive DB machine that serves two tenants out of
# three would look healthy from every probe that happens to hit the
# living two.
set -euo pipefail

DATA_ROOT=/var/lib/sqld
KEY_DIR="$DATA_ROOT/.jwt-keys"
mkdir -p "$KEY_DIR"

if [ -z "${TRAIL_DB_TENANTS:-}" ]; then
  echo "[trail-db] TRAIL_DB_TENANTS is empty — nothing to serve" >&2
  exit 1
fi

pids=()
IFS=',' read -ra PAIRS <<< "$TRAIL_DB_TENANTS"
for pair in "${PAIRS[@]}"; do
  slug="${pair%%:*}"
  port="${pair##*:}"
  keyvar="SQLD_JWT_KEY_$(echo "$slug" | tr '[:lower:]-' '[:upper:]_')"
  key="${!keyvar:-}"
  if [ -z "$key" ]; then
    echo "[trail-db] REFUSING to start '$slug': $keyvar is not set — auth is mandatory" >&2
    exit 1
  fi
  printf '%s' "$key" > "$KEY_DIR/$slug.pub"
  mkdir -p "$DATA_ROOT/$slug"

  # F222.3 migration path: an operator sftp's the tenant's VACUUM-INTO copy
  # to $DATA_ROOT/<slug>/SEED-data.db and restarts the machine. The seed
  # REPLACES whatever sqld state the tenant dir held (placing the file IS
  # the deliberate act), and is consumed exactly once — the rename makes a
  # second restart a no-op instead of a silent re-wipe. The engine still
  # refuses to serve until the parity check writes the migration marker.
  seed="$DATA_ROOT/$slug/SEED-data.db"
  if [ -f "$seed" ]; then
    echo "[trail-db] seeding '$slug' from SEED-data.db ($(stat -c%s "$seed") bytes)"
    rm -rf "$DATA_ROOT/$slug/iku.db"
    mkdir -p "$DATA_ROOT/$slug/iku.db/dbs/default"
    mv "$seed" "$DATA_ROOT/$slug/iku.db/dbs/default/data"
  fi
  echo "[trail-db] starting sqld for '$slug' on [::]:$port (db-path $DATA_ROOT/$slug/iku.db)"
  sqld \
    --db-path "$DATA_ROOT/$slug/iku.db" \
    --http-listen-addr "[::]:$port" \
    --auth-jwt-key-file "$KEY_DIR/$slug.pub" &
  pids+=($!)
done

/usr/local/bin/trail-db-backup.sh &
pids+=($!)

# First child to exit takes the machine down — fail loud, Fly restarts.
wait -n "${pids[@]}"
echo "[trail-db] a child process exited — restarting the machine" >&2
exit 1
