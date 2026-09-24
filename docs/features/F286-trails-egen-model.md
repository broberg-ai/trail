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
- **Ingen PERSONDATA ud af huset.** Sannes brain er fagviden om zoneterapi,
  ikke patientdata, og må trænes hvor som helst (Christian 24/9, se 17.1).
  Grænsen går ved persondata, ikke ved hvem der ejer teksten.
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

## 13. F286.9 — alle 80 kilder kompileret, og en fejl jeg selv byggede ind undervejs

**RESULTATET FØRST.** Scout Training 0001 er drænet: 80 af 80 kilder
kompileret lokalt på Max-abonnementet, 0 kr. Brugbart træningsmateriale i
flåden gik fra **35 til 72 kilder med hel rundtur**.

```
FØR drænet     hel  35   knækket  44   fraværende 301
EFTER          hel  72   knækket  47   fraværende 261
   heraf scout-training-0001:   39 hel · 41 knækket · 0 fraværende
```

### Fejlen, og hvordan den blev fundet

Midtvejs stod 0001 på **2 hel / 38 knækket** — værre end de 8/8 den forrige
session efterlod. Målingen fandt den; ingen assertion, ingen fejl, intet rødt.

MÅLT, ikke gættet: et `wiki-write`-kald med `sourceDocumentId` **overskriver**
Neuronens `sourceIdentity`. Sidste skriver vinder.

```
kurateringskoeen.md   oprettet af F17   → stod som PLAN-PATCH.md
memex.md              oprettet af as-we-may-think → stod som KARPATHY-LLM-WIKI-ORIGINAL
log.md                                  → stod som den sidst kompilerede kilde
```

Compile-promptens trin 4 **kræver** at eksisterende sider opdateres med den nye
kilde. Følger man den instruktion og sender sin egen `sourceDocumentId` med,
stempler man hver berørt side som sin egen — og den side dukker samtidig op som
ens eget afledte output. Begge retninger af rundturen bliver forkerte på én gang.

Det er præcis det farlige udfald `audit-roundtrip.ts` er skrevet for at fange:
et knækket par ser HELT ud fra den side man kigger fra.

### Rettelsen, og hvordan den blev bevist

**Kun en CREATE fra denne kilde må bære `sourceDocumentId`.** En `str_replace`
eller `append` på en side en anden kilde har oprettet — og altid `log.md`,
`glossary.md`, `overview.md`, som deles af hver eneste kilde — skal sendes uden.

Bevist med en læs-tilbage før/efter på det kørende system:

```
FØR  glossary identity = …/SAAS-SCALING-PLAN.md
     write UDEN sourceDocumentId → ok
EFTER glossary identity = …/SAAS-SCALING-PLAN.md   UÆNDRET
```

Negativ kontrol fra produktionsdata: de tre sider ovenfor, hvor feltet BLEV
sendt og identiteten skiftede. Efter rettelsen kom de næste kilder ud hele —
`F87-event-stream.md`, `F94-ambient-audio.md`, `F142-chunked-ingest.md`: 0 uenige.

### Hvad der IKKE kan rettes, og hvorfor

De 41 knækkede par i 0001 er skrevet før rettelsen. Fremad-pegeren kommer fra
`queue_candidates.metadata.sourceDocumentId` → `wiki_events.sourceCandidateId`;
der er ingen HTTP-rute der kan fjerne den igen, og
`/maintenance/backfill-neuron-identity` hjælper ikke — den udleder identitet fra
`document_references` og springer over de Neuroner der har flere kilder, hvilket
er præcis de berørte.

Fordelingen, målt:

```
22 af 41   knækket KUN af delte sider (log.md 34 forekomster, glossary.md 5)
19 af 41   ægte kryds-opdatering af en anden kildes side
```

### Det fund der er større end min fejl

**`log.md` kan aldrig indgå i et helt par.** Ni-trins-prompten kræver en
log-linje ved HVER ingest, og `sourceIdentity` er ét felt. Enhver kilde
kompileret efter instruktionen vil derfor pege frem på `log.md`, og `log.md` kan
kun pege tilbage på én af dem.

Det er ikke en fejl i min kørsel — det er en egenskab ved instrumentet: de
delte sider (`log.md`, `glossary.md`, `overview.md`) og kryds-opdateringer af
andre kilders sider burde ikke tælle som **afledt output** overhovedet. En side
en kilde *bidrog til* er ikke en side den *producerede*.

**Beslutningen er ejerens**, og de to muligheder er:

1. **Lad de 41 stå.** 39 hele fra denne brain + 33 fra agent-memory = 72 par.
   Koster ingenting, og 0001 er så halvt brugbar.
2. **Kør 0002 fra samme 80 kilder med den rettede skrivemåde.** `trail-research`
   er urørt, `reingest.ts` er genoptagelig, compile er stadig 0 kr. Forventet
   resultat: ~80 hele par i stedet for 39.

Mulighed 2 ødelægger intet — den lægger en ny brain ved siden af.

### EFTERSKRIFT — 0001 kørt om, 80 af 80 hele par

Christian, 22/9: *«Hvorfor er der 41 knækkede par? Kan du ikke lave det her
ordentligt eller hvad sker der?»* Han har ret, og valget mellem «lad det stå»
og «lav det om» var ikke et valg jeg skulle have lagt op til ham.

`scout-training-0001-v2` er de SAMME 80 kilder kørt om med den rettede
skrivemåde:

```
scout-training-0001-v2    80 hel ·  0 knækket ·  0 fraværende
scout-training-0001       39 hel · 41 knækket      (den gamle, fejlbehæftede)
flåden i alt              35 par i morges → 72 → 152
```

80 kilder ind, 173 neuroner ud. NUL meterede kald. `trail-research` urørt:
80 kilder / 100 neuroner, samme tal som før.

**RETTELSEN LIGGER NU I MEKANIKKEN, IKKE I EN HUSKEREGEL.** Skrivefunktionen
vedhæfter kun `sourceDocumentId` når kommandoen er `create`:

```python
if sid is not None and kw.get("command") == "create":
    kw["sourceDocumentId"] = sid
```

Et `str_replace`/`append` kan derfor ikke længere stemple en anden kildes side
som sin egen — heller ikke hvis den der skriver det glemmer reglen. Det var
præcis dét der fejlede første gang: reglen fandtes kun som noget man skulle
huske ved hvert kaldsted.

**DE 8 KILDER DEN FORRIGE SESSION HAVDE KOMPILERET** (F17, F18, F100, F102,
F103, F104, F107, TRAIL-PERF-ROADMAP) er kompileret på ny i v2, så brainen er
hel og ikke halvt arvet. Deres koncept- og entitetssider — Kurateringskoeen,
Kuratorfladen, Ni-trins ingest, Levende ordliste, Obsidian-eksport,
Ingest-profiler, Marp-slides, Outputformater fra Neurons, Maal foer du
optimerer — findes derfor også i v2 med korrekt kilde-identitet.

