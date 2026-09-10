# F267 — Lad databasen finde de nærmeste vektorer

**Status:** klar · **Prioritet:** høj

> Christian, 9.–10. september 2026: *«Er alternativet ikke at søgninger foretages op mod databasen og ikke engine?»* og efter målingen: *«hvis ja så er cache stadig fallback»*.

## Det korte svar han bad om

**Ja, databasen er vektor-native.** Målt på vores egen libSQL-klient 9/9:

```
vector32 · vector16 · vector8 · vector1bit · vector64 · vectorb16
vector_distance_cos · vector_distance_l2 · vector_extract
```

**Hurtigere? Nej, ikke mærkbart på en VARM cache.** En søgning er 0,55 s i dag, og vektor-matematikken er millisekunder af det — 11.017 × 1024 flydende tal er ~11 mio. operationer. Tiden går til ordmatch og netværk. **At love hastighed her ville være usandt.**

**Bedre? Ja — tre andre steder, og de er dem der betyder noget ved 30 kunder:**

| | I dag | Med DB-søgning |
|---|---|---|
| Første søgning efter opstart | 0,63 s (kræver opvarmning, F265.12) | ingen opvarmning nødvendig |
| Hukommelse | 200 MB loft, koldeste Trail smides ud | databasen er ligeglad |
| 30 kunder med store Trails | passer ikke i RAM | skalerer |
| Netværk pr. kold søgning | 44 MB op til motoren | top-K rækker ned |

Og den fjerner hele den fejlklasse 9/9 gik med: cachen, invalideringen, de to døre, loftet, udsmidningen. F265.9, F265.10 og F265.12 findes alle sammen kun fordi vektorerne bor i motoren.

## Det der IKKE er verificeret

**Prod-serveren (sqld på trail-db-001) er ikke målt.** Funktionerne findes i klienten; om den kørende sqld-udgave bærer dem er et ÅBENT SPØRGSMÅL, og det er F267.1's første kriterium. En plan bygget på en klient-måling og udgivet som en server-sandhed er præcis den fejlform dette repo har brugt en hel dag på at fjerne.

Desuden uafklaret: har den udgave et vektor-INDEKS (`vector_top_k`), eller er `vector_distance_cos` en fuld kolonne-scanning server-side? Forskellen afgør om gevinsten er «mindre netværk» eller også «mindre arbejde». Begge er bedre end i dag; kun den ene er en størrelsesorden.

## Cachen bliver FALLBACK, ikke slettet

Ejerens egen betingelse, og den er rigtig af to grunde ud over forsigtighed:

1. En DB-udrulning bliver ikke et enten-eller. Fejler DB-vejen — gammel sqld, manglende funktion, netværk — falder søgningen tilbage til den vej der beviseligt virker i dag.
2. Fallbacket er mÅLESTOKKEN. De to veje kan køre mod samme forespørgsel og sammenlignes række for række, så «DB-vejen giver samme svar» er en måling frem for en påstand. Uden den gamle vej er der intet at sammenligne med.

**Slet ALDRIG cachen før DB-vejen har bevist samme resultat på rigtige data.** Det er husets «ingen naken cutover»-regel, og her er den ekstra vigtig: en tilnærmelse der giver 9 af 10 rigtige træf ser ud som om den virker.

## Scope

**F267.1** — mål prod-serveren: bærer sqld vektor-funktionerne, og findes der et indeks?
**F267.2** — vektor-søgning i SQL bag et flag, cachen som fallback, resultaterne sammenlignet række for række
**F267.3** — mål og beslut: bliver cachen stående, eller kan loftet fjernes?

### Non-goals

- **Ikke at fjerne cachen i dette epic.** Den er fallback og målestok.
- **Ikke at skifte embedding-model.** `mistral-embed`, 1024 dimensioner, EU-bundet med en vagt (F265.11). Urørt.
- **Ikke en migration af de eksisterende vektorer.** De ligger allerede i `chunk_embeddings` som blobs; spørgsmålet er kun hvem der REGNER på dem.

## Reuse

Discovery slået op for «vector», «embedding», «similarity search»: `@broberg/ai-sdk` ejer selve embedding-KALDET og bruges allerede (F265.11). Den ejer ikke lagring eller nærhedssøgning, og bør ikke — det er bundet til Trails egen SQL og datamodel. Intet at genbruge, intet gap at melde.

## Rollout

Bag et flag pr. videnbase, som hybrid-søgningen selv (F254.2). Tænd på ÉN Trail først — `buddy-sessions`, den største og vores egen — og sammenlign række for række mod cache-vejen før nogen kunde-Trail tændes.
