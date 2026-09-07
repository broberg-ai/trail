#!/usr/bin/env bash
# F263.3 — SPÆRREN MOD DEN BETALTE VEJ.
#
# Ejerens ordre 7/9 2026, ordret: «Ambient må på INGEN måde afvikle CC som -p …
# den skal køre i denne session eller en headless session spawned the Cardmem
# way.» Bekræftet som beslutning i registret (01a07ad2, global).
#
# HVORFOR EN SPÆRRE OG IKKE EN SÆTNING I EN PLAN: `claude -p` er den KORTESTE
# vej fra «appen er ikke sandkasset, så den må starte claude». F263's plan pegede
# selv den vej i sin første udgave uden at opdage det. En regel der kun står
# skrevet, findes ikke den dag nogen har travlt.
#
# OG DEN BETALTE VEJ FINDES LOVLIGT I SAMME REPO — apps/server/src/services/
# claude.ts kalder `claude -p` med vilje i sky-motoren, hvor det ER betalt
# arbejde man har valgt. Derfor kan spærren ikke være «forbyd ordet i repoet».
# Den dækker præcis den lokale sti, og siger det.
set -euo pipefail
cd "$(dirname "$0")/.."

# Stier hvor den betalte vej ALDRIG må optræde.
STIER=("Sources/TrailAmbient")

# Mønstre, hver med en forklaring der kommer med i fejlen — en spærre der bare
# siger «fundet mønster 3» sender den næste læser på arbejde vi allerede har gjort.
MOENSTRE=(
  'claude[[:space:]]\+-p|`claude -p` afregnes mod API-et, ikke mod abonnementet'
  'claude[[:space:]]\+--print|`--print` er samme betalte vej som -p'
  'spawnClaude|spawnClaude er sky-motorens BETALTE kald — den må ikke kopieres herned'
)

FUND=0
for sti in "${STIER[@]}"; do
  [ -d "$sti" ] || continue
  for par in "${MOENSTRE[@]}"; do
    m="${par%%|*}"; hvorfor="${par#*|}"
    # Kommentarer tælles IKKE som brug: denne fils egen forklaring, og enhver
    # kommentar der advarer mod mønsteret, ville ellers gøre spærren rød på sig
    # selv. Samme fælde som i F262.2's prøve, hvor JSDoc'en om fejlen udløste
    # prøven om fejlen.
    if grep -RIn --include='*.swift' -e "$m" "$sti" 2>/dev/null \
       | grep -v '^\s*[^:]*:[0-9]*:\s*//' \
       | grep -v '^\s*[^:]*:[0-9]*:\s*\*' > /tmp/guard-hit.txt; then
      echo "[guard] FORBUDT i $sti: $m"
      echo "        $hvorfor"
      sed 's/^/        /' /tmp/guard-hit.txt
      FUND=1
    fi
  done
done

if [ "$FUND" -eq 1 ]; then
  echo ""
  echo "[guard] Den lokale kompilering skal køre i en INTERAKTIV Max-session."
  echo "        Kan ingen session startes, skal jobbet BLIVE LIGGENDE til leasen"
  echo "        udløber, så skyen tager det synligt (F263.5) — aldrig en -p-fallback."
  exit 1
fi

# NEGATIV KONTROL, kørt hver gang: spærren skal kunne FINDE mønsteret.
# Uden den ville en knækket grep (forkert flag, tom STIER, en typo i mønsteret)
# være grøn for evigt — og en spærre der ikke kan blive rød er ikke en spærre,
# den er en linje i en logfil.
KONTROL="$(mktemp -d)/kontrol.swift"
printf 'let x = "claude -p demo"\n' > "$KONTROL"
if grep -Iq -e 'claude[[:space:]]\+-p' "$KONTROL"; then
  echo "[guard] ren — og kontrollen bekræfter at mønsteret KAN findes"
else
  echo "[guard] FEJL: spærren kan ikke finde sit eget mønster i en kendt-dårlig fil."
  echo "        Den ville være grøn uanset hvad kildekoden indeholdt. Ret spærren."
  exit 1
fi
rm -rf "$(dirname "$KONTROL")"