**AFVENTER:** arkivering af den gamle `scout-training-0001`. Den indeholder
intet der ikke findes i v2, men en sletning er ejerens.

---

## EFTERSKRIFT 2 — 0002 er hel, og målingen aflyste 0003

**22. september kl. 11.55 dansk tid.** De resterende 60 kilder i
`scout-training-0002` er kompileret i en interaktiv Max-session. Nul meterede
kald. Rundturen målt bagefter med `apps/scout/src/audit-roundtrip.ts`:

```
brain                            hel   knækket   fraværende
broberg-ai/scout-training-0002    69         0            1
broberg-ai/scout-training-0001-v  80         0            0
broberg-ai/scout-training-0001    39        41            0   ← den gamle, erstattede
broberg-ai/agent-memory           33         0            7
-----------------------------------------------------------
I ALT (hele flåden)              221        47          262
```

Den ene fraværende i 0002 er `tak.md` — en kvitteringsside efter en
formular-indsendelse, markeret `failed` frem for skjult. Den producerede
intet, og *fraværende* er det ærlige udfald for en kilde der intet producerede.
**Alle 47 knækkede par ligger i den gamle 0001.** Ingen nye er opstået.

Flåden gik fra 35 hele par i går morges til **221**.

### MÅLINGEN AFLYSTE DET NÆSTE STYKKE ARBEJDE

Planen var `scout-training-0003` fra `agent-memory`, 40 kilder. Den er **ikke
kørt**, og den bør formentlig ikke køres som beskrevet. Målt i dag:

```
agent-memory              40 kilder
  har allerede hele par   33
  uden ét eneste spor      7
```

De 33 er gået gennem den NYE pipeline og er allerede brugbart
træningsmateriale. En re-ingest til et nyt brain ville altså producere 40 par
hvoraf 33 duplikerer noget der findes — og det var netop for at undgå den
slags dobbeltarbejde at re-ingesten overhovedet blev målt først.

**De 7 uden spor er ikke tilfældige, og det er den egentlige oplysning:**

```
trail__feedback_read_carefully_before_acting.md
trail__feedback_plain_danish.md
trail__feedback_never_pkill_shared_procs.md
trail__feedback_dry_run_llm_subprocess.md
trail__feedback_check_for_existing_spec.md
trail__feedback_cc_runs_normalize.md
trail__feedback_browser_refresh_exception.md
```

Alle 32 `buddy__feedback_*` har hele par. Alle `trail__feedback_*` har ingen.
Det er et mønster, ikke støj — de to sæt er landet ad forskellige veje. Og
`trail__feedback_browser_refresh_exception.md` ligger **to gange** i brainen
(`0c1c71b9` og `3fea40fd`), hvilket peger samme vej: den ene vej bar ikke en
kilde-identitet, så en genindsendelse blev læst som en ny kilde.

**Konsekvensen for kortet:** 0003 er ikke 40 kilders arbejde, det er 7 — og
de 7 er dette repos egne memory-filer, som ifølge CLAUDE.md skal gennem
upload-ruten (`path:`-identitet), ikke kandidat-ruten. Det er en anden og
mindre opgave end den der stod i planen.

**AFVENTER STADIG:** arkivering af den gamle `scout-training-0001` (39 hele /
41 knækkede). Den indeholder intet der ikke findes i v2. Sletningen er ejerens.

## 14. F286.8 — presser man modellen, flytter fejlene ind i menuen

**Målt 22. september 2026 kl. 21.16 dansk tid.** Alle 444 golden-eksempler,
mistral-small-latest, temperatur 0. Kun prompten ændres. Afsnit 12's
baseline-tal røres ikke — det er målt med vores prompt og står ved det.

### Spørgsmålet

ai-sdk-sessionen var i tvivl om deres egen `classify()`-prompt: forbyder man
modellen at sige «ingen passer», vælger den så bare noget — og lander det svar
INDE i menuen, hvor `label: null` ikke kan fange det? Vi er det eneste sted det
kan måles, fordi vi har facit for alle 444.

### Tre varianter, ikke to

Kortet frygtede at vores prompt og ai-sdk's adskilte sig på to akser —
invitationen til at afvise OG længden — så et udslag ville være tvetydigt.
Aflæst i `@broberg/ai-sdk@0.48.0/dist/index.js:2949`: deres prompt er **ordret
vores to første sætninger**. Forskellen er præcis to ting, og de kan isoleres:

| variant | ændring i forhold til vores |
|---|---|
| `ours` | udgangspunkt — inviterer eksplicit til `{"label": null}` |
| `ai-sdk` | ingen invitation; beder om et `confidence`-felt |
| `ours-no-refusal` | vores minus afvisnings-sætningen, intet andet |

### Resultatet

```
variant            træfsikkerhed  afvisninger  forkerte  kaldfejl
ours                      43.0%           38       215         0
ai-sdk                    44.6%            0       246         0
ours-no-refusal           43.5%            0       251         0
```

**Det bærende tal — joinet pr. eksempel-id, ikke to aggregater:**

```
af de 38 eksempler vores prompt afviste      → ai-sdk   → no-refusal
  blev RIGTIGE                                    4          3
  blev FORKERTE gæt inde i menuen                34         35
  afviste stadig                                  0          0

pr. opgave (afvist→rigtig / afvist→forkert), ai-sdk:
  routing     0 / 22
  edge-type   1 / 10
  admit       3 /  2
```

### Hvad det betyder

**Ja, fejlene flytter ind i menuen.** Af 38 afvisninger blev 34-35 til forkerte
gæt, der ser nøjagtig ud som et rigtigt svar. Kun 3-4 blev rigtige. ai-sdk's
bekymring holder: et forbud mod at afvise gør «uden for menuen» usynligt ved at
gøre det til «forkert inde i menuen» — den stillere og farligere kategori.

**Den samlede træfsikkerhed lyver om det.** 43,0 % → 44,6 % ligner en lille
forbedring. Det er det ikke. Den kommer af omrokering: 10 forkerte blev rigtige
og 7 rigtige blev forkerte, på ANDRE eksempler end de afviste. En stigning på
1,6 point dækker over 34 nye fejl man ikke kan se.

**Afvisningerne var ægte, ikke dovenskab.** For routing blev **22 af 22**
afvisninger til forkerte gæt, og for edge-type 10 af 11. Etiketterne dér er
uigennemsigtige mappenavne og rå overskrifter, og modellen kunne reelt ikke
vælge. Det passer med afsnit 12: routing og edge-type er de to svageste
opgaver.

**`admit` er undtagelsen.** 3 af 5 afvisninger blev rigtige under pres. Dér var
en del af afvisningerne forsigtighed snarere end blindhed.

