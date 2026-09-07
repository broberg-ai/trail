# F263 — Trail Ambient bliver den lokale motor

> **Ejeren, 7. september 2026 — den beslutning der omskrev kortet:**
> *«Ja planen skal omskrives så vi bruger ambient. Det er tosset at have to
> visuelle trail apps på den samme maskine, og jeg tænker sagtens at der kan
> komme mere til i en senere version af trail — så det skal køres sammen så vi
> bare har 1 app på Mac.»*

**Der bygges ikke et nyt program. Trail Ambient — som allerede står i
menulinjen, allerede er parret med skyen og allerede har en konto — lærer at
tage et kompilerings-job og køre det.**

Det er ikke en forenkling af planen. Det er en *anden* plan: forskellen mellem
«byg en arbejder og pak den ind i en menulinje» og «den menulinje der findes,
mangler ét stykke arbejde».

## Hvorfor én app, og ikke to

To ikoner i menulinjen der begge hedder Trail er ikke to funktioner — det er et
spørgsmål brugeren skal svare på hver gang han kigger op: *hvilken af dem er
det?* Og de ville dele alt det dyre: parringen, kontoen, nøglen i Keychain,
opdateringen, signeringen, TCC-tilladelserne. To kopier af det er to steder en
rettelse skal huskes.

Ejeren siger samtidig at der **kommer mere til**. Det gør beslutningen større
end dette kort: Trail Ambient er fra i dag **Trails ene lokale program på
Macen**, og næste lokale funktion lander også dér. Skrevet ind i
beslutningsregistret, så en fremtidig session ikke foreslår app nummer to.

## Hvad der ALLEREDE findes i Ambient — målt, ikke husket

Målt 7. september 2026 i `apps/ambient-capture/` (4.706 linjer Swift, appen
kører som pid 1014 mens dette skrives):

| stykke | fil | tilstand |
|---|---|---|
| menulinje-app uden dock-ikon | `AppDelegate.swift` (344 l.), `LSUIElement` | ✅ kører |
| **parring med skyen** | `DeviceAuth.swift` (204 l.) — kode-parring, token i Keychain | ✅ virker |
| konto + tenant + videnbase i menuen | `AppDelegate.buildMenu()` | ✅ vises |
| **kald til sky-API'et med Bearer** | `TrailClient.swift` (217 l.) — søg, chat, kandidater | ✅ virker |
| pause/genoptag, login-item, selvtest | `LoginItem.swift`, `SelfTest.swift` | ✅ |
| signeret bundle + distribution | `scripts/bundle.sh` | ✅ |
| gentagne baggrundsopgaver | `PromptMode.swift` poller hvert sekund | ✅ mønstret findes |
| **at starte et andet program** | `Process()` kun i to *test*-filer | ⚠️ aldrig gjort i drift |

**Den afgørende måling: appen er IKKE sandkasset.** `codesign -d
--entitlements` på den kørende app giver præcis ét flag —
`com.apple.security.device.audio-input`. Ingen `app-sandbox`. Den må altså
starte `claude` som underproces. Hardened runtime er slået til, men den spærrer
for at *indlæse* usignerede biblioteker, ikke for at *starte* et andet program.

Havde appen været sandkasset, var hele dette kort en anden opgave. Det er den
ikke — og det er målt frem for antaget, fordi netop dét ville have været den
dyre overraskelse midt i F263.3.

## Hvad der så mangler

Kun ét stykke: **arbejder-løkken.**

```
                                       Trail Ambient (menulinjen, én app)
    app.trailmem.com                    ┌──────────────────────────────┐
    ┌──────────────┐                    │ ✅ parret · ✅ token · ✅ menu │
    │ kilde droppes│                    │                              │
    │      ↓       │  1. claim (lease)  │  ⬜ claim job         (F263.3)│
    │   JOBKØ  ✅  │ ←───────────────── │      ↓                       │
    │      ↓       │  2. hjerteslag     │  ⬜ start `claude`    (F263.3)│
    │  motor       │ ←───────────────── │      ↓                       │
    │  (fallback)  │  3. resultat op    │  ⬜ send resultat op  (F263.3)│
    └──────────────┘ ←───────────────── └──────────────────────────────┘
```

Den lokale side **ringer OP**. Ingen indgående forbindelse, ingen port at åbne,
intet certifikat — og det er også svaret på ejerens oprindelige spørgsmål om
browseren kunne tale direkte med den lokale server (se afsnittet nedenfor).

## Den selvstændige server — udskudt, ikke droppet

Ejeren sagde 6. september, en dag før beslutningen ovenfor:

> *«webserveren og hele Claude Code setuppet sat op selvstændigt er selvfølgelig
> et must»*

**De to udsagn trækker hver sin vej, og det skal stå her frem for at blive
glattet ud.** Én app på Macen mod en motor der kan køre uden en Mac.

Sådan er de forenet i dag:

- **Den selvstændige vej FINDES allerede og røres ikke:** `/local-ingest`-skillen
  i en cc-session er præcis «webserver + Claude Code sat op selvstændigt». Den
  kompilerede fem kilder i aftenen 6/9 og to mere den 7/9 — gennem den nye kø.
  Den er ikke en midlertidig krykke; den er den headless arbejder.
- **Ambient bliver den samme arbejder med et ansigt.** Begge claimer fra samme
  kø gennem samme endepunkt. Ingen af dem er en kopi af den anden, fordi
  *køen* er kontrakten — ikke koden.
- **Et tredje artefakt bygges ikke nu.** En separat daemon ville være en tredje
  ting der skal signeres, opdateres og fejlsøges, til gavn for nul brugere: i
  dag er der én bruger, og han har en Mac.

Ændrer det sig — en kunde med en Linux-maskine, en server der skal kompilere om
natten — er vejen kort, netop fordi arbejder-løkken bygges mod køens HTTP-flade
og ikke mod noget Mac-specifikt. Det er derfor F263.3's krav siger *«løkken må
ikke afhænge af AppKit»*.

## Ambient kompilerer IKKE selv — den sætter en ægte session i gang

> **Ejeren, 7. september 2026:** *«Ambient må på INGEN måde afvikle CC som -p —
> men det ved du godt. Den skal køre i denne session eller en headless session
> spawned the Cardmem way.»*

**Det retter en fejl i denne plans egen første udgave.** F263.3 sagde at Ambient
skulle «køre prompten gennem Claude Code», og pegede på at appen ikke er
sandkasset og derfor må starte `claude` som underproces. Den korteste vej fra
den sætning er `claude -p` — og **den vej er API-betalt.**

Det ville have ødelagt kortets eget formål. Hele F263 findes for at kompilere
til **$0** på Max-abonnementet. En underproces der fakturerer pr. token er ikke
en billigere motor; det er den dyre motor med en menulinje foran.

### Arbejdsdelingen

```
   Ambient                          en ÆGTE interaktiv cc-session (Max, $0)
   ┌─────────────────┐              ┌──────────────────────────────┐
   │ ser arbejde i køen             │                              │
   │ viser det i menuen             │                              │
   │ TÆNDER LYSET  ────────────────►│ claimer selv fra køen        │
   │                 │              │ kompilerer                   │
   │ (rører aldrig et job)          │ afleverer op                 │
   └─────────────────┘              └──────────────────────────────┘
```

**Ambient claimer ikke.** Sessionen claimer selv gennem F263.1's kø, så leasen
og arbejdet ligger samme sted. En reservation der holdes af én proces mens en
anden laver arbejdet, er to steder en fejl kan opstå — og det er præcis den
fejlklasse F263.1's review lige har lukket.

### Det er ikke et nyt design — det er kæden der allerede kører

```
buddy-probe hvert 120. sek  →  «/local-ingest broberg-ai»  →  sessionen claimer  →  kompilerer  →  $0
```

Syv kilder gik gennem den kæde 6.–7. september. **Ambient overtager kun rollen
som den der opdager arbejdet og starter sessionen**, så kæden ikke afhænger af
at buddy poller — og så der er et ansigt på den.

### Spærren er en test, ikke denne sætning

Repoet har allerede `spawnClaude` i sky-motoren (`apps/server/src/services/claude.ts`
og de to CLI-backends). Den kode er lovlig dér og må **ikke** kopieres ind i
Ambient eller arbejder-stien. En prøve skanner efter `claude -p`, `--print` og
`spawnClaude` og bliver rød hvis nogen tilføjer dem — mutations-bevist, ellers
er den kun en påstand om sig selv.

## Ambient får sin egen webflade — to steder at aflevere, ét sted der kompilerer

> **Ejeren, 7. september 2026:** *«Jeg tænker også at du kan køre webserveren ind
> i samme app som bare har en port, så du i Ambient kan lave det UI-interface som
> den lokale server gør i dag. Så har vi to måder at uploade kildefiler — både på
> app i skyen der connecter til Ambient, og i Ambient der er connectet til skyen.
> Så når vi i app vælger at anvende Ambient som ingest-motor, så er det lige
> meget hvor vi smider kilderne ind henne, så kører de altid på Mac og $0-planen.»*

