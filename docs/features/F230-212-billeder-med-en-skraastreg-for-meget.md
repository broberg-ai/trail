# F230 — 212 af Sannes billeder kan ikke vises: én skråstreg for meget

**Kort:** trail-F230 · story · high

## Fundet ved et tilfælde, og det er pointen

Entropi-proben til F229 skulle tælle ensfarvede billeder. Den kunne ikke hente
234 af Sannes 1.557 — 212 af dem med et rent **404**.

**Proben havde tre udfald og ikke to**, så «kunne ikke hentes» ikke kunne
forveksles med «er ensfarvet». Havde den haft to, var de 212 blevet talt som
ensfarvede flader, entropi-porten havde fået æren for at fjerne dem, og
sandheden — at billederne findes og bare ikke kan vises — var aldrig kommet
frem. Fejlen ville have set ud som en succes.

## Hvad der er galt

Målt: **212 rækker har et `filename` der starter med en skråstreg.**

```
normale:   page-14-img-1.png
de brudte: /page-1-img-11.png
```

Antallet er nøjagtigt det samme som antallet af 404'ere — 212 = 212, ikke
«omtrent». URL'en bliver `/api/v1/documents/<id>/images//page-1-img-11.png`
med et **tomt sti-led**, og ruten matcher ikke. Billedet ligger på disken; det
kan bare ikke nås.

**Konsekvens for brugeren:** hvert syvende billede i Sannes Trail er et brudt
link i Neuron-læseren og i billed-galleriet.

## Rodårsagen — en skråstreg der lægges til uanset

`LocalStorage.list()` sammensætter altid `${prefix}/${relPath}`, og
F161-backfillen kalder den med et præfiks der **allerede ender på skråstreg**:

```ts
const prefix = `${tenantId}/${kbId}/${docId}/images/`;   // ← ender på /
const keys   = await storage.list(prefix);               // → ".../images//page-1-img-11.png"
const filename = key.slice(prefix.length);               // → "/page-1-img-11.png"
```

Begge halvdele er «rigtige» hver for sig. Det er samlingen der er gal, og på
disken er den usynlig: POSIX slår dobbelte skråstreger sammen, så filen blev
fundet, læst, målt og gemt uden en eneste fejl. Først HTTP-laget er striks nok
til at se forskel — og der er det for sent til at forklare hvorfor.

## Scope

**I scope:**

1. **Rodårsagen:** `LocalStorage.list()` må aldrig udsende en dobbelt
   skråstreg, uanset om kalderen giver præfiks med eller uden.
2. **Data-reparationen:** de 212 eksisterende rækker rettes — `filename` og
   `storagePath` normaliseres. Ingen bytes flyttes; filerne ligger allerede
   rigtigt.

**Non-goals:**
- Vi rører ikke selve backfill-logikken ud over kaldet. Den er rigtig når
  `list()` er det.
- Ingen re-ingest. Billederne findes; det er kun deres adresse der er gal.

## Sådan bevises det

En prøve på `list()` med og uden afsluttende skråstreg skal give **samme svar**
— det er den ene påstand der ikke kan være sand i dag. Og reparationen tælles
før og efter: 212 → 0 brudte, og et af de rettede billeder skal kunne **hentes
over HTTP** bagefter. En rettelse der kun tæller rækker beviser ikke at
brugeren kan se billedet igen.

## Afhængigheder

Ingen. Rettelsen i `packages/storage` og en engangs-reparation.