**`confidence`-feltet er ligegyldigt.** `ai-sdk` og `ours-no-refusal` giver
næsten samme overgange (34 mod 35 forkerte). Det er invitationen der betyder
noget, ikke feltet.

### Konsekvensen for Scout

1. **Scout skal have et «ingen passer»-udfald og trænes til at bruge det.** En
   klassifikator der altid svarer en etiket, vil på routing og edge-type
   producere netop de gæt der ikke kan skelnes fra rigtige svar.
2. **Træn ikke på pressede gæt.** Et datasæt lavet med en prompt der forbyder
   afvisning, lærer Scout at gætte med selvtillid.
3. **Routing- og edge-type-etiketterne er problemet, ikke modellen.** De bør
   gøres forståelige (beskrivelse pr. etiket) før Scout trænes på dem — ellers
   træner vi den på noget en stor model heller ikke kan.

### Hvordan det er sikret

- `apps/scout/src/prompt-ablation.ts` — varianterne med kildehenvisning pr.
  prompt. Samme læser og samme fallback-spærre som `baseline.ts`.
- `apps/scout/src/prompt-ablation.test.ts` — tre prøver, begge mutationer
  bevist røde:
  - fjernes `if (import.meta.main)`, måler import-prøven **1.332 kald** i stedet
    for 0 — præcis hvad en hel kørsel koster
  - joines der på position i stedet for id, bliver prøven med omvendt
    rækkefølge rød
- Rådata i `apps/scout/data/prompt-ablation.json` (ikke i git, som resten af
  facit-sættet).

## 15. F286.4 — Scout 1.0 er trænet, og den slår baseline på fem af seks opgaver

**Kørt natten til 23/9 2026 på M1 (MPS), $0.** mmBERT-base, ét klassifikationshoved
pr. opgave, `apps/scout/training/train.py`: højst 800 eksempler pr. etiket, 10 %
valideringsudsnit af TRÆNINGSDATA, 3 epoker, seed 42, frosne token-embeddings.
Golden-sættet åbnes først efter træningen, og scriptet nægter at træne hvis et
golden-id findes i træningsdata. `verify-split.ts`: 6/6 kontroller grønne før
kørslen. Ingen golden-tekst findes i træningsdata, heller ikke med de første 200
tegn ens (målt for routing og edge-type, de to største spring).

```
opgave           golden  mistral-small  Scout   rigtige  forkerte  afstået  tærskel
source-type          42        100 %     100 %       42         0        0     0,00
routing             122         23 %      88 %      102        12        8     0,62
neuron-type          80         40 %      88 %       70        10        0     0,00
edge-type            34         18 %      35 %       11        16        7     0,76
admit                83         70 %      89 %       74         9        0     0,00
candidate-kind       83         31 %      77 %       62        16        5     0,90
```

«Scout»-kolonnen er når den altid svarer. «rigtige/forkerte/afstået» er med
tærsklen — under den siger Scout «ingen passer» (AC: afståelser tælles for sig).
edge-type UDEN `cites`: 26 eksempler, Scout 15 %.

**HVOR SCOUT ER DÅRLIGERE END MISTRAL — navngivet, ikke gemt i et gennemsnit:**

```
routing         helpdesk-dev 0/4 (mistral 3/4) · llm-technical-research 2/5 (3/5) · zoneterapi-demo 4/5 (5/5)
neuron-type     architecture 0/1 (1/1) · heuristics 0/3 (3/3) · test 0/1 (1/1)
edge-type       is-a 0/8 (5/8)
candidate-kind  contradiction-alert 13/16 (16/16) · ingest-page-update 4/5 (5/5) · reader-feedback 0/3 (3/3)
```

**Mønsteret er ét:** hver etiket hvor Scout taber, havde 1-4 træningseksempler
(helpdesk-dev 1, heuristics 1, architecture 1, test 2, reader-feedback 1, is-a 4).
Mistral klarer dem fordi den læser etiketnavnet; Scout lærer kun af eksempler.
Det peger på den naturlige arbejdsdeling for F286.5: Scout svarer hvor den har
lært, og en sjælden etiket — eller et «ingen passer» — går videre til en LLM.

**To forbehold der hører til tallene:**

1. **«Ingen passer» virker kun inden for det Scout har set.** Et stykke sludder
   («helt ukendt tekst uden mening xyz») får edge-type-svaret `cites` med 0,98 i
   sikkerhed. Tærsklen fanger tvivl mellem kendte etiketter, ikke en tekst der
   ikke hører hjemme nogen steder. Et rigtigt out-of-distribution-filter er ikke
   bygget.
2. **Golden-sættet er lille pr. etiket** (ofte 3-6), så en enkelt forskel flytter
   en etiket 20-30 procentpoint. Opgave-tallene står stærkere end etiket-tallene.

**Svartid på CPU** (4 tråde, M1, 50 golden-tekster, `training/predict.py --bench`):
routing median 67 ms (p90 83), neuron-type 78 ms (p90 94), admit 113 ms (p90 135).
Målt på M1'erens CPU — IKKE på cb-ubuntu, hvor F286.5 skal servere den. Den er
ældre og vil være langsommere; tallet dér er ikke målt.

**Disk:** 1,2 GB pr. opgave, 7,1 GB i alt under `apps/scout/models/`
(gitignoret), ét sæt vægte pr. opgave — `train.py` sletter den forrige før den
gemmer. 22 GB fri efter kørslen. Kørt to gange i træk på source-type: modelmappen
fylder byte-for-byte det samme (7.409.440 KB før og efter begge), men maskinens
frie plads faldt 129 MB og siden 27 MB — og den falder også uden træning, fordi
andre sessioner skriver. Fri plads kan derfor ikke bære beviset alene; det kan
modelmappens størrelse.

**Hukommelse — målt, og den kostede en kørsel:** batch 16 sendte processen op på
6,6 GB og Mac'en i swap på routing (0 skridt på 10 minutter). Nu 8 × 2
mikrobatches, samme effektive batch. Første to opgaver kørte med 16 og er ikke
kørt om; 8 × 2 giver i praksis samme gradient som 16 (små afvigelser ved en ufuld sidste batch).

**Prøv den selv:**

```
cd apps/scout
training/.venv/bin/python training/predict.py routing "Zoneterapi-forløb for gravide"
training/.venv/bin/python training/predict.py admit "<tekst fra en kandidat>"
```

## 16. Compile-modellen — plan (F286.10 datasæt, F286.11 træning)

**Ejerens ordre 23/9:** «Fortsæt med compile-modellen.» Afsnit 5 satte den til
«senere, venter på datagrundlaget». Grundlaget er nu målt, så den tages op.

**Datagrundlag, målt 22-23/9:**

