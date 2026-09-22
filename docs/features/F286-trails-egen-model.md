# F286 — Trail Scout: Trails egen model til klassificering og ingest

**Grundlag:** Christians `TRAIL-LOCAL-MODEL-PLAN.md`, 21. september 2026.
**Denne plan:** samme mål, omskrevet efter at have målt hvad der faktisk findes.
**Navnet:** **Trail Scout**, versioneret Scout 1.0, 1.1 osv. Christians valg,
22. september 2026, ordret: «Som vi har Trail Ambient så kommer modellen til at
hedde Trail Scout eller bare Scout 1.0 og 1.1 etc. scout går foran på stien og
spejder». Søskende til Trail Ambient, og samme navnelogik — ét ord der siger
hvad den GØR, ikke hvad den er bygget af. Koden bor derfor i `apps/scout/` og
pakken hedder `@trail/scout` (F286.6).

Plan-doc'ens FILNAVN er med vilje ikke ændret med. Seks kort linker til
`F286-trails-egen-model.md`, og et filnavneskift for kosmetikkens skyld river
de links over — navnet står i titlen, hvor en læser ser det.

---

## Åbne spørgsmål — læs først

**Intet blokerer længere. Nr. 4 er BESVARET — se afsnit 12.** Fire ting står åbne:

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
4. ~~**Hvad ER klassifikatorens baseline?**~~ **BESVARET 22/9.** Christian:
   «Baseline skal selvfølgelig måles op mod den Mistral model vi kører med i
   dag.» Målt til `mistral-small-latest`, 42,1 % samlet over 444 eksempler —
   hele målingen står i afsnit 12. Samme svars FØRSTE halvdel («brug local
   ingest på $0») hører til compile-modellens datamangel, ikke til baseline:
   local ingest kører claude-sonnet-4-6, så en måling med den ville sammenligne
   Scout med en model vi ikke betaler for.
5. **Skal arkiverede kilder med i kildetype-opgaven?** Billed- og lydkilder
   FINDES, men hver eneste er arkiveret, så de to kategorier har nul aktive
   eksempler. For netop den opgave er en arkiveret kilde stadig et gyldigt
   eksempel — for en Neuron er den det modsatte. F286.4's valg; tal og
   argument i afsnit 11.

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

**RETTELSE, 22. september 2026.** Dette afsnit stod med tal jeg havde talt i
hånden: «~282 kilder, ~737 neuroner». F286.1's script målte dem, og det VÆLTEDE
grundlaget. Tallene nedenfor kommer fra
`bun run apps/scout/src/export-dataset.ts` og kan køres igen.

```
brain                       kilder  neuroner  kompileret   par
agent-memory                    40        87          70    33
broberg-ai                      70       247          16     3   skrevet direkte
cb-m1                            2      1288           2     2   skrevet direkte
development-tester               6        69           2     1   skrevet direkte
trail-research                  80       100           0     0   skrevet direkte
sanne-andersen                  82       239           0     0   skrevet direkte
buddy-sessions                   2      5679           0     0   skrevet direkte
buddy-research                   6        27           0     0
claude-code                      5        29           0     0
zoneterapi-demo                  1        31           0     0
trail-development                2        20           0     0
llm-technical-research           3        15           0     0
helpdesk-dev                     1         4           0     0
                              ----      ----        ----  ----
I ALT                          300      7835          92    39
```

**«Par» er den eneste søjle der betyder noget for compile-modellen**, og den
siger 39 — ikke 282. Kilderne findes, Neuronerne findes, men **sporet mellem
dem findes næsten ikke**: kun 33 af parrene ligger i en hjerne der overhovedet
er kompileret frem for skrevet.

**Årsagen er målt, og det er en dato.** Sporet kilde → Neuron går gennem
kø-kandidatens peger tilbage til kildedokumentet. Den gamle ingest-pipeline
satte ikke den peger. `agent-memory` er bygget 19. september med den nye
pipeline og er sporbar hele vejen (70 af 87 Neuroner); `trail-research` (april)
har 0 af 100, `sanne-andersen` (april–juni) 0 af 239. Indholdet er der.
Forbindelsen er ikke, og den kan ikke genskabes bagud.

