# F286 — Trails egen model til klassificering og ingest

**Grundlag:** Christians `TRAIL-LOCAL-MODEL-PLAN.md`, 21. september 2026.
**Denne plan:** samme mål, omskrevet efter at have målt hvad der faktisk findes.

---

## Åbne spørgsmål — læs først

Intet blokerer start. To ting står åbne og påvirker F3, ikke F2:

1. **Hvilket emne bliver den nye store hjerne?** Ejeren har selv rejst det, og
   det er den hurtigste vej ud af compile-modellens datamangel. Kriterierne
   står under «Datagrundlaget» nedenfor. Ikke valgt endnu.
2. **Hvor meget disk kan compile-modellen få?** 19 GB fri i alt i dag.
   Klassifikatoren er ligeglad; compile-modellen skal have et tal.

---

## 1. Hvad vi laver

Vi træner ikke en model fra bunden. Vi **destillerer**: en lille open
source-model lærer at gøre præcis det, de store modeller gør for Trail i dag.

To opgaver, to modeltyper, **og de er ikke lige modne**:

| | Klassifikator | Compile-model |
|---|---|---|
| Opgave | kildetype, routing, emne, Neuron-type, kant-type, «skal det ind» | kilde ind → Neurons + kanter ud som JSON |
| Modeltype | encoder, 100–300M, klassifikationshoved | generativ, 1,7–4B, LoRA via MLX |
| Træningsdata i dag | **~7.700 mærkede neuroner** | **~282 kilde→facit-par** |
| Status | **kan bygges nu** | **datasulten** |

Ejerens ordre 21/9: klassifikatoren først.

## 2. Datagrundlaget — målt, ikke antaget

Planen sagde at Trail «allerede ligger inde med et færdigt træningssæt». Talt i
produktionen 21. september 2026:

```
brain                   kilder  neuroner
sanne-andersen              82       239
trail-research              80       100
broberg-ai                  70       247
agent-memory                40        87
claude-code                  5        29
trail-development            2        20
llm-technical-research       3        15
                          ----      ----
I ALT                     ~282      ~737
```

**To store brains tæller ikke med, og det er vigtigt:** `buddy-sessions` (5.679
neuroner) og `cb-m1` (1.287) har **2 kilder hver**. Deres neuroner er skrevet
direkte af agenter gennem `trail_save` — de er ikke kompileret fra et dokument,
og de er derfor ikke kilde→facit-par. De er glimrende **klassifikator**-data og
ubrugelige som **compile**-data.

**Konsekvensen er skarp:** planens F0 beder om et golden-sæt på 300–500
eksempler der *aldrig* bruges til træning. På kilde-niveau er det større end
hele grundlaget. Regner man pr. (kilde, neuron)-par — 737 — æder facit-sættet
stadig omkring halvdelen.

### Den nye store hjerne

Ejeren har selv foreslået at bygge en stor hjerne som træningsmateriale. Det er
den hurtigste vej: 300–500 nye dokumenter ville fordoble til tredoble
compile-grundlaget på én gang. Men **størrelsen er ikke det der afgør værdien**:

- **Variation slår volumen.** 500 hjemmesider lærer modellen mindre end 100
  dokumenter fordelt på PDF, webside, referat, rapport og note. Klassifikatoren
  skal netop kende forskel på kildetyper.
- **Kurateringen er signalet.** Godkendes alt hvad pipelinen foreslår, lærer den
  nye model at efterligne den nuværende — inklusive dens fejl. Værdien opstår
  hvor ejeren **retter**: splitter en for bred neuron, ændrer en type, fjerner
  en forkert kant, afviser noget. 150 kuraterede dokumenter slår 500
  gennemklikkede.
- **Begge sprog**, da dansk og engelsk er valgt.
- **Materiale vi selv må bruge.** Ophavsretsbeskyttet materiale arver sit
  problem til træningssættet.
- **Et emne ejeren selv kan bedømme**, ellers bliver kurateringen gætteri.

## 3. Hvad der allerede findes — genbrug før vi bygger

### `apps/model-lab` ER baseline-harnesset

Planens F0 vil bygge en målestok. Den findes: `apps/model-lab` plus
`apps/server/src/services/model-eval/runner.ts` (F202) kører den rigtige
ingest-pipeline mod en engangs-base og scorer resultatet.

Dens design-princip er ordret det vi har brug for:

> *«Parity is guaranteed by calling the REAL backend classes (MistralBackend /
> OpenRouterBackend) — NOT a re-implemented tool loop.»*

En ny harness ville kunne drive fra produktionen; denne kan ikke. Og
`backendFor()` i runneren er nøjagtig dét sted den lokale model senere kobles
ind som en tredje backend — så F4's integration og F0's måling er det samme
kodested, ikke to.

**Det sparer en hel fase, og det fjerner en risiko:** vi måler mod den pipeline
der faktisk kører, ikke mod vores gengivelse af den.

## 4. Hardware — M1 alene

Ejeren, 21/9: *«Du må nøjes med M1 indtil videre.»* Ubuntu-serveren er ude af
planen (8 GB, kun CPU).

