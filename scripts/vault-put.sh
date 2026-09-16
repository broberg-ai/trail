#!/usr/bin/env bash
# F343.14 — put a secret in the Vault WITHOUT its value entering an agent's context.
#
# Raised by the helpdesk session, 9 Sep 2026, and it was a real contradiction:
#
#   "Reglen siger at værdien aldrig må gå gennem en LLM-kontekst, men
#    vault-værktøjet tager den som parameter — så jeg kan ikke gemme den dér
#    uden at bryde den regel den findes for."
#
# They were right, and they did the right thing: they did NOT store it.
#
# The capability existed; the ROUTE to it did not. POST /api/vault/secrets already
# accepts a pa_ Bearer key, so a shell script can read the value from a file and
# send it over HTTPS while the agent only ever handles a PATH. This script is that
# route, named, so nobody has to hand-roll a curl and get the quoting wrong on a
# multiline PEM.
#
# Usage:
#   scripts/vault-put.sh [--keep-newline] <project_id> "<name>" <file> [ENV_VAR_NAME]
#
# The agent never reads the file. It passes the path, and gets back id + preview.
#
# MEASURED on production before this was written: a 178-byte, 4-newline PEM-shaped
# value round-tripped BYTE-IDENTICAL (sha256 equal both ways), and the create
# response carried only id, name, type and a masked preview.
set -euo pipefail

KEEP_NEWLINE=0
if [ "${1:-}" = "--keep-newline" ]; then KEEP_NEWLINE=1; shift; fi

PROJECT_ID="${1:?project_id required}"
NAME="${2:?name required}"
FILE="${3:?path to a file holding the secret required}"
ENV_VAR="${4:-}"

[ -r "$FILE" ] || { echo "vault-put: cannot read $FILE" >&2; exit 1; }
[ -s "$FILE" ] || { echo "vault-put: $FILE is empty — refusing to store nothing" >&2; exit 1; }

# F350 — THE ONE BYTE NOBODY TYPED.
#
# Reported by voice-engine from walking into it, reproduced here before anything
# was changed:
#
#   openssl rand -hex 32 > /tmp/s          writes 65 bytes  (64 hex + '\n')
#   this script stores                      65
#   printf 'X=%s\n' "$(cat /tmp/s)"        64  — command substitution strips it
#
# Two copies of one secret, one invisible character apart, and NOTHING FAILS
# TODAY because each side is used against itself. It fails the first time someone
# takes the value from the VAULT instead of the file — a new machine, a
# container, a rotation — as a 401 with no explanation, against a secret whose UI
# preview looks identical, because the preview is first-four-last-four.
#
# STRIPPING IS NOT THE FIX. It is the same bug pointing the other way: a PEM and
# an Apple .p8 legitimately end in a newline, and silently removing it would
# corrupt every key of that kind while looking equally fine. The comment below is
# right — the value is the FILE BYTES.
#
# So the DISCRIMINATING case is the whole fix: exactly one trailing newline AND
# no interior newline is a single-line token with an accident on the end. A PEM
# has interior newlines; a hex key does not.
#
# IT REFUSES RATHER THAN WARNS. A warning printed into a terminal nobody re-reads
# is a written constraint, and a written constraint is not a gate. The refusal
# names the command that fixes it, and --keep-newline is the door — a guard with
# no escape hatch gets worked around instead of used.
if [ "$KEEP_NEWLINE" -eq 0 ]; then
  FILE="$FILE" python3 - <<'GUARD' || exit 1
import os, sys
raw = open(os.environ["FILE"], "rb").read()
if raw.endswith(b"\n") and b"\n" not in raw[:-1]:
    n = len(raw)
    sys.stderr.write(
        f"vault-put: refusing — {os.environ['FILE']} is a single-line value with a trailing\n"
        f"           newline, so the Vault would hold {n} bytes while a .env written the\n"
        f"           usual way holds {n - 1}. Nothing would fail until someone reads the\n"
        "           secret from the Vault instead of the file, and then it is a 401 with\n"
        "           no explanation.\n\n"
        "  Fix:     printf '%s' \"$(cat <file>)\" > <file>.trimmed   # then store .trimmed\n"
        "  Or:      vault-put.sh --keep-newline ...                 # if the newline is meant\n"
    )
    sys.exit(1)
GUARD
fi

BASE="${CARDMEM_CLOUD:-https://services.cardmem.com}"
KEY="${CARDMEM_MCP_KEY:-$(python3 -c "import json;print(json.load(open('.mcp.json'))['mcpServers']['cardmem']['headers']['Authorization'].split()[1])")}"

# python, not `jq`+`curl`: the value must be JSON-encoded from the FILE BYTES.
# Interpolating it into a shell string is where a newline or a quote in a PEM
# silently corrupts the secret — and a corrupted secret looks stored.
PROJECT_ID="$PROJECT_ID" NAME="$NAME" FILE="$FILE" ENV_VAR="$ENV_VAR" BASE="$BASE" KEY="$KEY" \
python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error
payload = {
    "project_id": os.environ["PROJECT_ID"],
    "name": os.environ["NAME"],
    # Read as BYTES and decode explicitly, so the length reported below is the
    # length STORED rather than a character count that agrees with it only for
    # ASCII. A UTF-8 passphrase is exactly where those two diverge.
    "value": open(os.environ["FILE"], "rb").read().decode("utf-8"),
}
if os.environ.get("ENV_VAR"):
    payload["env_var_name"] = os.environ["ENV_VAR"]
req = urllib.request.Request(
    os.environ["BASE"] + "/api/vault/secrets",
    data=json.dumps(payload).encode(),
    method="POST",
    headers={"Authorization": "Bearer " + os.environ["KEY"], "content-type": "application/json"},
)
try:
    body = json.loads(urllib.request.urlopen(req).read().decode())
except urllib.error.HTTPError as e:
    # The error body may echo the request; print only the status and a short reason.
    print(f"vault-put: HTTP {e.code} — {e.read().decode()[:160]}", file=sys.stderr)
    sys.exit(1)
# Only id + masked preview are ever printed. The value is not in this output, and
# so is not in the transcript of whoever ran it.
#
# F350 — THE BYTE COUNT IS THE INSTRUMENT THAT WOULD HAVE CAUGHT THIS. voice-engine
# read {id, name, type:"labeled-hex-secret", preview:"1094…aaad"} and it looked
# completely fine, because the preview is first-four-last-four and cannot show a
# length. "65" beside a 64-character hex key is the tell, and it costs one field.
# It is a LENGTH, never a fragment: it says how much, never any of it.
out = {k: body.get(k) for k in ("id", "name", "type", "preview")}
out["bytes"] = len(open(os.environ["FILE"], "rb").read())
print(json.dumps(out))
PY
