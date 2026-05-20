# Til Sanne — billeder i din interne chat på app.trailmem.com

## TL;DR

Du behøver intet at gøre. Login på **https://app.trailmem.com**, gå til
din Trail → Chat-fanen, stil et spørgsmål om visuelt indhold (fx
"Vis mig billeder af gule blomster", "Har du tegninger af menneskets
fod?"). Hvis dine kilder indeholder vision-beskrevne billeder der
matcher, viser admin nu et image-grid under svaret.

## Hvad ændrede sig (21. maj)

Tidligere returnerede chat'en kun tekst. Vi tilføjede:

1. **Image-FTS over vision-beskrivelser** — admin søger direkte i den
   alt-tekst som AI'en allerede har genereret for hvert billede i dit
   Billeder-panel (op til 8 hits sorteret på relevans pr query).
2. **Image-grid renderer under svaret** — klikbare thumbnails med
   alt-tekst som tooltip; click → fuld billede i ny tab.
3. **Audience-vælger** øverst i chat-panelet med tre valg:
   - **Curator** = din egen admin-view, billeder + wiki-links.
     **Default.**
   - **Tool** = sådan ville en downstream LLM-integration se det
     samme spørgsmål (billeder, ingen admin-paths). Brug den hvis du
     vil teste hvordan en ekstern AI-bot ville svare før du
     udleverer en bearer-key.
   - **Public** = sådan ser Eir-widgeten det fra dit website
     (tekst-only, INGEN billeder — by design for at holde Eir let +
     hurtig). Hvis du vil have billeder på Eir også, så ring til
     Christian — kræver en config-ændring.

## Sådan får du flest billeder med

Image-FTS kan kun matche på AI-genereret alt-tekst. Det betyder:

- **Tjek dit Billeder-panel** at billeder har beskrivelser
  ("Billedet viser..."). Hvis et billede mangler alt-tekst er det
  ikke søgbart.
- **Vision-quality-rating**: tommel ned på dårlige beskrivelser →
  systemet kan re-køre vision senere.
- **Slet billeder du ikke vil have findbare** via bulk-delete.

## Hvorfor Eir (din public chat på sanneandersen.dk) IKKE viser billeder

Eir er en tekst-only widget by design — den er optimeret til hurtig
respons + ingen risiko for at vise et billede der er ude af kontekst
for en patient-besøgende. Hvis vi senere vil tilføje billeder til
Eir er det en bevidst beslutning, ikke en bivirkning.

## Spørgsmål?

Skriv til Christian eller åbn en chat-feedback med tommel ned hvis
nogen image-match er forkert (det hjælper os justere FTS-relevansen).