```
kilde                         par    sprog     facit (Neuron)
scout-training-0001-v2         80    en→da     Opus-kompileret, 2,1 Neuroner/kilde
scout-training-0002            69    da→da     Opus-kompileret, 1,5 Neuroner/kilde
music (kun wikipedia-kilder)  236    en/da→en  Forager, læst og rettet (37 fejl fanget)
                              ---
                              385
```

Deterministiske Music-sider (musicbrainz, wikidata, wikiquote, discogs) og
entity-siderne er UDE: de er skabeloner, og en model lærer skabelonen.

**Tre ting der skal afgøres i F286.10, før der trænes:**

1. **Længden.** Wikipedia-artikler er lange. En 4B-model med LoRA på 16 GB kan
   ikke træne på 30.000 tokens pr. eksempel. Længdefordelingen måles, og et loft
   vælges ud fra den — ikke ud fra hvad der lyder rimeligt.
2. **Stavningen.** Trails Neuroner skrives om med `restore_danish.py` ved
   udtrækket (afsnit 15/F286.9), inklusive titler og [[links]] — konsistent
   inden for datasættet, så intet link peger på en titel der ikke findes.
3. **Facit.** Mindst 15 % af kilderne holdes ude, lagdelt pr. kilde-brain, og
   mærket i dataen selv (samme regel som F286.2).

**F286.11 — træningen.** LoRA via MLX (`mlx-lm`) på M1. Modelvalg efter
afsnit 6 («én modelfamilie»): Qwen3.5 i den største størrelse der kan trænes
uden swap — måles, ikke antages, fordi F286.4 viste at hukommelsen er den reelle
grænse på en maskine med mange sessioner. Disken (22 GB fri) skal have en
oprydning: kun det sidste adapter-checkpoint bevares.

**Hvad «virker» betyder:** på facit-kilderne måles (a) at output er gyldig
Neuron-markdown med frontmatter, (b) om titlerne svarer til facit, og (c) en
læst stikprøve — samme metode som F286.9 AC#6. En automatisk tekstlighed alene
er ikke nok: den belønner en model der kopierer kilden.

