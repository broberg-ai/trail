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

# F222.9 — basis-imaget er Debian 11 (bullseye), som er udløbet. Pakkefilerne
# er flyttet til archive.debian.org, mens spejlet stadig serverer et INDEKS der
# peger på dem. `apt-get update` lykkes derfor, og `apt-get install` fejler
# med 404 på selve .deb-filerne — en fejl der ikke ligner en udløbet udgivelse.
#
# MÅLT 22. september 2026, og det aflyser den oplagte rettelse:
#   deb.debian.org/debian-security/dists/bullseye-security/Release   200
#   archive.debian.org/debian/dists/bullseye/Release                 200
#   archive.debian.org/debian-security/…/bullseye-security/Release   404
#
# Arkivet bærer altså IKKE security-suiten. «Peg security mod arkivet» kan
# ikke lade sig gøre; den eneste vej er main fra arkivet. Begge pakker findes
# der (målt i binary-arm64/Packages): sqlite3 3.34.1-3 · rclone 1.53.3-1.
#
# PRISEN, sagt højt: vi installerer uden bullseye-security. sqlite3 og rclone
# er CLI-værktøjer på en maskine UDEN offentlig IP, som kun motoren når over
# Flys private net — men det er en reel afvejning, ikke et gratis valg. Den
# rigtige langsigtede rettelse er et nyere basis-image; det er libsql-serverens
# valg, ikke vores, og hører i sit eget kort.
#
# Kodenavnet læses af imaget frem for at stå her: et hardkodet «bullseye»
# bliver forkert i tavshed den dag basis-imaget opgraderes, og så installerer
# vi pakker fra en anden udgivelse end den vi kører.
RUN . /etc/os-release \
    && printf 'deb http://archive.debian.org/debian %s main\n' "$VERSION_CODENAME" > /etc/apt/sources.list \
    && rm -f /etc/apt/sources.list.d/*.list \
    && printf 'Acquire::Check-Valid-Until "false";\n' > /etc/apt/apt.conf.d/99archive \
    && apt-get update && apt-get install -y --no-install-recommends \
      sqlite3 rclone ca-certificates \
    && sqlite3 --version && rclone version | head -1 \
    && rm -rf /var/lib/apt/lists/*

COPY start.sh /usr/local/bin/trail-db-start.sh
COPY backup.sh /usr/local/bin/trail-db-backup.sh
RUN chmod +x /usr/local/bin/trail-db-start.sh /usr/local/bin/trail-db-backup.sh

ENTRYPOINT []
CMD ["/usr/local/bin/trail-db-start.sh"]