**To store hjerner tæller stadig ikke med som compile-materiale:**
`buddy-sessions` (5.679 neuroner) og `cb-m1` (1.288) har **2 kilder hver**.
Deres neuroner er skrevet direkte af agenter gennem `trail_save` — de er ikke
kompileret fra et dokument. De er glimrende **klassifikator**-data og
ubrugelige som **compile**-data.

**Konsekvensen er skarpere end før målingen:** planens F0 beder om et golden-sæt
på 300–500 eksempler der *aldrig* bruges til træning. For compile-modellen er
der 39 par i alt. Facit-sættet er altså ti gange større end hele grundlaget —
og det er derfor klassifikatoren bygges først, og derfor en ny stor hjerne ikke
er en genvej men den ENESTE vej til compile-modellen.

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

### `apps/model-lab` er baseline-harnesset — for COMPILE-modellen, ikke for klassifikatoren

**RETTELSE, 22. september 2026, efter F286.2's måling.** Dette afsnit sagde uden
forbehold at planens F0 «ikke skal bygge en målestok; den skal køre den der er».
Det holder for compile-modellen og **ikke** for klassifikatoren.

`apps/model-lab` plus `apps/server/src/services/model-eval/runner.ts` (F202) kører
den rigtige ingest-pipeline mod en engangs-base og scorer resultatet. Design-
princippet er ordret det vi har brug for:

> *«Parity is guaranteed by calling the REAL backend classes (MistralBackend /
> OpenRouterBackend) — NOT a re-implemented tool loop.»*

**Men to ting er målt siden, og de flytter F286.3:**

1. **Harnessets eneste kvalitetsmål er `scoreRecall()`** (`recall.ts`): en
   substring-match af kilde-fakta inde i den kompilerede Neuron-tekst.
   `runIngestComparison()` tager ét helt dokument som `source: string` og kører
   hele compile-løkken. Der er intet sted der forudsiger en ETIKET og
   sammenligner den. Den måler compile, ikke klassifikation.
2. **Der findes ingen klassifikator i produktionen at måle op imod.** Søgt i hele
   `apps/server/src` og `packages/core/src`: nul selvstændige klassifikations-kald.
   Sti og kanttype vælges INDE I compile-prompten (`ingest.ts:582-596`), mens den
   store model skriver. Klassificering er en egenskab ved compile-løbet, ikke et
   trin man kan køre for sig.

**Constraintens bekymring er stadig rigtig** — en ny harness må ikke kunne drive
fra produktionen — men den kan ikke bide på denne opgave, for der er ingen
produktions-løkke at drive fra. `backendFor()` i runneren er fortsat dér
compile-modellen senere kobles ind; det er uændret.

**Hvad klassifikatorens baseline så er, er en ÅBEN BESLUTNING (spørgsmål 5).**
Forslaget står på F286.3-kortet: stil en sky-model de samme seks spørgsmål på
golden-sættet gennem `@broberg/ai-sdk` og notér præcision **pr. kategori**. Det er
metereret forbrug (444 kald, ~115k input-tokens), og derfor ejerens valg.

**Uanset hvad han vælger, står to ting fast:** baseline skal på skrift FØR første
træning, og den skal rapporteres pr. kategori — `cites` er 98 % af alle kanter, så
et samlet tal kan være højt alene fordi modellen altid svarer `cites`.

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

**F286.2 — Etiketter og golden-sæt. BYGGET 22/9.** Seks opgaver, alle med
kategorier udledt af produktionens egne værdier, og et golden-sæt på 444
eksempler der er holdt ude af træningen — bevist med et script der er set blive
rødt. Fuld opgørelse og de fire fund i **afsnit 11**. For compile-modellen er
det ærlige tal 39 par (afsnit 2), så dens golden-sæt venter på den nye hjerne.

**F286.3 — Baseline. BLOKERET på en beslutning, 22/9.** Kortet sagde «kør
`apps/model-lab` mod golden-sættet»; målingen viser at de to flader ikke mødes —
se afsnit 3 og kortets noter. Tallene skal stadig i plan-doc'en før første
træning; det er VEJEN dertil der skal vælges.

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

`apps/scout/`, som `apps/ambient-capture`.