**Hvor kilden afleveres, og hvem der kompilerer den, er to uafhængige valg.**
Det er hele idéen, og den er rigtig.

```
      DROP HER                    ELLER HER
   app.trailmem.com          Ambient → localhost:PORT
          ↓                            ↓
          └──────────→ JOBKØEN ←───────┘
                          ↓
              ⚙️  motor-valget afgør resten
                 ┌────────┴────────┐
            Ambient ($0)      skyen (betalt)
```

### Det koster næsten ingenting, og det er målt

Ingest Station (`apps/ingest-station/`, fire kildefiler) er **allerede bygget
til at blive serveret fra en lokal port.** Fra dens egen fil, ordret:

> *«Auth er en personlig `trail_`-nøgle brugeren indsætter én gang; vi sender
> den som `Authorization: Bearer`, og Vite proxyer `/api` til sky-admin. Ingen
> cookies, ingen CORS (same-origin localhost via dev-proxyen).»*

Det er præcis den form Ambient skal bruge: serve det byggede bundle på en port,
proxy `/api` videre til skyen. **Ingen omskrivning, ingen CORS-arbejde, ingen
cookie-problemer** — fordi der aldrig var cookies.

Og siden er nu **first-party på den lokale port**, så blandet-indhold-spærren
findes slet ikke her. Det er forskellen på denne idé og den forkastede: en
https-side i skyen må ikke hente `http://127.0.0.1`, men en side der ER
localhost må gerne tale med localhost.

### Den ene ting der bliver BEDRE end i dag

I dag skal man indsætte en `trail_`-nøgle i Station-fladen manuelt. Ambient har
allerede et token i Keychain fra parringen. **Den lokale server kan sætte
Bearer-headeren selv**, så nøglen aldrig skal kopieres rundt eller ligge i en
browsers localStorage. Færre steder en nøgle kan ligge er den slags forbedring
der ikke ligner en feature.

### Det der IKKE ændrer sig, og hvorfor

**En kilde afleveret lokalt sendes stadig OP i skyen.** Det lyder omvendt, men
er den rigtige vej: videnbasen er skyens, og gør vi det modsatte — kompilerer
lokalt og sender kun Neuronerne op — så findes råkilden aldrig i skyen. Så kan
den ikke vises i kildelisten, ikke kompileres igen senere, og sporet af hvem der
lavede hvad brydes.

**Filen op, kompileringen ned.** Det er også præcis sådan det fungerer i dag, så
det er ingen ny omkostning — kun en der skal siges højt, fordi en stor fil
gennem en tynd forbindelse er det man ville have gættet vi undgik.

## Hvem det er til, og hvornår

> *«nu er det også primært mig der kommer til at anvende trail til Ingest her i
> starten — når jeg for alvor slipper det løs til kunderne skal de selv betale
> for Ingest og skal oprette en konto med eget credit card til vores EU provider
> og indtaste en API nøgle (det kan og skal man ikke endnu)»*

| | |
|---|---|
| **nu** | én bruger — ham — kompilerer gratis på sit eget Claude Code-abonnement |
| **senere** | kunder betaler selv: egen konto hos vores EU-udbyder, eget kort, egen API-nøgle |
| **ikke nu** | **kunde-API-nøgler bygges IKKE i dette kort.** Eksplicit non-goal |

## Kan browseren tale direkte med den lokale app?

Ejerens oprindelige spørgsmål, og det fortjener et præcist svar frem for et ja.

**Direkte fra siden: nej.** `app.trailmem.com` kører over https, og en https-side
må ikke hente `http://127.0.0.1:…` — browseren blokerer det som blandet indhold,
uden at spørge. Vejene udenom koster alle noget: et certifikat til en
localhost-adresse, en tunnel, eller en tjeneste i midten.

**Derfor ringer den lokale side OP i stedet.** Resultatet er dét ejeren bad om —
en kilde droppet på app.trailmem.com bliver kompileret gratis på hans egen
maskine — bare uden en eneste indgående forbindelse. Fladen viser hvilken motor
der kørte (F263.4), så forskellen er synlig frem for skjult.

## Forskellen fra F146 — og hvorfor det ikke er en dublet

[F146](F146-local-first-native-app-sync.md) findes med plan-doc og seks stories.
Den er noget andet:

| | F146 | F263 |
|---|---|---|
| hvor data bor | **lokalt**, CRDT-synkroniseret | **skyen**, uændret |
| hvad det lokale er | hele Trail i et vindue | en regnekraft-**arbejder** |
| det svære problem | konfliktfri fletning af to skrivende kopier | en jobkø med lease |
| hvis det lokale er væk | brugeren har stadig sin lokale Trail | skyen kompilerer selv |
| modenhed | Yjs-relay, ikke påbegyndt | **kører i dag** |

