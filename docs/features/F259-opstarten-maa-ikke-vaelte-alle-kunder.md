# F259 — opstarten må ikke lade én kundes vedligeholdelse vælte alle kunder

**Status:** shipped (6. september 2026) · **Kind:** story

## Motivation

Ejeren, 6/9: *«Kræver det en større maskine eller er koden bare rotten!»*

Svaret var koden. Produktionen lå i et nedbruds-loop.

**Målt på produktion, ikke udledt:**

```
12:17:43  åbner REMOTE tenant DB: broberg-ai
          ← 283 sekunders TAVSHED
12:22:26  Main child exited normally with code: 1
12:22:26  reboot: Restarting system              (308 s oppetid)
```

Fly-proxyen svarede `instance refused connection … 0.0.0.0:8080` i fire
minutter ad gangen. Motoren begyndte **aldrig** at lytte.

## Root cause

`bootTenant` kørte **femten opgaver i én sekventiel kæde**, i en top-level
`await` **før** `Bun.serve` — og `openTenantPool` kørte hele kæden igen for
**hver** kunde.

Tolv af de femten er idempotent vedligeholdelse (backfills, oprydninger,
kredit-påfyldning) der walker hele basen. broberg-ai har 7.217 Neuroner på den
anden side af netværket. Den hang, kastede en timeout, og **en afvist
top-level await afslutter processen i Bun**.

Så én kundes vedligeholdelse tog alle tre kunder ned. Sanne og fd-aalborg var
klar til at betjene længe før — de ventede på broberg-ai.

### Hvorfor F258 ikke reddede det

F258 (`process.on('unhandledRejection')`) blev udrullet som fixet på
nedbruds-loopet. **Den virkede ikke her.** Vagten installeres efter
`Bun.serve`, og processen døde før den nåede dertil.

> En vagt der står bag ved fejlen ser rigtig ud i koden og har ingen virkning
> i praksis.

F258 står ved magt for det den faktisk dækker — en fejning der fejler *efter*
opstarten.

## Arkitektur

Rettelsen er den **F222.3 allerede havde argumenteret for** og kun gennemført
for link-fejningerne: det der ikke er en forudsætning for at betjene, hører
ikke til før serveren lytter.

| | indhold | hvornår |
|---|---|---|
| `bootTenantEssential` | migrations · FTS · ingest-user | **før** `Bun.serve` |
| `bootTenantMaintenance` | de 12 resterende | **efter** `Bun.serve`, pr. kunde |

De tre essentielle er skema-operationer der **ikke skalerer med basens
størrelse**. Vedligeholdelsen flytter ind i `bootTenantDeferred`, som allerede
kørte pr. kunde efter serveren lytter og allerede fangede fejl uden at vælte
motoren.

`provisionTenant` beholder hele sekvensen under ét: dér er basen splinterny og
tom, vedligeholdelsen er øjeblikkelig, og en ny kunde må gerne vente på at hans
egen base er helt klar.

### Tidtagning pr. trin

De 283 sekunder var **tavse**. Loggen kunne ikke sige hvilket af femten trin
der hang, så diagnosen ville have kostet ét nedbrud pr. gæt. Hvert trin over
ét sekund skriver nu sit navn og sin tid: `[boot] broberg-ai/migrations: 4s`.

## Spærren (harness-kontrakt)

`apps/server/src/boot-order.test.ts` læser `index.ts` og går **rød** hvis en af
de tolv vedligeholdelses-opgaver kaldes før `Bun.serve`.

**Mutations-bevist:** flyttes `backfillContentHash` tilbage over `Bun.serve`,
går prøven rød og navngiver den (5 pass / 1 fail).

Prøven læser kilden **med vilje**: `index.ts` *er* opstarten, så at importere
den åbner databaser, starter timere og lytter på en port. Egenskaben der skal
bevogtes er en rækkefølge i modulets top-level, og den kan læses direkte. En
prøve der ikke kan læse det den skal bevogte, beviser noget andet.

Den har **negativ kontrol mod sig selv**: en prøve der tjekker at alle tolv
navne stadig findes i filen, så en stavefejl i listen ikke gør «ingen syndere»
grøn.

## Non-goals

- **Ikke en større maskine.** Maskinen var ikke problemet; en sekventiel kæde
  bliver ikke kortere af flere kerner.
- **Rører ikke beslutningen om at en fejlet DB-åbning skal fejle opstarten**
  (`tenant-pool.ts`). Den er bevidst og handler om ikke at falde tilbage på en
  forældet base. Det målte nedbrud lå i vedligeholdelsen, ikke i åbningen.
- Gør ikke den enkelte vedligeholdelses-opgave hurtigere. Den må tage den tid
  den tager — ingen kunde venter på den længere.

## Åbent efter denne rettelse

- **Hvilket af de tolv trin bruger de 283 sekunder?** Tidtagningen svarer på
  det ved næste opstart. Indtil da er det ikke målt.
