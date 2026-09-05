# F222.3 — Trail DB machine (trail-db-001, org broberg-ai, region arn).
#
# One sqld (libsql-server) PROCESS PER TENANT on its own port — real
# isolation without namespace/Host-header tricks (measured in F222.2:
# the client's Host handling over Fly's IPv6-only private net is not a
# seam we control; a process per tenant is). The machine has NO public
# IP; only the engine reaches it over the private network, and every
# process requires a per-tenant Ed25519 JWT (sqld --auth-jwt-key-file).
#
# The backup sidecar replaces the engine's VACUUM-INTO rung for remote
# tenants: daily sqlite3 .backup per tenant → gzip → object storage
# (Tigris, arn) via rclone. The engine's runBackupPass refuses remote
# tenants by design — this loop is where that rung lives now.
FROM ghcr.io/tursodatabase/libsql-server:latest

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      sqlite3 rclone ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY start.sh /usr/local/bin/trail-db-start.sh
COPY backup.sh /usr/local/bin/trail-db-backup.sh
RUN chmod +x /usr/local/bin/trail-db-start.sh /usr/local/bin/trail-db-backup.sh

ENTRYPOINT []
CMD ["/usr/local/bin/trail-db-start.sh"]