F263 nedlægger ikke F146. Den leverer den **billige del af værdien** uden at
røre datamodellen. Og efter beslutningen ovenfor gælder: skulle F146 en dag give
Macen en lokal Trail, hører den også hjemme i **Ambient**, ikke i app nummer to.

**Non-goals, eksplicit:** ingen CRDT, ingen lokal database, ingen offline-Trail
(alt det er F146's) · **ingen kunde-API-nøgler** · **intet nyt Mac-program** ·
**intet `claude -p`** — den vej er betalt, og $0 er hele grunden til kortet.

## Hvad der var galt med mekanismen i dag

Den gamle vej var et **flag**, ikke en kø. Hver af disse er et rigtigt hul, målt:

1. **Ingen lease.** To arbejdere ville tage samme kilde.
2. **Ingen arbejder-identitet.** Skyen kunne ikke svare på «er der nogen hjemme?»
   — som er præcis det menulinjen skal vise.
3. **Ingen genoptagelse.** Døde arbejderen midt i et job, stod flaget for evigt.
   Fem testfiler fra 4. juni lå parkeret i tre måneder af den grund.
4. **Ingen sondring mellem «venter» og «arbejder».**
5. **Buddy var i kæden uden at eje den** — en probe hvert 120. sekund.

**Løst i F263.1**, udrullet 6. september (`deaedc6`): claim med lease,
hjerteslag, tenant-isolation, og de gamle endepunkter urørte ved siden af.

Reviewet af den fandt oveni en ægte fejl: reservationen blev sat, men aldrig
sluppet igen, så en kilde der blev kompileret og derefter parkeret på ny var
usynlig for enhver arbejder i op til fem minutter. Rettet i samme runde.

## Stories

| | | |
|---|---|---|
| **F263.1** | Jobkøen: claim / hjerteslag / lease | ✅ **udrullet 6/9** |
| **F263.2** | Ambient melder sig som ARBEJDER — og skyen kan se hvem der er hjemme | næste |
| **F263.3** | Ambient sætter kompileringen i gang i en ægte cc-session — ALDRIG `claude -p` | **kernen** |
| **F263.4** | Fladen viser hvilken motor der kørte | |
| **F263.5** | Ærlig fallback: ingen arbejder → skyen tager den, synligt | |
| **F263.7** | Ambients egen webflade på en lokal port — den anden afleverings-vej | |

**F263.6 er nedlagt.** Den hed «Mac-menubar som indpakning af den lokale motor»
og forudsatte at motoren var et selvstændigt program der skulle pakkes ind.
Efter beslutningen ER menulinjen stedet motoren bor, så indpakningen har intet
at pakke — den er absorberet i F263.3.

**F263.2 er skrumpet.** Den skulle bygge parring fra bunden. Parringen findes
(`DeviceAuth.swift`), så det der er tilbage er den halvdel skyen mangler: at en
parret maskine også er synlig som *arbejder* med et hjerteslag, så «er der nogen
hjemme?» kan besvares.

## Reuse

Discovery gennemsøgt for «job queue worker», «daemon relay», «menubar mac app»,
«device pairing» — **nul træf**, og ingen af de 49 `@broberg/*`-pakker dækker en
job-relay. Køen er tæt på Trails egen datamodel og hører hjemme i motoren.

Genbruges derimod — og efter omskrivningen er det hele pointen frem for en note:

- **`apps/ambient-capture/`**: parring, Keychain-token, konto-menu, signeret
  bundle, login-item, selvtest. Alt sammen bygget, alt sammen i drift.
- **`/local-ingest`-skillen**: den virkende arbejder-adfærd. F263.3 oversætter
  dens forløb til Swift frem for at opfinde et nyt.
- **`apps/ingest-station/`**: fladen genbruges ORDRET som Ambients lokale UI
  (F263.7). Den er allerede bygget til en localhost-port med Bearer-auth og
  ingen cookies — der er ikke noget at skrive om.
- **`upmetrics-swift`** til fejlrapportering fra appen (flådens SPM-pakke).

## Rollout

Ship dark, som F263.1 landede: køen lever ved siden af `awaiting_local_compile`
indtil Ambient beviseligt drænner den. **Ingen naken omlægning** — den
cc-session-drevne vej slukkes først når afløseren er bevist i drift, og den
forbliver den headless mulighed derefter.
