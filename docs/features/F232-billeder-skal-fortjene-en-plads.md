# F232 — et billede skal fortjene sin plads, og prøven må ikke stå i vejen

**Kort:** trail-F232 · epic · high

## Ejerens ord, og hvad de laver om

> *«så skal vi bare bruge pengene fornuftigt … ved at køre en kontrol om der er
> noget af værdi på billede inden det får lov at komme igennem. Det skal ikke
> være en blokkerende proces. Når Ingest og compilation er færdig kan et job
> begynde at kigge på billeder fra et temp lager og slette det der ikke er noget
> værd.»*

Tre krav, og de vender F229.1 på hovedet:

1. **Vurderingen er en RIGTIG vurdering**, ikke et gæt på størrelse eller
   variation. «Er der noget af værdi her?» må gerne koste en billig model —
   pengene skal bare bruges ét sted hvor de virker.
2. **Den må ikke blokere.** Ingest og kompilering skal være færdige og hurtige;
   billederne venter.
3. **Den kører bagefter, på et temp-lager, og må SLETTE.**

Og én ting bortfalder: **F229.3 (oprydnings-knappen) er aflyst.** Ejeren og
Sanne rydder selv op i det der allerede ligger der. Denne plan handler kun om
det der kommer ind fremover.

## Hvad der allerede står, og hvad der mangler

**Krogen findes.** Siden F165 kører billed-vision IKKE under ingest — den
køres som et baggrundsjob der sættes i gang når kompileringen er færdig
(`uploads.ts`, `queued vision-rerun job=…`). Så krav 2 er allerede opfyldt, og
det er værd at sige højt frem for at bygge det igen.

**Tre ting mangler:**

| | |
|---|---|
| **Temp-lageret** | Billeder skrives i dag direkte til Trailens rigtige lager og får en række med det samme. De ER i Trailen fra sekund ét. |
| **Retten til at slette** | Jobbet kan beskrive et billede og kalde det «dekorativt» — men det bliver liggende alligevel. |
| **Usynlighed mens de venter** | Et billede der venter på sin dom må ikke dukke op i galleriet eller i søgningen. |

## Målingen der afgør at det kan lade sig gøre

Bekymringen ved et temp-lager er om billed-URL'erne holder. Målt på Sannes
Trail, 88 dokumenter:

```
KILDER   med billed-links: 10 af 19
NEURONER med billed-links:  1 af 69
```

**Billed-URL'erne bor i KILDEN, ikke i den kompilerede viden.** Kun én Neuron ud
af 69 peger på et billede. Så et billede der venter i temp — og måske aldrig
kommer igennem — river ikke Neuronerne i stykker.

Kildens markdown peger på `/api/v1/documents/<id>/images/<fil>`, altså en
adresse der ikke røber hvor bytesene ligger. Flytningen fra temp til rigtigt
lager er derfor usynlig udefra — **forudsat at ruten slår stien op på rækken i
stedet for at regne den ud.** Det gør den ikke i dag, og det er derfor
F232.2 findes.

## Sådan kommer det til at hænge sammen

```
UPLOAD ─► udtræk ─► bytes i .../images-pending/   (temp)
                    række med triage='pending'
                    ── ingen vision, ingen OCR, intet penge brugt ──
        ─► kompilering færdig
        ─► JOB: triage
              1. entropi   (gratis, lokalt)   ensfarvet  → SLET
              2. billig vision + OCR (EU)     intet af værdi → SLET
              3. ellers                       flyt til .../images/, triage='kept'
```

**Trin 1 før trin 2 er hele besparelsen.** 296 af Sannes billeder er præcis
ensfarvede; de koster nul at fange og ville ellers hver især koste et
model-kald. Og målt: Mistral OCR **opfinder tekst** på en ensfarvet flade — så
trin 1 er også en korrekthedsspærre, ikke kun en sparepost.

**Hvad «af værdi» betyder, konkret:** vision svarer allerede «decorative» når
der intet er at beskrive (F163.2's `[QUALITY: low]`-markør). Er BÅDE
beskrivelsen tom OG OCR-teksten tom, er der intet af værdi. Begge tomme er
kravet — et billede uden motiv men med læsbar tekst er en scannet side, og den
skal beholdes.

## Stories

| | |
|---|---|
| **F232.1** | Temp-lager + `triage`-tilstand. Billeder venter usynligt; intet i galleri eller søgning. |
| **F232.2** | Ruten slår billedstien op på rækken i stedet for at regne den ud — forudsætningen for at flytte bytes. |
| **F232.3** | Triage-jobbet: entropi → billig vision/OCR → slet eller forfremme. |

## Hvad der IKKE ændrer sig

- **F226's pixelgrænse bliver hvor den er.** Den er en talsammenligning uden
  omkostning; at flytte den ind i et job ville gøre den langsommere uden at
  spare noget.
- **Fabrikations-gulvet i `ocrImage()` bliver.** Det er en korrekthedsspærre,
  ikke en præference, og den gælder uanset hvor OCR kaldes fra.
- **F229.1's entropi-funktion bliver** — den flytter bare fra ingest-stien ind i
  jobbet, hvor den nu er trin 1 i stedet for en port.

## Non-goals

- Ingen oprydning i eksisterende billeder. Ejeren gør det manuelt (aflyst F229.3).
- Ingen ny model-vælger. Vision og OCR kører på de EU-ruter der allerede er valgt.
- Vi rører ikke kompileringen. Jobbet starter når den er færdig; den venter aldrig.

## Prisen — MÅLT på et rigtigt kald, ikke regnet ud

```
vision (mistral-small-latest, EU)   707 ind / 123 ud   $0,000108
OCR    (mistral-ocr-latest,   EU)   pr. side           $0,002000
                                                       ─────────
pr. billede der når trin 2                             $0,002108
1.000 billeder                                         $2,11
```

**OCR er den dyre halvdel — 19 gange dyrere end billedbeskrivelsen.** Det er
værd at vide, fordi det er modsat af hvad man ville gætte, og fordi det er dét
tal en fremtidig besparelse skal angribe.

Og det rettede en fejl jeg selv havde skrevet en time forinden: at SDK'et ikke
kunne prissætte OCR, fordi `getModelPrice('mistral-ocr-latest')` giver
`undefined`. Sandt — og den forkerte slutning: adapteren prissætter **pr. side**,
ikke pr. token, så token-prislisten har med vilje ingen post. `usage.costUsd`
svarer $0,002. Havde kommentaren fået lov at stå, ville den næste læser tro at
OCR var gratis.

**Besparelsen ved trin 1 på Sannes korpus:** 296 af 1.557 billeder er
ensfarvede og når aldrig trin 2 — cirka $0,62 sparet. Beløbet er lille; **det
bærende argument er ikke pengene, men at OCR opfinder tekst på et tomt
billede.**
