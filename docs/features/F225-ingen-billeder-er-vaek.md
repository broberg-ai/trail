# F225 — ingen billeder er væk

**Kort:** trail-F225 · epic · high

> Ejeren: *"Kør Sannes 311 manglende billeder"* — om advarslen F217 viser i
> Trail-listen. **Advarslen er falsk.** Hvert eneste af de 311 billeder ligger
> på disken og serveres korrekt.

## Målt på produktionsvolumenet, read-only

```
sanne-andersen/trail.db     1.557 billedrækker
   1.246  storage_path  t-sanne-andersen/…   filen findes
     311  storage_path  t-christian/…        filen findes IKKE på den sti

HTTP-probe af alle 1.557:  1.532 svarede OK · 0 gav 404 · 25 kunne ikke måles
```

**Nul billeder mangler.** Serverings-ruten *udregner* sin sti med
`imagePath(tenantId, kbId, docId, filename)`; størrelses-målingen *læser* den
gemte `storage_path`-kolonne. De to er uenige for præcis de 311 rækker hvis
præfiks er `t-christian/` — en tenant der hørte op med at eksistere ved
multi-tenant-opdelingen. Filerne ligger under `t-sanne-andersen/`.

Rækkerne bærer også en dobbelt skråstreg: `…/images//page-1-img-1.png`.

## broberg-ai er en ANDEN sag — og må ikke rettes på samme måde

```
741  rækker med t-christian/     og dens EGEN uploads-mappe er tom (4 KB)
644  af filerne findes på SANNES volumen  ← rækker for en KOPI af Sannes KB
 97  findes ingen steder
```

Den samme KB-id (`6aa52746-…`) står i begge tenants — en kopi efterladt af
opdelingen. **På tværs af begge tenants er 97 billeder reelt væk, ikke 1.052.**

## Hvorfor det ikke er kosmetisk — og hvorfor det ÆNDRER hvad rettelsen er

Kolonnen har rigtige forbrugere:

| fil | hvad den gør |
|---|---|
| `bootstrap/rerun-vision.ts:100` | `storage.get(row.storagePath)` → *"skip — no bytes at…"* |
| `services/jobs/handlers/vision-rerun.ts:96` | samme kolonne |
| `services/document-images.ts:57` | persist-stien |
| `routes/images.ts:402` | |

**En vision-genkørsel springer derfor stille alle 311 af Sannes billeder over**
og logger en advarsel ingen læser. At rette *kun* læseren (`kb-size`) ville
gøre tallet ærligt og lade billederne blive ved med at være usynlige for hvert
job. **Kolonnen er det der skal rettes.**

## Mit eget instrument var forkert TO gange før det var rigtigt

Det står her fordi tallene nåede ejeren.

```
første probe    "168 mangler"
samme probe igen "216 mangler"
```

Begge var artefakter: et `catch` talte en forbigående netværksfejl som en
manglende fil. Skrevet om med **tre tilstande** — findes · 404 · kunne ikke
måles — plus genforsøg blev svaret **0 manglende og 25 umålelige**.

> En probe der ikke kan skelne «væk» fra «jeg kunne ikke nå at kigge»,
> rapporterer den skræmmende af de to.

Fjerde forekomst på to døgn af samme form, og tredje gang instrumentet var
mit eget.

## Rettelsen

Skriv præfikset om på **sanne-andersen** — `t-christian/` → `t-sanne-andersen/`
— og normalisér den dobbelte skråstreg i samme kald, ellers er den rettede sti
stadig ikke den sti serverings-ruten udregner.

**Ikke** på broberg-ai: dens rækker peger på en kopi af Sannes KB hvis filer
ligger i en anden tenants volumen. Et præfiks-skift dér ville få rækker til at
påstå filer som den tenant ikke ejer.

**Det er en skrivning i en kundes levende database.** Den kører på ejerens
direkte ordre, efter et snapshot — aldrig som en sidegevinst ved en read-only
undersøgelse.

## Beviset er funktionelt, ikke kun et tal

At `imageMissingCount` bliver 0 er nemt at opnå og nemt at snyde med. Kortets
bærende acceptkriterium er derfor at **en vision-genkørsel finder bytes for et
billede der tidligere loggede «skip — no bytes at…»**. Det er den konsekvens
ejeren aldrig fik at se.

Og den negative kontrol går den anden vej: broberg-ais 97 reelt fraværende
billeder skal **stadig** rapporteres som manglende bagefter. Ellers har vi
dæmpet advarslen i stedet for at rette stierne.