**Non-goals:** ingen produktionsbrug, ingen skyggetilstand for compile (det er
et senere kort), ingen træning på Sanne-data i denne runde (hendes er PDF og
kræver OCR, jf. F286.9's noter).

### 16.1 F286.10 — datasættet er bygget (23/9)

```
                          par   over loft   træning   facit   facit-andel
scout-training-0001-v2     80          5        63       12        16,0 %
scout-training-0002        69          1        57       11        16,2 %
music (wikipedia)         236         76       136       24        15,0 %
                          385         82       256       47
```

**Længde (Qwen3.5-tokenizer, system + kilde + facit):** median 3.058, p75 7.458,
p90 13.804, p95 16.250, max 19.951. Inden for 2.048: 126 · 4.096: 232 ·
8.192: 303. **Loftet er 8.192**: det beholder 79 % af parrene; de 82 der
droppes er overvejende lange Wikipedia-artikler (76 af dem). Et par over loftet
kappes IKKE — en afskåret kilde med et helt facit lærer modellen at opfinde.

**Hvad der er gjort ved facit:**
- `{#claim-…}`-ankre fjernet (serveren sætter dem selv). 1 tilbage, og den står
  i backticks som et eksempel i en tekst OM ankre — korrekt.
- Trails Neuroner har fået æ/ø/å igen, titler og [[links]] med samme funktion.
- **40 links pegede på sider, som brainen ikke har** (fx «Universet», «Webhouse
  CMS», og eksempler på link-syntaks). Målt: 40 med og 40 uden
  stavningsrettelsen, så de stammer fra kompileringen, ikke fra rettelsen. De
  er lavet om til almindelig tekst; ellers lærer modellen at linke til sider
  der ikke findes. Efter bygningen: 0 døde links.
- Music: 0 ikke-Wikipedia-kilder og 0 entity-sider i facit (talt i filen).

**Forbehold:** Music-facit er på ENGELSK med en fast skabelon (Summary, Career,
Key facts, Connections) — 160 af 303 par. Modellen vil lære den skabelon for
musik-kilder. Trails egne par er dansk og friere i formen.

Kommandoer: `bun run src/export-dataset.ts --export --with-content
"--only=scout-training-0001-v2,scout-training-0002,music:^wikipedia-"` ·
`bun run src/export-titles.ts <brains>` · `training/build_compile.py build 8192`.

## 17. F286.12 — samme træning på en lejet GPU (Runpod), side om side med M1

**Christians ord 23/9:** «Jeg siger ikke at vi går væk fra at køre en omgang på
m1 når jeg går i seng, men jeg er nysgerrig efter hvad en ægte GPU kan gøre og
hvad det koster?» — og efter vurderingen: «Ja, lav kortet, jeg opretter nøglen i
vaulten».

**Hvorfor:** M1 kunne ikke engang starte 4B med 8.192 tokens, mens flåden kørte
(F286.11). Et RTX A6000 (48 GB) koster ~$0,50/time (voice-engine målte 23/9).
Hele jobbet forventes at vare en time og koste ~4 kr. [ikke målt]. Samme træning
på begge maskiner giver to tal side om side: tid, pris og kvalitet på facit-sættet.

**Arkitektur (voice-engines erfaring, målt hos dem, genbrugt som mønster):**
- **Pod, ikke serverless;** SECURE, on-demand, aldrig spot.
- **Kun EU:** `dataCenterIds` = EU-CZ-1, EU-DK-1, EU-FR-1, EU-NL-1, EU-RO-1,
  EU-SE-1, EU-SE-2. Tjekkes mod Runpods live-liste før hver leje, og hvor poden
  landede, læses tilbage. Uden låsen landede 6 af deres kørsler i USA.
- **Kortvalg:** billigste ledige med ≥ 40 GB VRAM; udsolgt → næste. En fejlet
  pris-forespørgsel må ikke ligne «udsolgt».
- **Nedrivning i `finally`**, beskyttet mod afbrydelse; en ny leje rydder først
  vores egne pods ældre end loftet; hårdt tidsloft pr. kørsel (sat efter målt
  jobtid + margen). Efterladte pods var voice-engines eneste reelle udgift.
- **Træning:** PyTorch + PEFT/Unsloth på poden (MLX findes kun på Apple). Samme
  datasæt (`compile-data/`), samme seed, samme loft på 8.192 tokens. Adapteren
  hentes hjem, poden slettes.
- **Måling:** samme 47 facit-kilder og samme metrikker som `eval_compile.py`
  (gyldig Neuron, titel-match, kopi-andel), kørt på poden mens den er lejet.

**Nøgle:** Trails EGEN Runpod-nøgle i cardmem-vaulten. Voice-engines nøgle
lånes ikke (deres ord).

**Non-goals:** ingen servering af modellen på Runpod; intet automatisk
genoptag-flow. (Oprindeligt også «ingen Sanne-data, kun EU» — ophævet af
Christian 23/9 og 24/9, se 17.1.)

### 17.1 Kørslerne 23/9 om aftenen — undervejs (tal følger)

- **Region:** Christian 23/9: «Træning af scout må gøres i hele verden, det er
  ikke kundedata.» `runpod_train.py --anywhere` slår EU-låsen fra.
- **Sannes data, Christian 24/9:** «Sannes data er hendes fakta om zoneterapi
  og der er NULL patient data i så det er stadig en god brugbar kilde og
  træning kan foregå alle steder i verden.» En pod er et lukket miljø; der
  kommer ikke tekst ud af den. Samme vurdering som at bruge Anthropic til
  kodning. **Reglen er derfor: `--anywhere` er tilladt for alt uden
  persondata** — Trails egne dokumenter, broberg.ai, Wikipedia OG Sannes
  fagviden. EU-låsen er stadig standard og bruges, hvis et datasæt nogensinde
  indeholder persondata (fx klient- eller patientoplysninger).
- **Kørsel 5 — 4B:** L40S 48 GB, EU-NL-1, $1,09/t. Top 34,3 GB GPU-hukommelse.
- **Kørsel 6 — 9B:** A100 80 GB, CA-MTL-3 (Montreal), $1,59/t, top 44,3 GB.
  Startet ved siden af kørsel 5 — scriptet sletter nu kun Trail-pods ældre end
  7 timer, ikke alle. Christian 23/9: han havde forventet den største model der
  passer til kortet; 4B var valgt for at kunne sammenligne med M1.
- **Hastighed at hente:** poden mangler `flash-linear-attention` og
  `causal_conv1d`, så to beregningsdele kører i en langsom reference-udgave
  (transformers advarer selv). Installeres i næste kørsel.

### 17.1a Resultat, kørsel 5 — Scout 4B (målt 24/9)

Qwen3.5-4B + LoRA, L40S 48 GB, EU-NL-1, $1,09/t. Træning 693 trin (3 epoker),
måling på de 47 facit-kilder (aldrig trænet på) + den utrænede model på 15.
**Pris: $2,95** for hele kørslen (2 t 42 min lejet, heraf ~1 t 25 min træning
og ~1 t 15 min måling). Adapter (16 MB) hentet til `runpod-out/1790196924/`.

| | Utrænet (15) | **Scout 4B (47)** |
|---|---|---|
| Gyldigt Neuron-format | 0 % | **100 %** |
| Titel-præcision | 0 % | **72 %** |
| Titel-dækning (facit fundet) | 0 % | **63 %** |
| Kopi-andel fra kilden | 72 % | **29 %** |
| Sek. pr. kilde | 74 | 74 |

**Pr. kilde-brain (`score_by_brain.py`) — gennemsnittet skjuler forskellen:**

| Brain | n | præc. | dækn. | Neuroner/kilde (facit) | kopi |
|---|---|---|---|---|---|
| music (en, Wikipedia) | 24 | 96 % | 96 % | 1,0 (1,0) | 0,16 |
| scout-training-0001-v2 (en→da, Trail-planer) | 12 | 71 % | 59 % | 1,2 (1,4) | 0,38 |
| **scout-training-0002 (da→da, broberg.ai)** | 11 | **25 %** | **19 %** | 1,1 (1,5) | **0,50** |

**Læsning:**
- Træningen virker: fra ingenting til gyldige Neuroner hver gang. En del af
  springet fra 0 % er at den utrænede model ikke kender formatet (skilletegn,
  frontmatter) — indholdsmålet er 63–72 % og kopi-andelen.
- Music (53 % af træningen, fast skabelon, 1 Neuron/kilde) scorer næsten
  perfekt og trækker gennemsnittet op.
- **Dansk → dansk er svagest:** kopierer halvdelen af kilden, rammer sjældent
  lærerens titler, laver for få Neuroner pr. kilde. Det er præcis den slags
  materiale der er for lidt af i træningen — bekræfter retningen i 17.2.

### 17.1a2 Resultat, kørsel 6 — Scout 9B, og valget af modelstørrelse (24/9)

Qwen3.5-9B + LoRA, samme data og indstillinger, A100 80 GB, CA-MTL-3
(`--anywhere`, generisk data), $1,59/t. **Pris: $3,80** (2 t 23 min lejet).
Adapter hentet til `runpod-out/1790199605/`.

| Alle 47 facit-kilder | 4B | 9B |
|---|---|---|
| Gyldigt format | **100 %** | 94 % |
| Titel-præcision / -dækning | **72 % / 63 %** | 67 % / 56 % |
| music | 96 / 96 % | 83 / 83 % |
| Trail-planer (en→da) | 71 / 59 % | 69 / 53 % |
| broberg.ai (da→da) | 25 / 19 % | 27 / 19 % |
| Kopi-andel | 29 % | 27 % |

**Retfærdig sammenligning — de SAMME 15 kilder (Trail-planer + 3 broberg.ai):**

| | gyldigt | præc. | dækn. | kopi |
|---|---|---|---|---|
| 4B utrænet | 0 % | 0 % | 0 % | 0,72 |
| **4B trænet** | **100 %** | 61 % | **50 %** | 0,43 |
| 9B utrænet | 51 % | 28 % | 41 % | 0,67 |
| 9B trænet | 84 % | 62 % | 45 % | 0,37 |

**Beslutningsgrundlag:**
- Den utrænede 9B kan allerede noget; efter træning lander 4B og 9B samme sted.
- **4B vælges:** samme kvalitet, 100 % gyldigt format, billigere at træne og
  køre, og kan køres på M1 (afsnit 18.3: gå kun op i størrelse når målingen
  kræver det — det gør den ikke).
- **Flaskehalsen er data, ikke modelstørrelse:** dansk→dansk er 19 % dækning i
  BEGGE modeller. Næste runde = 17.2 (flere, bredere, danske par).
- Aftenens samlede Runpod-forbrug (kørsel 2–6): ≈ $6,80.

### 17.1a3 Kortets AC holdt op mod målingerne (24/9)

Tal fra `runpod-out/run-1790196924.json` (4B) og `run-1790199605.json` (9B),
skrevet af `runpod_train.py` selv. Kurs: ECB 23/9, 1 USD = 6,5512 kr.

| | Kørsel 5 — 4B | Kørsel 6 — 9B |
|---|---|---|
| Kort | L40S 48 GB | A100 80 GB PCIe |
| Datacenter (læst tilbage fra API) | EU-NL-1 | CA-MTL-3 (`--anywhere`, ejerens ok) |
| Pris/time | $1,09 | $1,59 |
| Opstart (pod klar) | 108 s | 97 s |
| Pakke-installation | 12 s | 14 s |
| Træning + måling på poden | 9.619 s (2 t 40 min) | 8.477 s (2 t 21 min) |
| Samlet lejet | 9.746 s | 8.606 s |
| **Samlet pris** | **$2,95 ≈ 19,33 kr.** | **$3,80 ≈ 24,90 kr.** |

- **Nedrivning:** Runpod-kontoen listet 24/9 efter kørslerne — 0 Trail-pods,
  0 pods i alt. Tidsloftet i koden er `MAX_MINUTES = 180`; den længste målte
  kørsel lejede 162 min.
- **Nøgle:** hentes fra vaulten på Trails egen secret (`SECRET_ID` i
  `runpod_train.py`). `scripts/scan-secrets.ts`: clean.
- **«Side om side med M1»:** kan ikke opfyldes som skrevet — M1 kunne ikke
  gennemføre ét træningstrin, og træning på M1 er droppet af Christian (17.1b).
  Sammenligningen er i stedet utrænet vs. trænet og 4B vs. 9B (17.1a, 17.1a2).

### 17.1b M1 kan ikke træne compile-modellen — droppet (24/9)

Målt 24/9 kl. ~01:10 med ro på M1 (4 cc-agenter, ingen andre apps): 10-trins
prøve, `mlx_lm lora`, `mlx-community/Qwen3.5-4B-MLX-4bit`, samme data og
indstillinger som Runpod (rank 8, 8 lag, max 8.192 tokens, grad-checkpoint).

- Modellen indlæses og validerings-tabet beregnes (0,841).
- Da træningen startede: fri hukommelse 66 % → 1 % på 40 s, swap næsten fuld.
  Vagten stoppede kørslen efter ~2 min — **ikke ét træningstrin gennemført.**
- Maskinen: 16 GB RAM, swap 9,8/11 GB brugt allerede før start, 18 GB fri disk.

**Christians beslutning 24/9: «vi dropper træning på m1».** Træning sker på
lejet GPU (Runpod, $2–5 pr. kørsel). M1's rolle er at KØRE Scout (inferens,
afsnit 18 / oMLX), som kræver langt mindre hukommelse end træning.
Forkastet: kortere eksempler (2.048 tokens) — ville smide de lange, fyldige
kilder ud, altså træne Scout på noget andet end opgaven; 0.8B-model — for svag.