**Hvorfor `apps/` og ikke `packages/`:** intet andet importerer den. Motoren
taler med modellen over HTTP gennem `@broberg/ai-sdk` (planens F4), præcis som
`apps/model-lab` er et værktøj og ikke et bibliotek. `packages/` er for kode
andre pakker importerer.

**Todelt, som Ambient er Swift udenpå og TypeScript indeni:**

```
apps/scout/
  src/          TypeScript — dataudtræk, evaluering, sammenligning, integration
  training/     Python — KUN selve træningen (MLX findes ikke i andet)
```

## Reuse

*(afsnit 8)* — Discovery-tjek 21/9 2026 på *model*, *training*, *classifier*, *ml*.

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

## 11. F286.2 — etiketterne, og et facit der aldrig trænes på

Målt 22. september 2026 med `bun run apps/scout/src/build-dataset.ts`.
Hele afsnittet kan køres om; intet her er talt i hånden.

### Seks opgaver, og hvor etiketten kommer fra

Ingen kategori er fundet på. Hver enkelt er en værdi produktionen allerede
holder, hentet fra det sted produktet selv bruger den:

| Opgave | Hvad modellen skal svare på | Etiketten kommer fra |
|---|---|---|
| `source-type` | hvilken pipeline skal køre på filen? | `pickPipeline()` i `@trail/pipelines` — **samme funktion upload-ruten kalder** |
| `routing` | hvilken hjerne hører det til? | dokumentets egen knowledge base |
| `neuron-type` | hvor skal Neuronen ligge? | `kind`-leddet i `/neurons/<kind>/<kilde>/` |
| `edge-type` | hvilken slags forbindelse? | `wiki_backlinks.edge_type` |
| `admit` | skal det overhovedet ind? | kuratorens godkendt/afvist i køen |
| `candidate-kind` | hvad slags forslag er det? | `queue_candidates.kind` |

**Kildetypen spørger registeret frem for at gætte.** Det oplagte var en liste
over filendelser i træningskoden — så ville to steder bestemme hvad en `.docx`
er, og de ville skride fra hinanden. En ny pipeline i produktet er nu en ny
kategori i modellen, uden at nogen skal huske det.

### Etiket-rummet, talt i produktionen

```
source-type          300 eksempler, 4 kategorier med data
  text     213 · pdf 57 · docx 29 · pptx 1
  erklæret uden data: xlsx, image, audio

routing             8.135 eksempler, 13 kategorier
  buddy-sessions 5.681 · cb-m1 1.290 · sanne-andersen 321 · broberg-ai 317
  trail-research 180 · agent-memory 127 · development-tester 75 · claude-code 34
  buddy-research 33 · zoneterapi-demo 32 · trail-development 22
  llm-technical-research 18 · helpdesk-dev 5

neuron-type         7.835 eksempler, 17 kategorier
  intercom 4.325 · auto 1.284 · sessions 674 · adr 581 · concepts 330
  sources 273 · entities 208 · root 45 · caught-bugs 27 · error-patterns 26
  precompact 26 · queries 15 · tur 11 · heuristics 4 · test 3
  architecture 2 · commitments 1

edge-type           6.022 eksempler, 7 kategorier — ALLE syv findes
  cites 5.925 · part-of 57 · example-of 23 · is-a 12 · contradicts 3
  caused-by 1 · supersedes 1

admit              15.255 eksempler, 2 kategorier
  approved 10.678 · rejected 4.577
  erklæret uden data: ingested

candidate-kind     15.255 eksempler, 11 kategorier
  external-feed 8.391 · gap-detection 1.835 · ingest-page-update 1.828
  contradiction-alert 1.668 · ingest-summary 924 · supersede 421
  cross-ref-suggestion 120 · user-correction 47 · chat-answer 16
  reader-feedback 4 · source-retraction 1
  erklæret uden data: version-conflict, scheduled-recompile
```

Fuld opgørelse i `data/label-space.json` (gitignored — den bærer kundeindhold).

### `emne` er IKKE en opgave, og det er et fund

Planen nævner emne som den femte klassifikations-opgave. Tags i produktionen er
fritekst: **253 forskellige, 120 af dem med én eneste forekomst**, og den
hyppigste er `internal` (329). En model der skal vælge mellem 253 muligheder med
et par eksempler i halen lærer ingenting. Emne kræver et kontrolleret ordforråd
først — eget kort, ikke noget der presses ind her. Tallene tælles med af
værktøjet, så udeladelsen kan efterprøves i stedet for at blive troet.