```
RAM        16 GB     planens absolutte minimum for 4-bit LoRA på 4B
Fri disk   19 GB     DEN STRAMME RESSOURCE
```

**Disken, ikke hukommelsen, er grænsen.** Modelvægte, checkpoint-serier og
datasæt-versioner skal dele 19 GB. Klassifikatoren (100–300 MB) er ubekymret.
Compile-modellen skal have en pladsplan, og hver træningskørsel en oprydning —
en fuld disk på denne maskine har taget produktionen ned før (F212).

Og planens ord om at «frigøre Mac'en» bortfalder: der er ikke andet jern.

## 5. Faser

**F286.1 — Dataudtræk, gentageligt.** Et script der tæller og eksporterer
(kilde → kuraterede Neurons + kanter) pr. brain. Tallene ovenfor er målt én gang
i hånden; F6's løbende træning kræver at de kan måles igen på kommando.
Versioneret datasæt, deterministisk, kan genkøres.

**F286.2 — Etiketter og golden-sæt.** De præcise klassifikations-kategorier
defineres, og et golden-sæt udtages som **aldrig** trænes på. For
klassifikatoren er 300–500 realistisk; for compile-modellen skrives det ærligt
hvor lidt der er tilbage.

**F286.3 — Baseline.** Kør `apps/model-lab` mod golden-sættet. Tallene i
plan-doc'en, før første træning.

**F286.4 — Klassifikatoren.** Træn på M1. Mål præcision pr. kategori mod
golden-sættet og mod baseline.

**F286.5 — Skyggetilstand.** Den lokale klassifikator kører ved siden af
produktionen på al ny ingest. Resultaterne sammenlignes automatisk; kun
produktionens bruges. Uenigheds-andelen er tallet der viser fremskridt.

**Senere (ikke i denne runde):** compile-modellen (planens F3), kaskade,
kontinuerlig træning. De venter på datagrundlaget.

## 6. Non-goals

- **Ingen embeddings, ingen vektorsøgning.** Det her er en klassifikator med et
  klassifikationshoved. Trails «ingen RAG»-princip holder kun så længe det er
  sandt, og «vi træner jo alligevel en model» er præcis den formulering der
  ville lukke det ind ad bagdøren.
- **Ingen bake-off mellem tre modelfamilier.** Planen nævner Qwen3.5, Gemma 4 og
  Ministral 3. Disk og tid rækker ikke til tre. Vælg én, mål den, skift kun ved
  dokumenteret fejl.
- **Ingen ny målestok.** `apps/model-lab` er den.
- **Ingen kundedata ud af huset.** Tilladelsen til Sanne-data gælder træning på
  eget jern.
- **Ingen udskiftning af den kørende pipeline i denne runde.** Skyggetilstand
  kun. Kaskaden er en senere beslutning på målte tal.

## 7. Hvor det bor

`apps/trail-model/`, som `apps/ambient-capture`.

**Hvorfor `apps/` og ikke `packages/`:** intet andet importerer den. Motoren
taler med modellen over HTTP gennem `@broberg/ai-sdk` (planens F4), præcis som
`apps/model-lab` er et værktøj og ikke et bibliotek. `packages/` er for kode
andre pakker importerer.

**Todelt, som Ambient er Swift udenpå og TypeScript indeni:**

```
apps/trail-model/
  src/          TypeScript — dataudtræk, evaluering, sammenligning, integration
  training/     Python — KUN selve træningen (MLX findes ikke i andet)
```

## 8. Reuse

Discovery-tjek 21/9 2026 på *model*, *training*, *classifier*, *ml*.

- **Intet `@broberg/*` rører modeltræning.** Fladen findes ikke i flåden.
- **`@broberg/ai-sdk` ER integrationspunktet** og skal bruges: planens F4 siger
  at den lokale model tilføjes som provider `local`, så ingen app taler direkte
  med modellen. Husreglen om at alle LLM-kald går gennem SDK'et gælder også en
  model vi selv har trænet — ellers har vi lavet netop den rå
  provider-integration reglen findes imod.
- **`apps/model-lab` (F202)** — genbruges som baseline og som indkoblingspunkt.
  Se afsnit 3.
- **F149 (pluggable ingest backends)** — den lokale model bliver en
  `IngestBackend` som `MistralBackend` og `OpenRouterBackend`. Sømmen findes.

Bliver klassifikatoren brugbar for andre repoer, er den rigtige vej at løfte den
til `components` som en `@broberg/*`-pakke — ikke at kopiere mappen.

## 9. Succeskriterier

| Mål | Krav |
|---|---|
| Klassifikation | Mindst på niveau med baseline på golden-sættet |
| Uenighed i skyggetilstand | Faldende, målt uge for uge |
| Pris pr. klassifikation | 0 kr. |
| Datagrundlag | Målbart på kommando, ikke tællet i hånden |

Compile-modellens kriterier (≥90 % enighed, 100 % skemagyldighed) står uforandret
fra ejerens plan, men de hører til en senere runde.
