# F263 — Trail Mac Client

> **Ejeren, 6. september 2026:** *«Lav Trail Local Ingest Server om til et native
> Mac program, der kan tilkobles en Claude Code konto der kan stå for Ingest &
> Compile på kontoens normale abonnement … Hvis nu Mac klienten fungerer som en
> slags daemon når den er åben, så det online job automatisk relayes "ned" til
> den lokale maskine for billig ingest/compilation.»*

## Det findes allerede — som en håndkørt udgave

Det her er ikke en idé uden præcedens. Det er automatiseringen af noget der
**kørte i produktion i aften**, elleve gange:

```
buddy-dispatch → «/local-ingest broberg-ai» → cc-sessionen kompilerer → flag ryddes
```

Fem kilder blev kompileret sådan mellem kl. 19 og 23, gratis, på Max-abonnementet.
Kortet handler om at gøre den løkke til et program frem for en cc-session der
tilfældigvis er åben.

**Derfor er den vigtigste designbeslutning allerede taget og afprøvet:** skyen
beholder motoren og sandheden, og den lokale maskine er en *regnekraft-arbejder*.
Ikke en kopi af systemet.

## Forskellen fra F146 — og hvorfor det ikke er en dublet

[F146](F146-local-first-native-app-sync.md) findes med plan-doc og seks stories.
Den er noget andet:

| | F146 | F263 |
|---|---|---|
| hvor data bor | **lokalt**, CRDT-synkroniseret til skyen | **skyen**, uændret |
| hvad Mac-appen er | hele Trail i et vindue | en regnekraft-**daemon** |
| det svære problem | konfliktfri fletning af to skrivende kopier | en jobkø med lease |
| hvis appen er lukket | brugeren har stadig sin lokale Trail | skyen kompilerer selv |
| modenhed | Yjs-relay, ikke påbegyndt | **kører håndkørt i dag** |

F263 nedlægger ikke F146. Den leverer den **billige del af værdien** — gratis
kompilering på eget abonnement — uden at røre datamodellen. Vælger vi senere
F146, er F263's jobkø stadig rigtig; det er den vej arbejdet flyder.

**Non-goal, eksplicit:** ingen CRDT, ingen lokal database, ingen offline-Trail.
Alt det er F146's.

## Hvad der er galt med mekanismen i dag

Den nuværende vej er et **flag**, ikke en kø:

```
GET /api/v1/documents?awaitingLocalCompile=true   → en liste
POST /api/v1/documents/:id/local-compiled         → ryd flaget
```

Målt i aften, og hver af dem er et rigtigt hul:

1. **Ingen lease.** To arbejdere ville tage samme kilde. I dag er der én
   cc-session, så det har ikke gjort skade endnu — men det er en egenskab ved
   antallet, ikke ved designet.
2. **Ingen arbejder-identitet.** Skyen ved ikke hvem der arbejder, eller om nogen
   gør. Den kan ikke svare på «er der en maskine tilsluttet?» — som er præcis det
   PWA'en skal vise.
3. **Ingen genoptagelse.** Dør arbejderen midt i et job, står flaget for evigt.
   Der er intet der tager det tilbage.
4. **Ingen sondring mellem «venter» og «arbejder».** Ingest Station viser det
   samme i begge tilstande.
5. **Buddy er i kæden uden at eje den.** Dispatch-jobbet prober hvert 120. sekund
   og sender en intercom. Det virker, men Trail kan ikke selv sige «kom og hent».

## Arkitektur

```
    app.trailmem.com                          Mac-klienten
    ┌──────────────┐                          ┌──────────────┐
    │ kilde droppes│                          │ menubar-agent│
    │      ↓       │   1. claim (lease 5 min) │      ↓       │
    │   JOBKØ      │ ←──────────────────────  │  hent job    │
    │      ↓       │   2. heartbeat           │      ↓       │
    │  motor       │ ←──────────────────────  │ claude -p    │
    │  (fallback)  │   3. complete + resultat │      ↓       │
    │              │ ←──────────────────────  │  send op     │
    └──────────────┘                          └──────────────┘
```

**Skyen ejer stadig alt.** Klienten får en opgave og et prompt, kører den på
kontoens eget abonnement, og sender resultatet tilbage gennem de samme
skrive-endepunkter `/local-ingest` bruger i dag. Ingen ny skrivevej ind i basen —
det er dét der gør at alle eksisterende spærrer (publikums-filter, hemmeligheds-
scrubning, kandidat-køen) stadig gælder.

**Falder klienten væk, kompilerer skyen selv.** Det er ikke en nødløsning, det er
kontrakten: en kunde uden Mac skal have samme produkt, bare dyrere i drift.

## Stories

| | |
|---|---|
| **F263.1** | Jobkøen: claim / heartbeat / complete med lease — erstatter flaget |
| **F263.2** | Tilslutning: en maskine parres og bliver synlig for skyen |
| **F263.3** | Mac-klienten som menubar-agent, bygget på `apps/ambient-capture`s skal |
| **F263.4** | PWA'en viser hvilken motor der kører, og lader dig vælge |
| **F263.5** | Ærlig fallback: ingen arbejder inden for fristen → skyen tager den, synligt |

F263.1 er den eneste der kan bygges og bevises uden en Mac-app — og den er
forudsætningen for de fire andre. Den bygges først.

## Reuse

Discovery gennemsøgt for «job queue worker», «daemon relay», «menubar mac app»,
«device pairing» — **nul træf**, og ingen af de 49 `@broberg/*`-pakker dækker en
job-relay. Der er ikke noget at genbruge dér, og der bygges ikke en ny delt pakke
til det: køen er tæt på Trails egen datamodel og hører hjemme i motoren.

**To ting genbruges derimod, og de er begge i huset:**

- **`apps/ambient-capture/`** er allerede en Swift-menubar-agent på macOS med
  Package.swift, byggescripts og en signeret distributionsvej. F263.3 bygger
  videre på den skal frem for at starte en ny.
- **`upmetrics-swift`** (Discovery, `from: "0.1.0"`) giver fejlrapportering fra
  en Swift-klient — samme observabilitet som resten af flåden.

## Rollout

Ship dark. Jobkøen lever ved siden af `awaitingLocalCompile`-flaget indtil en
klient beviseligt drænner den; flaget fjernes først når den nye vej har kørt en
uge. **Ingen naken omlægning** — den håndkørte `/local-ingest`-vej må ikke
slukkes før dens afløser er bevist i drift.
