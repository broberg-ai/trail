# F255 — Publikums-filteret kan slukkes af den kalder det findes for

> **Fundet 6. september 2026** mens jeg ledte efter et sted at hænge en
> måle-parameter for F254.3. Jeg læste `parseAudienceParam` for at se hvem der
> måtte sætte den, og svaret var: alle.

## Beviset, først

Samme bearer-nøgle, samme søgning, samme minut, mod produktion:

```
Mål: /neurons/heuristics/trail.md  (doc_bbd3987d-0f4, KB trail-research)
     — skjult for publikum 'tool' pr. design

  standard (ingen parameter)   → heuristik-dokument i svaret:  nej
  ?audience=tool               → heuristik-dokument i svaret:  nej
  ?audience=curator            → heuristik-dokument i svaret:  JA
```

De to første linjer er kontrollen: **filteret virker.** Det er ikke i stykker.
Den tredje linje er fejlen: **kalderen kan slå det fra.**

## Årsagen, i to linjer

```ts
// audience.ts
export function parseAudienceParam(raw) {
  if (AUDIENCE_VALUES.includes(raw)) return raw;   // ingen spørger HVEM der beder
  return null;
}

// search.ts
const audience = parseAudienceParam(c.req.query('audience'))
              ?? defaultAudienceForAuth(authType);
```

`defaultAudienceForAuth` er den funktion der kender autentificeringen — og den
kører kun når kalderen **ikke** har sagt noget. Så det ene sted der ved hvem du
er, bliver sprunget over præcis når du beder om mere end du må.

`??` er hele fejlen. Den læser som «brug standarden hvis intet er angivet», og
den BETYDER «kalderens ønske vinder over autentificeringen».

## Hvorfor det ikke er en teoretisk fejl

Rutens egen kommentar siger formålet ordret: *«External Bearer integrations
default to `tool` (heuristics + internal-tagged docs hidden).»* Det er en
grænse mellem «hvad kunden må se» og «hvad kuratoren må se» — ikke en
bekvemmelighed. Heuristikker er husets egne urå arbejdsnoter; `internal` er
tagget man sætter når en Neuron ikke skal ud.

Og det er den samme fejlform som resten af døgnet, nu i en spærre:
**en manglende værdi degraderer tavst til det mest generøse udfald.**
Ingen fejl, ingen log, intet der ser forkert ud — svaret er bare større.

## Reglen: må INDSNÆVRE, aldrig UDVIDE

Parameteren skal blive, for den har en ægte brug: en kurator i admin vil kunne
se **hvad en ekstern kalder ser** uden at logge ud og hente en nøgle. Det er en
indsnævring, og den er harmløs.

```
              ønsket: tool     ønsket: curator
  session     tool  (lovlig)   curator
  bearer      tool             tool   ← afvist eskalering
```

Den effektive værdi udregnes ÉT sted af en funktion der tager **både**
autentificeringen og ønsket. Det er forskellen fra en `if` i søgeruten: der er
flere ruter der læser parameteren, og en spærre der findes i én kopi pr.
kaldested er den der driver fra hinanden. Antallet af ruter tælles og skrives i
denne plan, så «jeg rettede den ene jeg fandt» ikke kan forveksles med «jeg
rettede dem alle».

## Forkastet — fjern parameteren helt

Det ville lukke hullet og fjerne en legitim funktion (se-som-ekstern), og det
ville gøre admin-UI'ets forhåndsvisning til noget man skal bygge på en anden
måde. En spærre der koster en rigtig funktion bliver før eller siden rullet
tilbage af en der ikke kender grunden.

## Forkastet — kræv en særlig scope på nøglen for at må bede om curator

Det flytter beslutningen til nøgle-udstedelsen og gør den usynlig på
kaldestedet. Og en `scope=all`-nøgle (som ejerens egen) ville så kunne gøre
det — hvilket er rigtigt for HAM og forkert som mekanisme, fordi nøglen så
afgør synligheden og ikke kanalen. Widget'en på et kundesite bærer også en
nøgle.

## Ikke-mål

- **Ingen ændring af hvad de tre publikums-værdier BETYDER.**
  `isVisibleToAudience` er uberørt og rigtig.
- **Ingen nøgle-rotation.** Der er intet der tyder på at hullet er brugt — og
  det kan ikke afgøres bagud, fordi et curator-svar ikke logges anderledes end
  et tool-svar. Det står her frem for at blive udeladt.
- **Ingen 4xx ved eskaleringsforsøg.** Anmodningen betjenes med den snævre
  visning. En fejl ville lække at der ER noget mere at se.

## Omfang — FEM kaldsteder, ikke ét

Talt op, ikke gættet. `grep -rn "parseAudienceParam" apps/ packages/`:

| fil | linje | hvad den betjener |
|---|---|---|
| `routes/search.ts` | 34 | søgningen — hvor fejlen blev fundet |
| `routes/retrieve.ts` | 114 | SDK'ens genfindingslag |
| `routes/chat.ts` | 185 | **Aidan** |
| `routes/images-search.ts` | 49 | billedsøgning |
| `routes/images-search.ts` | 379 | billed-kilder |

**`chat.ts` er den alvorligste.** De øvrige fire udleverer en LISTE en kalder så
selv skal læse. Chat-ruten fører publikummet videre ind i `retrieveContext`, så
et internt Neuron ikke bare optræder i et svar — det bliver *formuleret ind i*
det svar en besøgende på broberg.ai læser. Havde jeg kun rettet søgeruten, hvor
jeg fandt fejlen, ville den værste vej være blevet stående.

Det er hele grunden til at AC'et krævede en OPTÆLLING og ikke en rettelse: den
rute jeg fandt fejlen på, var den mindst farlige af de fem.

`routes/images.ts:78` kalder `defaultAudienceForAuth` direkte og læser **ingen**
parameter. Den kan derfor ikke eskaleres og er med vilje urørt.
