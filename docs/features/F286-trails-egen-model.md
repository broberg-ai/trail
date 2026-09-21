# F286 — Trails egen model til klassificering og ingest

**Grundlag:** Christians `TRAIL-LOCAL-MODEL-PLAN.md`, 21. september 2026.
**Denne plan:** samme mål, omskrevet efter at have målt hvad der faktisk findes.

---

## Åbne spørgsmål — læs først

Intet blokerer start. Tre ting står åbne:

1. **Hvilket emne bliver den nye store hjerne?** Ejeren har selv rejst det, og
   det er den hurtigste vej ud af compile-modellens datamangel. Kriterierne
   står under «Datagrundlaget». Ikke valgt endnu — og den haster ikke, for
   klassifikatoren bruger den ikke.
2. **Må Ubuntu-maskinen bære et vedvarende job?** Den kører allerede en
   buddy-edge med `camera9`-sessionen. At SERVERE klassifikatoren er let (se
   afsnit 4); at TRÆNE natten igennem dér er en ny belastning på en maskine
   der bærer en levende cc-session. Ejerens beslutning, ikke vores. Med
   arbejdsdelingen nedenfor er spørgsmålet dog næsten bortfaldet: vi træner
   ikke dér.
3. **Hvor meget disk må compile-modellen få?** Mindre presserende nu — se
   afsnit 4.

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

## 4. Hardware — to maskiner, og de laver ikke det samme

**RETTELSE, 21. september 2026.** Denne plan sagde først at Ubuntu-maskinen var
ude af billedet, at den havde 8 GB og kun CPU, og at «der er ikke andet jern».
**Tre af de fire påstande var forkerte.** Jeg ledte på `192.168.1.92`, hvor der
intet er, konkluderede «kan ikke nås», og planlagde videre på et tal ejeren
havde husket forkert. buddy fandt den rigtige adresse; jeg har efterprøvet hver
linje selv over Tailscale.

```
                    M1 (Mac)          cb-ubuntu
CPU                 Apple M1          i7-6600U @2.6GHz, 2 fysiske kerner (4 tråde), 2016
Acceleration        MLX (GPU)         INGEN — avx2, ikke avx512, ingen CUDA
RAM                 16 GB             14 GB (9 GB ledig med buddy-edge + camera9 kørende)
Fri disk            19 GB             112 GB af 233
Tilgængelig         når den er vågen  35 dages oppetid, agent-adgang uden at ejeren sidder der
OS / Python         macOS             Ubuntu 26.04 LTS · Python 3.14.4
Adresse             —                 cb@100.65.39.89 (Tailscale) · 192.168.1.73 (LAN)
```

**ARBEJDSDELINGEN FØLGER AF TALLENE — det er buddys pointe, og den er rigtig:
hvor en model TRÆNES og hvor den KØRER behøver ikke være samme maskine.**

- **Træning på M1.** MLX bruger Apple-GPU'en. En 2016-bærbar-CPU med to
  fysiske kerner kan godt træne en lille encoder, men den er langsom, og den
  deler maskine med en levende cc-session.
- **Servering på cb-ubuntu.** En klassifikator på 100–300 MB svarer på
  millisekunder på CPU, og maskinen har 35 dages oppetid og er agent-nåelig
  uden at ejeren sidder ved den. Det er dét en model i drift skal kunne.
- **Datasæt og checkpoints på cb-ubuntu.** 112 GB mod M1'erens 19. Det
  disk-pres planen først var bekymret for, findes ikke dér — og en fuld disk på
  M1 har taget produktionen ned før (F212).

Så planens ord om at «frigøre Mac'en» holder alligevel — bare kun for den
halvdel der kører i drift. Træningen bliver liggende.

**Compile-modellen kan IKKE serveres på cb-ubuntu.** CPU-only på en 2016-CPU
til en 4B generativ model er for langsomt til noget brugbart, også til en
natlig kø. Den bliver på M1 indtil der er andet jern.

**En ting der er ejerens:** et vedvarende træningsjob på cb-ubuntu ville lægge
sig oven på den buddy-edge der bærer `camera9`. Med arbejdsdelingen ovenfor
træner vi ikke dér — men beslutningen er hans, ikke vores, hvis det bliver
aktuelt.

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
produktionen på al ny ingest — serveret fra cb-ubuntu. Resultaterne
sammenlignes automatisk; kun produktionens bruges. Uenigheds-andelen er tallet
der viser fremskridt.

**Senere (ikke i denne runde):** compile-modellen (planens F3), kaskade,
kontinuerlig træning. De venter på datagrundlaget.

## 6. Non-goals

- **Ingen embeddings, ingen vektorsøgning.** Det her er en klassifikator med et
  klassifikationshoved. Trails «ingen RAG»-princip holder kun så længe det er
  sandt, og «vi træner jo alligevel en model» er præcis den formulering der
  ville lukke det ind ad bagdøren.
- **Ingen bake-off mellem tre modelfamilier.** Planen nævner Qwen3.5, Gemma 4 og
  Ministral 3. Tid rækker ikke til tre. Vælg én, mål den, skift kun ved
  dokumenteret fejl.
- **Ingen ny målestok.** `apps/model-lab` er den.
- **Ingen kundedata ud af huset.** Tilladelsen til Sanne-data gælder træning på
  eget jern — M1 og cb-ubuntu er begge eget jern.
- **Ingen udskiftning af den kørende pipeline i denne runde.** Skyggetilstand
  kun. Kaskaden er en senere beslutning på målte tal.
- **Ingen træning på cb-ubuntu.** Den serverer. Se afsnit 4.

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
- **buddy** ejer adgangen til cb-ubuntu (buddy-edge kører der). Spørg dem frem
  for at hånd-rulle en ny vej ind på maskinen.

Bliver klassifikatoren brugbar for andre repoer, er den rigtige vej at løfte den
til `components` som en `@broberg/*`-pakke — ikke at kopiere mappen.

## 9. Succeskriterier

| Mål | Krav |
|---|---|
| Klassifikation | Mindst på niveau med baseline på golden-sættet |
| Uenighed i skyggetilstand | Faldende, målt uge for uge |
| Svartid i drift | Målt på cb-ubuntu, ikke på M1 — det er dér den kører |
| Pris pr. klassifikation | 0 kr. |
| Datagrundlag | Målbart på kommando, ikke talt i hånden |

Compile-modellens kriterier (≥90 % enighed, 100 % skemagyldighed) står uforandret
fra ejerens plan, men de hører til en senere runde.

## 10. Lektien fra denne plans egen rettelse

Jeg skrev «Ubuntu er ude» og «der er ikke andet jern» ud fra ét mislykket
ping mod en adresse der var forkert. Det var en konklusion, ikke en måling — og
den var på vej til at binde hele epicen til én maskine med 19 GB fri disk.

Det der fandt fejlen var at spørge nogen der kunne nå maskinen, ikke at tænke
skarpere. **En «kan ikke nås» er et udsagn om MIN adgang, ikke om maskinen.**
De to ligner hinanden lige indtil nogen anden prøver.