- **Flys sundhedstjek har 5 sekunders tålmodighed.** Med vedligeholdelsen ude
  af serverings-vejen bør motoren svare hurtigt — men det skal måles, ikke
  antages.

---

## F259.5 — motoren må ALDRIG dø (ejerens ord, 6/9)

> *«Motoren må bare ikke dø. ALDRIG. Der er ingen grund til det med de 2 kunder
> vi pt. har.»*

Han havde ret på begge punkter. To kunder kan ikke belaste noget — og den
egentlige årsag var ikke datamængde, men at broberg-ais database var gået i
**baglås**: 69 tråde, 52 % af kernen brændt, 40 tråde i kø om den samme lås,
mens ingen spurgte den om noget. Målt på maskinen.

Tre huller stod tilbage efter F259.4, og hvert af dem kunne gøre én kundes
problem til alles igen:

### 1. Den primære kunde var stadig dødelig
F259.4 gjorde en SEKUNDÆR kundes base ufarlig. Den primære stod stadig i en
top-level await. Gik Sannes base i baglås, døde motoren — og fd-aalborg var
nede af en grund der intet havde med dem at gøre.

Den primære er ikke særlig for betjeningen: auth slår kunden op i **puljen**
(`pool.get(slug) ?? null`, miss ⇒ fejl), så `trail` er kun en standardværdi der
altid overskrives. Mangler den, betjenes resten videre.

### 2. Sundhedstjekket ville genindføre fejlen ad bagdøren
Ruten spurgte den PRIMÆRE base. Var den ude af drift mens to andre kunder blev
betjent fint, svarede den 503 → Fly erklærer motoren død → genstart → de to
raske kunder er nede.

**Sund betyder nu «jeg kan betjene nogen», ikke «den primære lever».** Mindst
én kunde i puljen der svarer = 200. Ingen = 503. `tenants.up/down` viser hvem,
så en delvis nedetid er synlig frem for at skulle udledes.

### 3. Udelukkelsen var permanent indtil et menneske genstartede
broberg-ais base var rask igen 20 minutter efter den blev udeladt, og kunden var
STADIG lukket ude, fordi puljen kun bygges ved opstart. Ejeren måtte spørges om
lov til en genstart for at få sin egen Trail tilbage.

**En rettelse der kræver et menneske klokken tre om natten er ikke en rettelse.**
Motoren prøver nu selv hvert minut, kun for de kunder der mangler, og en kunde
der bliver rask er tilbage inden for et minut — med præcis samme behandling som
en der var med fra start: tjenester startet, udskudt vedligeholdelse kørt.

### Hvad prøverne måtte lære undervejs

**Min første frist-prøve bestod på 257 ms** — altså uden nogensinde at nå
fristen, fordi ÅBNINGEN fejlede først. Grøn uden at måle det den påstod.

**Min første gen-tilslutnings-prøve kunne ikke nå logikken:** `openRemoteTenantDb`
blev kaldt inde i løkken og fejlede mod en attrap-adresse før noget andet kørte.
Åbningen er derfor **injiceret** — ikke en abstraktion for dens egen skyld, men
fordi løkken kun ejer to ting: hvornår der prøves, og hvornår en kunde er med.

**Og spærren fra F259 havde selv fået et hul** af min egen ændring: den kiggede
kun på linjer uden indrykning, så et vedligeholdelses-kald lagt i en try-blok
ville være sluppet forbi. Den fjerner nu funktions-kroppe og leder efter et
KALD (`navn(`) frem for at navnet nævnes — importerne meldte sig ellers som
tolv syndere.

## F259.6 — «Invalid or revoked API key» var en løgn

Ejeren, med skærmbillede fra sin telefon: **Something went wrong — Invalid or
revoked API key**, på broberg-ai.

Nøglen fejlede ingenting. Kunden var ude af drift. Beskeden sendte ham efter et
nøgleproblem der ikke fandtes, mens den ægte årsag stod i motorens log.

Den gamle begrundelse — *«401 keeps us from leaking which slugs we know about»* —
gælder ikke her: vi er kun nået dertil fordi opkalderens EGEN legitimation slog
op i indekset og navngav netop den kunde. Der er intet at lække. Det eneste 401
opnåede var at skjule årsagen for den ene person der havde brug for den.

**503, ikke 401** — det er en midlertidig tilstand på vores side, og klienten
skal prøve igen, ikke skifte nøgle.

## Stadig ikke løst

- **Hvorfor gik basen i baglås?** Genstarten brød låsen, og trådtallet faldt fra
  69 til 12 af sig selv. Årsagen er ikke fundet, og sqld kørte uden `RUST_LOG`,
  så den havde intet at sige om sit eget arbejde. Logning bør slås til.
- **Advarselstegnet fremover** er et højt trådtal **i tomgang** — ikke under
  belastning, hvor 38 tråde er normalt.