### Fire fund målingen gav, som ingen havde gættet

**1. Tre af de syv kildetyper har nul aktive eksempler — og de tre er ikke ens.**

```
              aktive   arkiverede
text             213          176
pdf               57            3
docx              29            1
pptx               1            0
image              0            8
audio              0            6
xlsx               0            0
```

`image` og `audio` FINDES i produktionen — hver eneste er bare arkiveret.
`xlsx` er aldrig brugt én eneste gang, selv om pipelinen er der.

Forskellen peger på et valg F286.4 skal tage: **for netop kildetypen er en
arkiveret kilde et fuldt gyldigt eksempel.** At et dokument er taget ud af
hjernen ændrer ikke at `.wav` håndteres af lyd-pipelinen. For en Neuron gælder
det modsatte — dér BETYDER arkivering at en kurator fjernede den, og så er den
det sidste man vil træne på. Derfor er arkiverede rækker udeladt som standard,
og derfor er det værd at genoverveje for denne ene opgave. Selv da er 8 og 6 for
lidt til at måle noget.

**2. To kategorier i kø-kandidaterne er erklæret og aldrig produceret.**
`version-conflict` og `scheduled-recompile` står i skemaet og findes ikke i
virkeligheden. De navngives frem for at blive tiet ihjel.

**3. Fire kanttyper har for lidt data til at blive målt.** `supersedes` og
`caused-by` har ét eksempel hver og får ingen golden-række — holdt ude ville de
intet have at træne på. `contradicts` har tre. **98 % af alle kanter er
`cites`**, så en model kan blive «god» ved altid at svare `cites`. Det tal må
F286.3 ikke læse som dygtighed.

**4. Den næststørste Neuron-type er «ingen valgte en type».** `/neurons/auto/`
er stien der stemples når en kandidat bliver AUTO-godkendt (`candidates.ts:586`)
— 1.284 Neuroner, 16 % af materialet. Det er ikke et arkiverings-valg, det er
fraværet af et. Den bliver liggende i datasættet, fordi modellen møder præcis de
dokumenter i drift — men høj præcision på `auto` er ikke evnen til at arkivere
rigtigt og skal ikke læses sådan.

### Golden-sættet er en egenskab ved TEKSTEN, ikke ved rækken

Det samme stykke skrift optræder i mere end én opgave: en Neuron er både et
`neuron-type`- og et `routing`-eksempel; en kø-kandidat er både et `admit`- og
et `candidate-kind`-eksempel.

Deler man rækkevis, ender en tekst med at være holdt ude for den ene opgave mens
modellen læser den under træning til den anden. Resultatet er en model der scorer
flot på noget den allerede har set — og **det viser sig ikke som en fejl, kun som
et mistænkeligt godt tal**.

Derfor: en tekst er golden alle steder eller intet sted. `train` er simpelthen
«ikke golden», så adskillelsen er sand i kraft af hvordan filerne skrives.

**To filer, ikke ét flag.** `data/train.jsonl` og `data/golden.jsonl` er fysisk
adskilte. Træningen peges på den første og **kan ikke læse facitlisten**. Ét
datasæt med `split: "golden"` på nogle rækker ville lægge hele garantien over på
at indlæseren husker at filtrere.

**Kvoten er stratificeret, ikke en procentdel.** En flad procentdel ville give
`cites` hundredvis af golden-eksempler og `contradicts` nul. Hver kategori der
kan undvære et eksempel, får et — og hver kategori beholder mindst én
træningsrække.

### Resultatet

```
golden            444 eksempler        (planens mål: 300–500)
træn           52.358 rækker
sprog           da 186 · en 180 · unknown 78     (heuristik, se labels.ts)
kildetyper      text 14 · pdf 14 · docx 14
```

`unknown` er de korte tekster — et kant-eksempel er to Neuron-titler og har
sjældent nok funktionsord til at afgøre sprog. Det er rapporteret som `unknown`
frem for gættet.

### Sådan bevises det, og hvordan det blev vist rødt

```
bun run apps/scout/src/build-dataset.ts     # mål + skriv de to filer
bun run apps/scout/src/verify-split.ts      # bevis adskillelsen
bun test apps/scout/                        # 16 prøver, inkl. de negative
```