### 17.2 Næste runde: et større og BREDERE datasæt (ejerens retning 24/9)

**Christian 24/9:** resultatet ser ikke rystende dårligt ud men potentielt
brugbart — så er vejen et langt større træningsmateriale med par mellem kilde
og Neuron, og en ny kørsel. En investering i Trail og i fremtidige
kundespecifikke modeller, ikke noget der gøres hver dag.

**Hvad datasættet ER i dag (talt i 16.1):**

| Kilde | Træningspar | Andel | Art |
|---|---|---|---|
| music (Wikipedia) | 136 | 53 % | engelsk, fast skabelon, **1 Neuron pr. kilde**, 0 entitetssider |
| scout-training-0001-v2 | 63 | 25 % | engelske Trail-planer → danske Neuroner, 2,1 Neuroner/kilde |
| scout-training-0002 | 57 | 22 % | dansk broberg.ai → dansk, 1,5 Neuroner/kilde |

Over halvdelen af det Scout har lært, er at skrive engelske musiker-biografier
efter én skabelon. Delresultaterne fra kørsel 5/6 viser mønstret man ville
forvente: hovedneuronen rammes, **begrebs-neuronerne ved siden af mangler ofte**
[sandsynlig sammenhæng, ikke bevist].

**Retning for næste runde:**
1. **Flere par** — mål [gæt] ~1.000 i stedet for 256.
2. **Bredere** — flere danske kilder af den slags Trail faktisk får: planer,
   artikler, referater, mails, PDF'er. Music skæres ned til en mindre andel.
   Kandidater: flådens egne danske dokumenter, **Sannes brain (zoneterapi-
   fagviden, 82 kilder / 239 Neuroner talt 21/9 — Neuronerne findes allerede,
   så parrene er tæt på færdige [sandsynligt]; kilderne er PDF og skal have
   tekst trukket ud først, jf. F286.9)**, Folketingets og kommunernes referater, Danish
   Dynaword, Retsinformation, spredt dansk Wikipedia.
3. **Flere Neuroner pr. kilde** i facit — de eksempler hvor læreren laver
   begrebs- og entitetssider ved siden af hovedneuronen.
4. **Facit holdes ude**, og målingen deles op pr. kilde-brain, så en høj
   music-score ikke skjuler en lav dansk score.

**Pris:** parrene laves af læreren i en interaktiv Max-session → 0 kr., men
tid. Træning ≈ $2–5 pr. kørsel (målt i aften); selv 1.000 par [gæt] under $20.

**Afventer før planen låses:** de endelige tal fra kørsel 5 og 6, inkl. den
utrænede basismodel — er den næsten lige så god, er mængde ikke svaret.

## Reuse (F286.12)

Discovery 23/9: `runpod` → 0 træffere; `gpu` → kun voice-engine (L3-domæne,
ikke en pakke). Intet `@broberg/*` dækker GPU-leje. Voice-engines
`services/forwarder/lejer.py` er mønsteret; bliver det brugt af et tredje repo,
er den rigtige vej at løfte det til components som en pakke — ikke at kopiere.

## 18. F286.13 — at KØRE Scout: M1 lokalt mod vLLM på Runpod (en OPTION)

**Christians ord 23/9:** «det er BLOT en option lige som voice-engine er en
option til at afvikle transkription på en hurtig cloud GPU, så kunne en vLLM
med vores egen (egne) modeller være en ide til kundespecifikke løsninger. Vi
starter med at teste Scout træning på Runpod og derefter kan vi afprøve
afvikling (inferens) på m1 og i vLLM hos Runpod.»

**Rækkefølgen er hans og bindende:** F286.11 (træning M1) → F286.12 (træning
Runpod) → DETTE kort. Intet her startes før der findes en trænet adapter.

**Hvad Runpods vLLM-worker kan (læst 23/9 i Runpod Hub, worker-vllm v2.27.1,
vLLM 0.28.0):**
- Serverless endpoint, pr. sekund, auto-skalering. Svarer i OpenAI-format
  (`/openai/v1/chat/completions`) OG Anthropic Messages-format
  (`/openai/v1/messages`) — det sidste er værd at kende, fordi flådens egne
  værktøjer taler det.
- Model via `MODEL_NAME` (HF-repo eller mappe), `MAX_MODEL_LEN`,
  `QUANTIZATION`. Alle andre vLLM-flag sendes igennem som store-bogstavs
  env-vars eller `VLLM_EXTRA_ARGS` — **siden nævner LoRA eksplicit som noget
  der virker ad den vej**, så en adapter kan serveres uden først at flette den
  ind i modellen [skal efterprøves].
