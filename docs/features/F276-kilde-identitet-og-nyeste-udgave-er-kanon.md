# F276 — AFLØST AF [F275](F275-samme-kilde-ny-udgave-er-kanon.md)

**Dette nummer er ikke i brug. Byg ikke efter denne fil.**

Christian gav den samme beslutning til to sessioner inden for få minutter 16. september
2026. `trail-ingest` cardede den som **F275** (epic + 4 stories med AC, plan-doc
`docs/features/F275-samme-kilde-ny-udgave-er-kanon.md` @ 793b946); denne session skrev
F276 samtidig og uafhængigt. **F275 er den gældende.**

Filen slettes ikke, fordi en død plan der bare forsvinder efterlader den næste med at
lede efter den. Den peger i stedet det rigtige sted hen.

Ironien er noteret frem for glattet ud: featuren handler om at den samme kilde ikke skal
give to konkurrerende sandheder, og den blev født som to konkurrerende planer. Det er
samme fejlform som natten var fuld af — **en dublet er ikke gal den dag den skrives, men
den dag den ene bliver rettet.**

---

## Hvad der blev målt her, og som hører til i F275

Tre ting fra denne sides måling som ikke stod i F275's oprindelige plan. De er sendt til
`trail-ingest` (intercom) til optagelse i de relevante stories:

### 1. Neuronen bærer ingen proveniens — ikke kun kilden mangler et felt

Målt på produktionen:

```
KILDEN     1e94ca9c-…        metadata: {"connector":"broberg-ai-site-sync",
                                        "sourceUrl":"https://broberg.ai/flagskibe/bid"}
NEURONEN   doc_ba74c740-115  metadata: None      ingestJobId: None
```

F275.1's tal «0 → 66» dækker det, men skelnen er værd at holde fast i: **kilden kender
sin identitet, Neuronen kender ikke sin kilde.** Det eneste spor i dag er linjen
`sources: ["flagskibe_bid.md"]` i frontmatter — et filnavn i prosa. Et filnavn er ikke en
identitet (to sites kan begge levere `index.md`), og prosa kan ikke håndhæves.

### 2. `updatedAt` er ikke det samme spørgsmål som `version`

Målt samme nat: `updatedAt` på kilden flyttede sig mens `version`, filstørrelse og
`contentHash` stod stille — altså en skrivning uden en indholdsændring. «Nogen skrev» og
«indholdet er nyt» er to forskellige spørgsmål. **Afløsning skal afgøres på
`contentHash`**, ikke på `updatedAt`; en kontrol der læser det forkerte felt tager fejl i
begge retninger.

### 3. Den sikre standard, når proveniensen mangler

**Ingen `sourceIdentity` ⇒ behandl som MODSIGELSE, aldrig som afløsning.** Alle
eksisterende Neuroner mangler feltet indtil backfill'en er kørt. Faldt tvivlen ud til
«afløsning», ville featuren gøre hele den nuværende base usynlig for modsigelses-
detektion i det øjeblik den blev slået til — og en modsigelse der ikke rejses, ser præcis
ud som en der ikke findes. Det er den dyre retning at fejle i.

Samme forbehold for en **curator-redigeret** Neuron: har et menneske skrevet i den, er
den ikke længere ren kilde-viden, og en ny sideversion må ikke uden videre overskrive den.

### 4. Afløsning skal FORPLANTE sig til de afledte Neuroner

Det var ikke kilde-Neuronen der stod forkert i nat. Det var `overview.md`, `glossary.md`
og `flagskib.md` — sider hvis egen identitet ikke er kildens URL, men som bærer påstande
kompileret fra den. **Fem sider sagde «bygges nu» længe efter at kilden sagde
«lanceret».** Rammer afløsningen kun kilde-Neuronen, flytter vi stilheden frem for at
fjerne fejlen: køen bliver ren, og hjernen svarer stadig på gårsdagens tekst. Det er en
værre tilstand end i dag, fordi den ikke længere ligner et problem.

---

## Denne sessions egne skriverier er i scope for F275.4

`trail-ingest` har allerede noteret at deres versionshistorik-prosa i
`bid-broberg-ai.md` bliver forkert under den nye regel. **Det samme gælder denne
sessions:** statusblokken i `/neurons/entities/broberg-id.md` og afsnittet om
version 5→14-takten i `/neurons/sources/bid-broberg-ai.md` er skrevet 15.–16. september,
før beslutningen fandtes. Hører versionshistorik i databasen frem for i Neuronens prosa,
skal de også ryddes.

**Grænsen fra F275.4 gælder også her og er let at ramme forkert:** v14's egen
selv-modsigelse — overskriften «Lanceret nu» over for «Fundamentet bygges **og lanceres**
først» — er **ikke** versionshistorik. Det er den nuværende kildes egen uenighed med sig
selv, og den skal stå.