`verify-split.ts` kører seks kontroller og går i exit 1 på den første der
svigter. De to bærende:

- **intet golden-id optræder i træningssættet** — den direkte lækage.
- **ingen golden-TEKST optræder i træningssættet** — den lækage forskellige
  id'er ikke standser: samme dokument eksporteret under to identiteter.

Kørt mod de rigtige filer 22. september: alle seks grønne, 444 golden-id'er og
226 distinkte golden-tekster, ingen genfundet blandt 52.358 træningsrækker.

**Og kontrollen er set fejle, ikke bare bestå** — på de ægte data, ikke kun i en
prøve. Ét golden-eksempel kopieret ind i træningen gør begge kontroller røde;
kopieres KUN teksten under et nyt id, bliver tekst-kontrollen stadig rød og
navngiver begge de opgaver der deler teksten. `labels.test.ts` holder de samme
mutationer plus en ensproget golden-liste, en med kun én kildetype, og en
kategori tømt for træningsdata. En kontrol man aldrig har set fejle, er en
kontrol ingen har kontrolleret.

### To fejl i værktøjet, fundet af værktøjets egne prøver

**Opdelingen afhang af inputrækkefølgen.** Første udgave gik opgaverne igennem i
den rækkefølge rækkerne tilfældigvis kom i — så en omrokering af de SAMME data
flyttede hele golden-sættet. Determinisme-prøven fangede det.

**Og en kategori endte uden træningsdata.** `neuron-type/test` har tre rækker,
holdt én tilbage — og så tog `routing` netop den tekst til sin egen kvote.
Resultat: 3 golden, 0 træn. En kategori modellen skulle genkende og aldrig ville
få at se. Der er nu en reparations-runde der frigiver tekster igen indtil hver
kategori har mindst én træningsrække, plus en prøve der går rød hvis den fjernes.

Begge blev fundet ved at KØRE prøverne, ikke ved at læse koden.

**Og en tredje, fanget inden den nåede ud:** første udgave brugte `Bun.hash` til
at vælge golden-teksterne. Den hash er ikke lovet stabil mellem Bun-versioner —
så en helt almindelig opgradering af runtime ville i stilhed have skåret
golden-sættet om, og en model trænet i sidste måned ville være målt på rækker
denne måneds eksport træner på. Præcis den lækage værktøjet findes for at
forhindre, ankommet gennem værktøjet selv. Nu `sha256`.

---

## 12. Baseline — hvad den model vi betaler for præsterer i dag (F286.3)

**Målt 22. september 2026, kl. 08.09 dansk tid.** Model: `mistral-small-latest`,
provider `mistral`, kaldt gennem `@broberg/ai-sdk` 0.38. 444 golden-eksempler,
to kørsler, temperatur 0, nul kald-fejl i begge kørsler.

**Hvorfor netop den model:** produktionen kører den.

```
$ flyctl ssh console -a trail-engine-001 -C "printenv INGEST_BACKEND"
mistral
```

`resolveIngestChain()` mapper `mistral` til `DEFAULT_CHAIN_MISTRAL`, hvis første
trin er `mistral-small-latest` (`apps/server/src/services/ingest/chain.ts:66`).
`mistral-large` er KUN provider-resiliens — F199.10 målte at large konsekvent
underpræsterer small på netop denne ingest-løkke.

Gentag med `bun run apps/scout/src/baseline.ts`.

### Tallet

```
opgave           eks.  etik.  træfsikkerhed   spredning  intet svar
────────────────────────────────────────────────────────────────────
source-type        42      7         100,0%       0,0pp           0
routing           122     13          22,1%       0,8pp          22
neuron-type        80     17          38,8%       0,0pp           0
edge-type          34      7          17,6%       0,0pp          11
admit              83      3          66,3%       4,8pp           6
candidate-kind     83     13          31,3%       1,2pp           0
────────────────────────────────────────────────────────────────────
I ALT             444                 42,1%                      39
```

Gentageligheden er god nok til at tallene kan bruges: to kørsler gav 42,1 % og
41,7 % samlet. Den største udsving er `admit` med 4,8 procentpoint — så **et
fremskridt på under 5 procentpoint på `admit` er ikke et fremskridt**, det er
støj. De øvrige fem opgaver flyttede sig 1,2 procentpoint eller mindre.

