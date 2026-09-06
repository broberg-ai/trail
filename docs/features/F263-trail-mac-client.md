# F263 — Trail lokal motor

> **Ejeren, 6. september 2026, første formulering:** *«Lav Trail Local Ingest
> Server om til et native Mac program … Hvis nu Mac klienten fungerer som en
> slags daemon når den er åben, så det online job automatisk relayes "ned" til
> den lokale maskine for billig ingest/compilation.»*
>
> **Og præciseringen en time senere, som ændrer hvad der skal bygges:**
> *«Samtidigt håber jeg at du også så ideen med at app.trailmem.com også kan
> kommunikere med den lokale webserver hvis den er tilstede? Så man IKKE SKAL
> have en native Mac app — men at webserveren og hele Claude Code setuppet sat
> op selvstændigt er selvfølgelig et must.»*

**Kravet er den selvstændige lokale motor. Mac-appen er en indpakning af den,
ikke forudsætningen for den.** Kortet hed først «Trail Mac Client»; det er nu
«Trail lokal motor», og F263.3 er flyttet fra midten til kanten.

## Hvem det er til, og hvornår

Ejerens egne ord om rollout, og de afgør scope:

> *«nu er det også primært mig der kommer til at anvende trail til Ingest her i
> starten — når jeg for alvor slipper det løs til kunderne skal de selv betale
> for Ingest og skal oprette en konto med eget credit card til vores EU provider
> og indtaste en API nøgle (det kan og skal man ikke endnu)»*

| | |
|---|---|
| **nu** | én bruger — ham — kompilerer gratis på sit eget Claude Code-abonnement |
| **senere** | kunder betaler selv: egen konto hos vores EU-udbyder, eget kort, egen API-nøgle |
| **ikke nu** | **kunde-API-nøgler bygges IKKE i dette kort.** Eksplicit non-goal |

Det er grunden til at køen og den lokale motor kommer først: de er det der
tjener den ene bruger der findes i dag, og de er ikke spildt når kunderne
kommer — en kunde med egen API-nøgle bruger stadig samme kø, bare med skyen som
arbejder.

## Det findes allerede — som en håndkørt udgave

Det her er ikke en idé uden præcedens. Det er automatiseringen af noget der
**kørte i produktion i aften**, elleve gange:

```
buddy-dispatch → «/local-ingest broberg-ai» → cc-sessionen kompilerer → flag ryddes
```

Fem kilder blev kompileret sådan mellem kl. 19 og 23, gratis, på Max-abonnementet.

**Derfor er den vigtigste designbeslutning allerede taget og afprøvet:** skyen
beholder motoren og sandheden, og den lokale maskine er en *regnekraft-arbejder*.
Ikke en kopi af systemet.

## Kan browseren tale direkte med den lokale server?

Ejerens spørgsmål, og det fortjener et præcist svar frem for et ja.

**Direkte fra siden: nej, ikke uden besvær.** `app.trailmem.com` kører over
https, og en side over https må ikke hente `http://127.0.0.1:…` — browseren
blokerer det som blandet indhold, uden at spørge. Vejene udenom findes, og de
koster alle noget:

| vej | hvad den kræver |
|---|---|
| lokal server på https | et certifikat browseren stoler på, fornyet, pr. maskine |
| tunnel gennem et domæne | en offentlig tjeneste i midten — så er den ikke lokal |
| browserudvidelse som mellemled | endnu et program at installere og opdatere |

**Den lokale server TRÆKKER i stedet.** Den spørger skyen «har du arbejde?»,
tager det, kompilerer, og sender resultatet op. Det er samme retning som
`/local-ingest` allerede bruger, og det giver præcis den oplevelse der blev
efterspurgt: du indsender en kilde på `app.trailmem.com`, og den bliver
kompileret på din egen maskine, gratis.

**Forskellen er usynlig for brugeren og stor for os:**

- ingen certifikater, ingen porte, ingen browser-blokering
- virker når maskinen står et andet sted end browseren — telefonen kan indsende,
  Mac'en kompilerer
- er maskinen slukket, tager skyen over uden at noget hænger

Fladen siger stadig «kompileres på Christians MacBook» (F263.4). At det er
maskinen der ringer op og ikke omvendt, er en implementeringsdetalje — men det
er den detalje der gør at det overhovedet kan lade sig gøre uden en app.

## Forskellen fra F146 — og hvorfor det ikke er en dublet

