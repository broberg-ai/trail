# F268 — Ambient skriver kun til den Trail ejeren har valgt

**Status:** in progress · **Rejst af:** Christian, 10/9 2026 · **Alvor:** kritisk

## Hvad der skete

Christian åbnede sin kø i broberg.ai og fandt **536 ventende kandidater** der ikke
havde noget med broberg.ai at gøre: budgetnoter om FD Sundhed, godkendte
HelpDesk-mockups, en privat note om at lease et hus i Blokhus. broberg.ai er den
Trail hans hjemmesides chat svarer kunder fra. Hans ord:

> «Ambient capture er IKKE sat til at skulle lande i broberg.ai»

Han har ret, og det er værre end en forkert indstilling: **der fandtes ikke noget
valg at træffe.** Ambient havde aldrig haft en vælger.

## Målt (alt i dansk tid)

| | |
|---|---|
| ventende kandidater i broberg.ai | 536 — 535 `trail-ambient-capture` + 1 `lint` |
| relayet (gen)startet | 9/9 kl. 22:14 |
| første upload til broberg.ai | 9/9 kl. 22:17 |
| 518 uploadet på 29 minutter | 9/9 kl. 22:17–22:46 |
| de 518 var OPTAGET | 1/9 kl. 21:21 → 9/9 kl. 22:37 — ni dages arbejde |
| løbende siden | 17 stk. den 10/9 |

At de 518 blev sendt på 29 minutter, men optaget over ni dage, er hele nøglen:
det var ikke live-optagelse, det var **hele historikken sendt om igen**.

## Root cause — to fejl der skulle mødes

### 1. Relayet gættede sin videnbase

`packages/ambient-gate/src/relay.ts` — `grantedKb()` tog **det første id i
`trail.kbIds`**, den liste enhedsparringen skriver. Den læste aldrig et valg, for
der var intet valg at læse. Kommentaren i koden sagde det selv: *«first grant is
the v1 target»*. Rækkefølgen i en liste afgjorde hvor ni dages dikteringer røg hen.

Den 9/9 kl. 22:14 blev listen skrevet om, og broberg.ai stod først.

### 2. Relayet genafsendte hele loggen ved hver opstart

`let offset = 0` — hver start læste `focus.jsonl` fra byte 0 og sendte hvert
vindue igen. Mod den SAMME videnbase blev det fanget af motorens 409 på
`sourceUrl`, så ingen har nogensinde set det. **Mod en NY videnbase findes den
dubletspærre ikke** — og så blev én forkert indstilling til 518 noter.

### 3. (macOS-appen) Ingest-vinduets vælger flyttede ambient med sig

Den ENESTE videnbase-vælger i hele appen lå i Ingest-vinduet, og den skrev i
`trail.kbId` — præcis den nøgle ambient sendte på. At vælge en Trail at *lægge
filer i* flyttede altså også hver eneste diktering derhen. Efter F263.8 flyttede
vælgeren til `trail.kbId.<konto>`, og ambient blev ikke flyttet med — så den
læste en nøgle ingen længere skrev, og faldt tilbage til listens første.

## Fejlformen, sagt én gang

Et tilbagefald til «den første på listen» kan ikke skelne **«ejeren valgte
denne»** fra **«ingen har valgt noget»**. Et instrument der ikke kan skelne de to
rapporterer sin egen blindhed som et faktum. Her kostede det 535 arbejdsnoter i
en kundevendt Trail.

## Scope

**I scope**

- Ambient får sin EGEN nøgle, `trail.ambient.kbId`, adskilt fra Ingest-vinduets valg.
- Intet valgt → der sendes **ingenting**, og det siges. Ingen gæt, intet tilbagefald.
- Et valg der ikke længere er givet adgang til → også ingenting.
- En vælger i menulinjen, hvor «Skriver til:» før stod som en oplysning man ikke kunne gøre noget ved.
- Relayet starter ved **slutningen** af loggen. Historik kræver `--backfill`.
- Navne huskes pr. id, så en hentet navn ikke smider parringens øvrige navne væk.

**Non-goals**

- Deal/personal-routing over flere videnbaser (`routing.ts`, F201.7) — urørt.
- Enhedsparringen (F201) — urørt.
- Oprydning af de 536 ventende kandidater — separat beslutning, ejerens.
- Auto-godkendelses-tærsklen — et andet spor.

## Arkitektur

```
macOS-appen (Swift)                    relayet (Bun)
  menulinje → AmbientKbStore.valgt       grantedKb() → vaelgKb()
         ↓                                      ↓
   trail.ambient.kbId  ←── samme nøgle ──→  defaults read
         ↓                                      ↓
   TrailClient.kbId                       POST /queue/candidates
```

Én nøgle, ét valg, to læsere. Ingen af dem gætter.

## Afhængigheder

Ingen nye. Rører `apps/ambient-capture` (Swift) og `packages/ambient-gate` (Bun).

## Reuse

Discovery-tjek kørt for «ambient», «capture routing», «kb selection»: der findes
intet `@broberg/*`-modul for valg af destination i en ambient-optager. Det er
Trail-specifikt (nøglerne er Trails egne enhedsparrings-defaults), så det bygges
her. Ingen rå leverandør-integration tilføjet.

## Udrulning

1. Kode + prøver (mutation-bevist røde på den gamle adfærd).
2. `trail.ambient.kbId` sat til CB-M1 på Christians Mac, læst tilbage.
3. Relayet skal genstartes for at køre den nye kode — **kræver Christians ord**.
4. macOS-appen skal bygges og genstartes for at menulinje-vælgeren kommer frem.

## Hvad der IKKE er verificeret

- Menulinje-vælgeren er bygget og typecheck'et, men **ikke set på skærmen** —
  appen på hans Mac kører stadig den gamle binær.
- Relayet kører fortsat den gamle kode indtil det genstartes.