- Alternativt: «Load Balancer»-endpoint med det officielle
  `vllm/vllm-openai`-image — ingen kø, en forespørgsel under kold start giver
  FEJL i stedet for at vente, så klienten skal prøve igen.

**Hvad der skal måles, side om side:**
- svartid pr. kilde (median, p90) og tid til første token — M1 (mlx-lm) mod
  vLLM på Runpod, samme adapter, samme 47 facit-kilder;
- pris pr. kompileret kilde i kr. (Runpod) mod 0 kr. (M1);
- kold start: hvor længe venter den første forespørgsel efter pause;
- at output er IDENTISK nok til at kvaliteten ikke flytter sig mellem de to
  (samme eval_compile-metrikker).

**Hvorfor det er interessant ud over Scout:** kundespecifikke modeller — en
kunde får sin egen adapter, serveret fra et EU-endpoint der kun kører når der
er arbejde. Det er IKKE besluttet; det er det dette kort skal give tal til.

**Åbne spørgsmål der skal besvares med målinger, ikke antagelser:**
1. Kan et serverless endpoint låses til EU-datacentre som pods kan?
   (Voice-engines EU-lås gælder pods; for serverless er det ikke læst.)
2. Kan Qwen3.5-4B + vores adapter indlæses af vLLM 0.28 uden at flette?
3. Hvordan kobles det på `@broberg/ai-sdk` — som OpenAI-kompatibel provider
   med egen base-URL — uden at gå udenom SDK'et (husreglen)?

**Non-goals:** ingen produktionstrafik; intet kunde-endpoint; ingen
beslutning om kundespecifikke modeller — kun tal til den.

### 18.1 oMLX som lokal inferens-kandidat på M1

**Christians ord 23/9:** «skriv ind i planen at vi skal teste oMLX til
inferens.»