### HVAD TALLET ER, OG HVAD DET IKKE ER

**Det er ikke «produktionens klassifikator målt».** Der findes ingen
selvstændig klassifikator i produktionen: de seks valg træffes INDE i
compile-prompten mens den store model skriver, med hele dokumentet foran sig.
Det her er den samme model stillet de seks spørgsmål direkte, på ≤600 tegn, uden
den kontekst. **Tallet er derfor et gulv for sammenligning med Scout — ikke en
måling af hvor god vores nuværende ingest er.** Den sætning hører med hver gang
42 % citeres, og den står også i `baseline.json`s eget `caveat`-felt, fordi en
advarsel i en README ikke læses af den der om et halvt år citerer filen.

**`source-type`s 100 % beviser ingenting.** Etiketten udledes deterministisk af
FILNAVNET via `pickPipeline()`, og filnavnet står i den tekst modellen får. Den
opgave er en opslagstabel forklædt som klassifikation. Den skal enten ud af
Scouts omfang eller aldrig citeres som bevis for at Scout virker.

### PR. KATEGORI — og det var her det blev interessant

Et samlet tal på 42 % skjuler at modellen på tre opgaver har kategorier den
**bogstaveligt talt aldrig vælger**, uanset hvor almindelige de er:

| opgave | etiket den aldrig gættede | hvor stor er den i facit |
|---|---|---|
| `routing` | `sanne-andersen` | 33 af 122 — den STØRSTE |
| `routing` | `cb-m1` | 5 af 122 |
| `edge-type` | `cites` | 8 af 34 — og 98 % af alle kanter i produktionen |
| `edge-type` | `part-of` | 8 af 34 |
| `candidate-kind` | `external-feed` | 25 af 83 — den STØRSTE |

Og den modsatte fejl, over-gætning:

| opgave | etiket | gættet | rigtigt |
|---|---|---|---|
| `routing` | `trail-research` | 24 | 1 |
| `routing` | `development-tester` | 15 | 1 |
| `candidate-kind` | `ingest-summary` | 24 | 0 |
| `candidate-kind` | `ingest-page-update` | 16 | 5 |

**Det er derfor kortet krævede tal pr. kategori.** Havde vi kun rapporteret
42 %, ville «Scout rammer 55 %» have set ud som et fremskridt selv hvis Scout
lavede præcis de samme systematiske udfald.

### Tre ting tallene fortæller, som ændrer de næste kort

1. **`routing` bliver ikke løst af en bedre model.** Modellen ser kun
   KB-navnet — `sanne-andersen`, `cb-m1`, `trail-research` — og et navn er ikke
   en beskrivelse. Den gætter på emne-ord og lander på det navn der lyder mest
   generisk. F286.4 bør give opgaven en beskrivelse af hver Brain at vælge ud
   fra, ellers træner vi Scout på at efterligne en gætteleg.
2. **`admit` opfandt en etiket produktionen aldrig bruger.** `ingested` er
   deklareret i skemaet men har nul eksempler i produktionen, og modellen svarede
   det 7 gange. At vi tog deklarerede-men-fraværende etiketter med i valgmulig-
   hederne var rigtigt: uden dem ville den fejl have været usynlig.
3. **`edge-type` er den svageste — 17,6 % på syv etiketter, og modellen nægtede
   at svare 11 gange ud af 34.** Et kant-eksempel er to Neuron-titler og
   ingenting andet; det er formentlig for lidt signal for enhver model. Dén
   opgave skal have mere input, ikke en bedre klassifikator.

### Tre udfald, ikke to — og hvorfor det ikke måtte bruges `contracts.classify()`

`@broberg/ai-sdk` 0.38's `contracts.classify()` har en tavs redning
(`dist/index.js:2680`): svarer modellen en etiket uden for listen, returneres
`labels[0]`. I et produkt er det den rigtige afvejning. I en måling betyder det
at et sådant svar tælles som et gæt på første etiket — og hver gang den
tilfældigvis er facit, tælles det som KORREKT. Fejlen peger i den GRØNNE retning.

`baseline.ts` kalder derfor `ai.chat` og tæller tre udfald: korrekt, forkert,
**intet svar**.

