#!/usr/bin/env bash
# F263.14 — åbn en FRISK cc-session der kompilerer én kontos kø, og intet andet.
#
# HVORFOR IKKE bare ~/.buddy/bin/ccb-open, som ellers gør det rigtige med auth:
# den resumer ALTID repoets nyeste samtale (`--resume $(freshest-session.sh)`).
# Det er rigtigt til dens formål — at vække et repos session — og forkert til en
# arbejder. Målt 8/9: den genoptog ejerens LEVENDE session, så der stod to
# Claude-processer på samme transskript, og arbejderen startede med 840.000
# tokens af en samtale den ikke havde brug for.
#
# En kompilerings-arbejder skal starte tom. `/local-ingest` er selvbærende, og
# CLAUDE.md indlæses ved opstart — det er præcis nok kontekst.
#
# DE TO LINJER DER SKAL MED, og som er hele grunden til at scriptet findes
# (kopieret fra ccb-open, med kilde, frem for genopfundet):
#   · CLAUDE_CODE_OAUTH_TOKEN — uden den: «Not logged in» OG «API Usage
#     Billing». En session åbnet fra en GUI-app arver ikke ejerens login.
#   · PATH — `bash -lc` rammer ~/.bashrc's tidlige return, så ccb/claude/bun
#     ikke er på stien.
#
# ALDRIG `claude -p`. Sessionen er interaktiv; den vej er API-betalt og ville
# ophæve hele grunden til at den lokale motor findes.
set -euo pipefail

REPO="${1:?brug: spawn-ingest.sh <repo> <session-navn> <konto>}"
NAME="${2:?brug: spawn-ingest.sh <repo> <session-navn> <konto>}"
TENANT="${3:?brug: spawn-ingest.sh <repo> <session-navn> <konto>}"

# Kontoen ender i en kommando der sendes til en terminal. Afvis frem for at
# citere: at citere er en løbende forpligtelse, at afvise er en engangsbeslutning.
if ! printf '%s' "$TENANT" | grep -qE '^[a-z0-9-]{1,64}$'; then
  echo "spawn-ingest: ugyldig konto: $TENANT" >&2; exit 2
fi

CMD="/local-ingest $TENANT"

if tmux has-session -t "$NAME" 2>/dev/null; then
  tmux send-keys -t "$NAME" "$CMD" Enter
  echo "spawn-ingest: sendt til eksisterende session '$NAME'"
  exit 0
fi

LAUNCH="/tmp/trail-spawn-${NAME}.sh"
cat > "$LAUNCH" <<EOS
#!/usr/bin/env bash
export PATH="\$HOME/.bun/bin:\$HOME/.local/bin:\$HOME/.buddy/bin:\$PATH"
eval "\$(grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' "\$HOME/.buddy/.env" 2>/dev/null | sed 's/^/export /')"
cd "$REPO"
BUDDY_SESSION_NAME="$NAME" exec ccb --model opus
EOS
chmod +x "$LAUNCH"

tmux new-session -d -s "$NAME" "$LAUNCH"

# Opstarten kan have en tillids-prompt. To Enter med mellemrum, som ccb-open
# selv gør — sender vi kommandoen ind i prompten, forsvinder den TAVST.
( sleep 6;  tmux send-keys -t "$NAME" Enter 2>/dev/null || true
  sleep 9;  tmux send-keys -t "$NAME" Enter 2>/dev/null || true
  sleep 10; tmux send-keys -t "$NAME" "$CMD" Enter 2>/dev/null || true ) &

echo "spawn-ingest: åbnet '$NAME' (frisk session, kommandoen sendes om ~25s)"