[oMLX](https://github.com/jundot/omlx) er en MLX-baseret inferens-server til
Apple Silicon (ikke et træningsværktøj — træning på M1 forbliver `mlx-lm`).
Dens kerne er **genbrug af et fælles prompt-præfiks**: KV-cachen gemmes i
blokke i RAM og på SSD, så en forespørgsel der starter som den forrige ikke
skal regne præfikset forfra — også efter en genstart. Brugere melder tid til
første token fra 30–90 s ned til 1–3 s på lange kontekster [deres tal, ikke
målt af os].

**Hvorfor det rammer os præcist:** compile-prompten har et langt, fast præfiks
(de 9 trin, tag-vokabularet, entitetslisten) og kun kilden skifter. Det er den
situation oMLX er bygget til — både for Scout i drift og for eval_compile's 47
facit-kilder.

**Skal måles, ikke antages:**
1. Kan oMLX indlæse Qwen3.5-4B/9B **med vores LoRA-adapter** uden at flette?
   Kan den ikke, er det et fletningstrin før hver ny adapter.
2. Tid til første token og samlet tid pr. kilde: oMLX mod ren `mlx-lm` på M1,
   samme adapter, samme 47 facit-kilder — og mod vLLM på Runpod (ovenfor).
3. Output-kvalitet uændret (samme eval_compile-metrikker) — cachen må ikke
   ændre hvad modellen skriver.
4. Kan den tale til `@broberg/ai-sdk` som OpenAI-kompatibel provider (husreglen)?

### 18.2 Hvem kompilerer hvad i drift — Scout til bulk, Mistral til enkeltkilder

**Christians beslutning 23/9:** «vi skal anvende Scout (hvis brugbar) til bulk
sources der er samlet af en kunde og Mistral til drop-vise sources.»

| Situation | Kompileres af | Hvorfor |
|---|---|---|
| **Bulk:** en kunde afleverer en samlet mængde kilder (arkiv, eksport, en mappe) | **Scout** på lejet GPU — lej, kør alt, luk | Pr.-time-pris spredt over mange kilder |
| **Drop-vis:** én kilde her og der i løbet af dagen | **Mistral** (`mistral-small-latest`, cloud-ingest som i dag) | Ingen tomgang, ingen opstartstid |
| Scout er usikker på en kilde (også i bulk) | **Mistral** (nødudgang) | Kvaliteten falder ikke |

**Grundlaget (ballpark 23/9):**
- Mistral, **målt** (F199.10): $0,015 for 1 side · $0,019 for 3 sider ·
  $0,044 for en 15-siders PDF → ca. 10–30 øre pr. kilde. Betaler kun pr. kilde.
- Scout på vLLM hos Runpod, **ikke målt**: kortet koster pr. time
  (A40 ≈ $0,49/t, L40S ≈ $1,09/t) uanset last, opstart 5–10 min
  (voice-engines måling). Med samtidige forespørgsler [gæt] 100–500 kilder/time
  → 1–3 øre pr. kilde. Tændt døgnet rundt ≈ $12/døgn uanset antal.
- 1.000 kilder: Mistral ≈ $20–45 · Scout i én bulk-kørsel ≈ $2–5 [gæt].
- Konsekvens: ved nuværende volumen er besparelsen få hundrede kroner om
  måneden. Scouts værdi er lige så meget egen model, EU/eget jern,
  kundetilpasning og en pris der ikke vokser med kundens volumen.

**Forudsætning:** «hvis brugbar» — reglen træder først i kraft når Scouts
eval_compile-tal på facit-sættet er gode nok, og andelen der sendes videre
til Mistral er målt. Indtil da kompilerer Mistral alt i cloud (og Max-sessionen
lokalt, $0), som i dag.

**Skal afgøres senere, med tal:** hvor stor en mængde der tæller som «bulk»
(tærsklen hvor en GPU-time er billigere end Mistral pr. kilde — [gæt] omkring
25+ kilder i én portion).

**Kandidat til drop-vis: Runpod Serverless (skal måles).** Christian 23/9 pegede
på Runpod Serverless (skalerer til nul, betaling pr. sekund, ingen tomgang).
Priser læst 23/9 på runpod.io/pricing (flex): A40/A6000 48 GB $0,00034/s ·
L40S 48 GB $0,00049/s · A100 80 GB $0,00076/s. Runpods egen beregner er
«kilder × sekunder × pris/s» — **den medregner ikke kold start.**

Scout 4B på A40, sekunder pr. kilde er et gæt (20–60 s):

| Kilder/dag | Scout 20 s | Scout 60 s | Mistral (målt 10–30 øre) |
|---|---|---|---|
| 10 | ~$2/md. | ~$6/md. | ~$4,5–13/md. |
| 100 | ~$20/md. | ~$61/md. | ~$45–130/md. |
| pr. kilde | ~5 øre | ~14 øre | 10–30 øre |

**Den ubekendte er kold start.** Runpod lover opstart «på 250 ms» for en
worker der allerede har modellen; ellers skal ~8 GB indlæses [gæt 30–90 s,
+1–3 cent pr. kold kilde, hvis tiden faktureres — ikke oplyst på prissiden].
- Varm (kilder tæt efter hinanden): Scout serverless 2–5× billigere end Mistral.
- Kold (én kilde, så pause): ≈ samme pris som Mistral, og ~1 min længere ventetid.

**Skal måles før serverless kan erstatte Mistral på drop-vise kilder:** kold
start-tid og om den faktureres; sekunder pr. kilde for Scout på vLLM-workeren;
EU-lås på et serverless-endpoint (åbent spørgsmål 1 i afsnit 18).

### 18.3 Større model = dyrere inferens — hvor langt op giver mening

**Christians spørgsmål 23/9:** eksploderer prisen for inferens hvis vi træner
en rigtig stor open source-model? Svar: den stiger trinvist, ikke eksplosivt —
men Scouts prisfordel mod Mistral forsvinder hurtigt. [Alt nedenfor er gæt
indtil målt.]

| Model | Kort | Pr. kilde i bulk [gæt] |
|---|---|---|
| Qwen3.5-4B | 48 GB | 1–3 øre |
| Qwen3.5-9B | 48–80 GB | 2–6 øre |
| Qwen3.5-27B | 80 GB | 5–15 øre — på højde med Mistral (10–30 øre, målt) |
| Qwen3.5-122B-A10B | flere kort | dyrere end Mistral |

**Undtagelsen: mixture-of-experts.** Qwen3.5-35B-A3B har 35B parametre men
bruger kun ~3B pr. token → hastighed og pris tæt på 4B, viden fra en langt
større model. Kræver dog 80 GB hukommelse at ligge i. **Den er næste kandidat
hvis 9B ikke måler god nok.**

**Hvad der trækker ned ud over prisen:**
- Store kort er knappe — 23/9 var der NUL ledige 80 GB-kort i EU.
- Større model = længere kold start (flere GB at hente pr. opstart).
- M1 kan kun køre de små lokalt; «gratis på eget jern» forsvinder opad.

**Regel:** gå kun op i størrelse når målingen viser at den mindre ikke er god
nok. Scouts pointe er den MINDSTE model der kan opgaven.

## Reuse (F286.13)

Discovery 23/9: intet `@broberg/*` for model-servering. `@broberg/ai-sdk`
er integrationspunktet (planens afsnit 8): endpointet skal ind som provider
dér, ikke som et rå `fetch`.

## 19. F286.15 — det danske træningssæt: 2.500 kilder, 100 % dansk output

**Christians retning 24/9:** «Vi har 98 % fokus på dansk og danske kunder så
hvorfor ikke lave en 100 % dansk trænet scout — det er jo konceptet der er
interessant: at få den trænet i at compile Neuroner meget billigt for os.»
Mål: **2.500 kilder**. Valgt: **kun den danske vej** (se forkastet nedenfor).

**Hvorfor:** kørsel 5/6 (17.1a, 17.1a2) viste at Scout rammer 96 % på engelske
music-biografier men kun 19 % dækning på dansk → dansk, og at 9B ikke løser
det. Flaskehalsen er data: 57 af 256 par var dansk → dansk.

### Sammensætning

| Kilde → Neuron | Andel | Hvorfor |
|---|---|---|
| dansk → dansk | ~90 % | Det danske kunder sender |
| engelsk → dansk | ~10 % | Danske kunder dropper også engelske PDF'er/manualer |
| engelsk → engelsk | 0 % | Music-biografierne udgår |

**Kilder, i prioriteret rækkefølge:**
1. **Sannes brain** — zoneterapi-fagviden, ingen patientdata (Christian 24/9,
   17.1). 82 kilder / 239 Neuroner talt 21/9; kilderne er PDF og skal have
   tekst trukket ud først (F286.9).
2. **Flådens egne danske dokumenter** — plan-docs, referater, breve,
   webhouse.dk / broberg.ai.
3. **Folketinget (ft.dk åbne data)** — referater, betænkninger, lovforslag.
4. **Kommunale dagsordener og referater.**
5. **Danish Dynaword** (Hugging Face) — plukket efter genre, ikke i bulk.
6. **Retsinformation** og **spredt dansk Wikipedia** — små andele.

Genren skal ligne det Trail får: planer, referater, rapporter, artikler, PDF'er.
Ingen enkelt skabelon må dominere (music-fælden).

### Sådan

- **Facit først:** ~150 danske facit-kilder udtages FØR træningspar laves og
  bruges aldrig til træning. I dag er kun 11 danske i facit — for få til at
  måle sikkert.
- **Læreren** kompilerer i interaktive Max-sessioner (0 kr.). Tiden er den
  reelle pris: [gæt] 1–3 min pr. kilde → 40–125 sessionstimer. Måles på de
  første 100 før der loves en dato.
- **Etaper med måling:** træn og mål ved 500, 1.000 og 2.500 par. Flader
  dansk dækning ud, stoppes der; stiger den stadig ved 2.500, går vi højere.
- **Token-loft:** dansk fylder flere tokens end engelsk. Andelen af kilder der
  rammer 8.192-loftet måles ved datasæt-bygningen, ikke under træningen.
- **Træning:** Runpod, `--anywhere` (intet persondata). Pris [gæt ud fra
  kørsel 5]: 12–15 t på L40S ≈ $15–20 for 2.500 par.

### Non-goals

- Ingen engelsk Scout med oversættelseslag (forkastet, se nedenfor).
- Ingen persondata i datasættet. Findes der persondata i en kilde, er den ude.
- Ingen ny modelstørrelse — 4B (17.1a2).

### Forkastet

- **Engelsk Scout + oversættelse til dansk** (Christians spørgsmål 24/9):
  kilderne er danske alligevel, så kun output-sproget skifter; fagord, navne og
  titler slides i en rundtur dansk → engelsk → dansk, og titler skal være ens
  for at links holder; et ekstra oversættelsestrin koster enten et Mistral-kald
  pr. Neuron eller en model mere. Christian 24/9: «Kun den danske del.»
- **Blandet sprog som i dag (53 % engelsk music):** lærer Scout noget ingen
  kunde beder om.

**Engelsk senere:** Christian 24/9: «Virker konceptet er det jo nemt at
replikere til en ren engelsk scout model.» Samme pipeline og måling, kun
datasættet skiftes — en selvstændig kørsel, ikke en blanding.

## Reuse (F286.15)

Intet nyt: samme træningsvej (`runpod_train.py`, `remote_train.py`), samme
måling (`eval_compile`, `score_by_brain.py`), samme lærer-flow som F286.10.