> **RETTELSE (F286.7, 22. september).** Dette afsnit sagde først at «de 6
> ikke-svar på `admit` ville være scoret rigtige tre ud af fem gange», og
> regnede dermed med at ALLE ikke-svar ville ramme redningen. Det var en
> antagelse, ikke en måling — `ai-sdk` påpegede at `parseJsonLoose`
> (`dist:2611`) KASTER når svaret ikke indeholder `{` eller `[`, så redningen
> kun fyrer på et PARSELIGT svar. De havde ret i mekanismen.
>
> **Så målte vi det, og tallet gør begge vores gæt forældede.**

### De 36 ikke-svar er ÉN ting, ikke to — og det er ikke den vi troede

Målt 22. september kl. 08.19 dansk tid, `--runs 1`, samme model og prompt:

```
opgave           eks.  træfsikkerhed   udenfor menuen   uparseligt
source-type        42        100,0 %                0            0
routing           122         23,0 %               20            0
neuron-type        80         40,0 %                0            0
edge-type          34         17,6 %               10            0
admit              83         69,9 %                6            0
candidate-kind     83         31,3 %                0            0
I ALT             444         43,2 %               36            0
```

**Nul uparselige. Alle 36 var gyldig JSON.** Og hvert eneste af dem var det
samme svar: `{"label": null}`.

Tre konsekvenser, og de peger hver sin vej:

1. **Mit oprindelige skadestal holdt alligevel.** Er alle 36 parselige, ville
   de ALLE have ramt `labels[0]`-redningen i 0.38. Antagelsen var uunderbygget
   da jeg skrev den; målingen giver den ret bagefter. De to ting er ikke det
   samme, og det er grunden til at rettelsen står her frem for at blive slettet.
2. **MEN tallet er delvist vores egen prompt.** Vores systemprompt siger
   udtrykkeligt: «hvis ingen af etiketterne passer, svar `{"label": null}`».
   `classify()`s egen prompt siger «Choose exactly one label» og inviterer ikke
   et afslag. Med DEN prompt havde modellen formentlig valgt noget frem for at
   afvise, og de 36 ville have fordelt sig anderledes. **Tallet beskriver vores
   harness lige så meget som modellen** — det kan ikke læses som «mistral-small
   afviser 8 % af opgaverne» uden den sætning ved siden af.
3. **Modellen kan formatere. Den vælger at lade være med at svare.** Det er en
   anden slags fejl end den vi ledte efter, og den retter man med et bedre
   etiket-rum — ikke med et bedre svarformat. `routing` afviser 20 af 122 og
   `edge-type` 10 af 34; det er de to opgaver hvor etiketterne er henholdsvis
   uigennemsigtige mappenavne og to rå overskrifter.

**Og det besvarer `ai-sdk`s eget åbne spørgsmål.** De spurgte om et uparseligt
svar bør være en VÆRDI frem for et kast, når man måler. For denne model på
denne opgave sker det **0 gange ud af 444**. Ændringen ville blive bygget til et
tilfælde der ikke indtraf én gang — det argumenterer imod den, ikke for.

`readAnswer()` i `baseline.ts` skelner de to, og `baseline.test.ts` beviser at
skellet virker med en modprøve i begge retninger: muteres funktionen til altid
at svare ét stempel, bliver mindst to prøver røde. Det er nødvendigt netop
fordi svaret blev 36/0 — et split med et nul i ligner en tæller der ikke virker.

**VI KØRER EN FORLDET PAKKE, og det er det egentlige fund.** Fejlen er rettet i
0.42.0 og igen i 0.47.1. Vi står på 0.38, fordi `^0.38.0` under 1.0.0 er
patch-only — se **F287**. Når den opgradering lander, migreres `baseline.ts`
tilbage til `contracts.classify()`: dens `label: string | null` + `rawLabel` er
samme skel som `readAnswer()`, og den fanger oveni tvetydighed.

### Kørslen kasseres hvis en anden model svarer

`baseline.ts` læser `usage.model` fra det svar der FAKTISK kom, og kaster hele
kørslen hvis andet end `mistral-small-latest` har svaret. Et fallback-spring
midt i en måling ville give et tal der ser rigtigt ud og sammenligner med den
forkerte model.