[F146](F146-local-first-native-app-sync.md) findes med plan-doc og seks stories.
Den er noget andet:

| | F146 | F263 |
|---|---|---|
| hvor data bor | **lokalt**, CRDT-synkroniseret | **skyen**, uændret |
| hvad det lokale er | hele Trail i et vindue | en regnekraft-**arbejder** |
| det svære problem | konfliktfri fletning af to skrivende kopier | en jobkø med lease |
| hvis det lokale er væk | brugeren har stadig sin lokale Trail | skyen kompilerer selv |
| modenhed | Yjs-relay, ikke påbegyndt | **kører håndkørt i dag** |

F263 nedlægger ikke F146. Den leverer den **billige del af værdien** uden at
røre datamodellen.

**Non-goals, eksplicit:** ingen CRDT, ingen lokal database, ingen offline-Trail
(alt det er F146's) — og **ingen kunde-API-nøgler**, som ejeren har sagt fra om
indtil videre.

## Hvad der var galt med mekanismen i dag

Den nuværende vej er et **flag**, ikke en kø. Målt i aften, og hver af dem er et
rigtigt hul:

1. **Ingen lease.** To arbejdere ville tage samme kilde.
2. **Ingen arbejder-identitet.** Skyen kan ikke svare på «er der nogen hjemme?»
   — som er præcis det fladen skal vise.
3. **Ingen genoptagelse.** Dør arbejderen midt i et job, står flaget for evigt.
   Fem testfiler fra 4. juni har ligget parkeret i tre måneder af den grund.
4. **Ingen sondring mellem «venter» og «arbejder».**
5. **Buddy er i kæden uden at eje den** — en probe hvert 120. sekund.

**Løst i F263.1**, udrullet 6. september: claim med lease, hjerteslag,
tenant-isolation, og de gamle endepunkter urørte ved siden af.

## Arkitektur

```
    app.trailmem.com                    den lokale motor (Mac, Linux, hvad som helst)
    ┌──────────────┐                    ┌────────────────────────┐
    │ kilde droppes│                    │ webserver + Claude Code│
    │      ↓       │  1. claim (lease)  │          ↓             │
    │   JOBKØ  ✅  │ ←───────────────── │      hent job          │
    │      ↓       │  2. hjerteslag     │          ↓             │
    │  motor       │ ←───────────────── │   kompilér gratis      │
    │  (fallback)  │  3. resultat op    │          ↓             │
    └──────────────┘ ←───────────────── └────────────────────────┘
```

Den lokale side ringer OP. Ingen indgående forbindelse, ingen port at åbne,
intet certifikat.

## Stories

| | | |
|---|---|---|
| **F263.1** | Jobkøen: claim / hjerteslag / lease | ✅ **udrullet 6/9** |
| **F263.2** | Tilslutning: en maskine parres og bliver synlig | næste |
| **F263.3** | Den lokale motor som selvstændigt program (webserver + Claude Code) | **kravet** |
| **F263.4** | Fladen viser hvilken motor der kører | |
| **F263.5** | Ærlig fallback: ingen arbejder → skyen tager den, synligt | |
| **F263.6** | Mac-menubar som indpakning af F263.3 | **valgfri, sidst** |

F263.3 er omdefineret efter præciseringen: den leverer **den selvstændige lokale
server**, ikke en native app. F263.6 pakker den ind i en menulinje for dem der
vil have det — og bygges kun hvis nogen faktisk vil.

## Reuse

Discovery gennemsøgt for «job queue worker», «daemon relay», «menubar mac app»,
«device pairing» — **nul træf**, og ingen af de 49 `@broberg/*`-pakker dækker
en job-relay. Køen er tæt på Trails egen datamodel og hører hjemme i motoren.

Genbruges derimod, begge i huset:

- **`/local-ingest`-skillen** er den eksisterende, virkende arbejder. F263.3
  starter fra dens forløb frem for et nyt.
- **`apps/ambient-capture/`** (Swift-menubar, Package.swift, signeret
  distribution) er skallen til F263.6 hvis den bygges — ikke et nyt projekt.

## Rollout

Ship dark, og det er allerede sådan F263.1 landede: køen lever ved siden af
`awaiting_local_compile` indtil en klient beviseligt drænner den. **Ingen naken
omlægning** — den håndkørte vej slukkes først når afløseren er bevist i drift.
