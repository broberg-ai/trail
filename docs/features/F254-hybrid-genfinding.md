# F254 — Hybrid genfinding: betydning ved siden af ord

> **Ejerens ramme, og den er hele arkitekturen:** «der skal ikke laves om på compile
> og neurons, men vi kan skabe et hybrid RAG setup ovenpå.»
>
> Det er rigtigt læst. Kompilering-ved-indlæsning er dét der gør Trail anderledes
> fra enhver anden «anden hjerne», og den røres ikke. F254 lægger en anden måde at
> FINDE de færdige Neuroner på — samme indhold, ekstra indgang.

## Hvad der udløste den

Marco Rodrigues, *«I'm Sorry, But GBrain Was Not Made For You»* (AI Advances,
august 2026), om Garry Tans GBrain (29k stjerner). Artiklens bærende afsnit
hedder **«Markdowns and backlinks are not enough»** og slutter:

> «In brief, this works for humans, but not for agents. And as the brain grows,
> not even humans.»

**MÅLT I VORES EGEN KODE:** `packages/db/src/search.ts` er FTS5 med bm25. Der
findes ikke ét embedding i `packages/core`, `packages/db` eller `apps/server`.
Trail er markdown + wiki-links + ordmatchning — præcis den opstilling artiklen
argumenterer imod.

**OG VI HAR MÅLT SKADEN, FØR VI LÆSTE ARTIKLEN.** Under F251-arbejdet med cms
5. september:

```
«traktorer i Bolivia»                        →  0 træf
«hvor mange traktorer sælger I i Bolivia»    →  6 træf
```

Samme spørgsmål. Forskellen var at «sælger» overlevede stopords-filteret og blev
synonym-udvidet. **Ordmatchning der klarer sig på held.** En betydnings-søgning
ville have svaret ens på begge — og det er netop dét en kunde-chat producerer:
hele sætninger, ikke nøgleord.

## Det tavlen allerede vidste — og det den ikke gjorde

Ejeren bad om en gennemgang af ALLE ikke-igangsatte kort før planen blev skrevet.
**443 kort i backlog, 32 der rører søgning eller genfinding, og NUL om vektorer
eller hybrid genfinding.** De tre nærmeste:

| kort | hvad det er | forhold til F254 |
|---|---|---|
| **F183** Consolidation Tiers | den nattelige sammenskrivning (GBrains `dream`) | **AFHÆNGER AF F254** — se nedenfor |
| **F184** Entity Layer + Graph Queries | typede relationer, så grafen kan spørges | uafhængig, samme artikel-familie |
| **F84.2** pg_trgm full-text | en anden ORD-motor til Postgres | ikke semantisk, løser noget andet |

**F183 KAN IKKE BYGGES SOM SKREVET.** Dens plan-doc fra 5. maj angiver
forfremmelses-udløseren sådan:

> «Episodic → semantic: when N≥3 episodic Neurons cluster (**similarity > 0.8 via
> embeddings**)»

Den antager altså embeddings — og de har aldrig eksisteret. Kortet har ligget i
backlog i fire måneder med en usynlig afhængighed til noget der ikke findes.
**F254 er F183's manglende fundament.** Det er det stærkeste argument for at tage
den nu, og det står her frem for i en kommentar, så den næste der åbner F183 ser
rækkefølgen.

Sidebemærkning, målt undervejs: F184's plan-doc påstår at «Trail today has typed
edges between Neurons (F137)». Det passer ikke. `documentReferences` bærer
wiki→kilde plus et valgfrit claim-anker; `wikiBacklinks` bærer fra→til plus
link-teksten. Ingen af dem har en relations-TYPE. Rettes når F184 tages op.

## Målingen der afgør designet

**202 aktive Neuroner i broberg-ai's største videnbase.** Ved 3 tekststykker pr.
Neuron og 1024 dimensioner à 4 byte: **2,4 MB.** Tenant-bredt over alle 11
videnbaser: 6.781 Neuroner, ~83 MB — og søgning er ALTID afgrænset til én
videnbase, så det tal møder man aldrig i én forespørgsel.

**Konsekvens: ingen HNSW, ingen pgvector, ingen vektor-database.** Ved 2 MB er en
lige-ud-ad-landevejen sammenligning af alle vektorer hurtigere end at vedligeholde
et indeks, og den kan ikke give forkerte svar på grund af en indeks-parameter
ingen forstår. GBrain-artiklen når den modsatte konklusion — men forfatteren
kører titusinder af sider fra Gmail og kalender. **Vi kopierer hans arkitektur
netop IKKE, fordi vores tal er andre.**

Den dag en videnbase passerer ~50.000 tekststykker, tages spørgsmålet op igen.
Det er et målt tal, ikke en fornemmelse, og det hører i et eget kort.

## Arkitektur — et lag, ikke en ombygning

```
  kilde → KOMPILERING (urørt) → Neuron → document_chunks (urørt)
                                              │
                                              ├→ documents_fts   (FTS5/bm25, urørt)
                                              └→ chunk_embeddings (NY)
                                                     │
                                   hybrid: kør BEGGE, flæt, rækkefølg
```

De eksisterende `searchDocuments` / `searchChunks` bliver liggende og bliver ved
med at virke. Hybrid er en ny vej OVENPÅ dem, ikke en erstatning — så en fejl i
det nye lag aldrig kan tage den fungerende søgning med sig.

### Sammenfletningen

Reciprocal-rank fusion: hver halvdel afleverer en rangeret liste, og et dokument
scorer `Σ 1/(k + plads)`. Grunden til at det er den rigtige er kædelig og
afgørende: **bm25 og cosinus-lighed er ikke sammenlignelige tal.** bm25 er
negativ og ubegrænset, cosinus ligger i [-1,1]. At lægge dem sammen eller vægte
dem kræver en kalibrering ingen kan efterprøve. Fusion på PLADS kræver ingen.

## Fire beslutninger der ikke er til forhandling

**1. EU. Embeddings går gennem Mistral, ikke OpenAI.**
`@broberg/ai-sdk`'s `embedding`-tier peger på `text-embedding-3-small` — USA. Det
er et af de to steder SDK'et forlader EU, og det står i CLAUDE.md som en advarsel
mod at sende persondata den vej. Sannes kliniske Neuroner er persondata.
**Kaldet SKAL bære `override: { provider: 'mistral', model: 'mistral-embed' }`,
og en test skal bevise at det gjorde det** — ikke ved at læse koden, men ved at
læse `usage.provider` af SVARET.

**2. En manglende vektor må aldrig ligne et manglende svar.**
Har et tekststykke ingen vektor (nyt, fejlet, under bagfyldning), skal hybrid
sige det — ikke stille levere ordmatchning der ser komplet ud. Det er nattens
gennemgående fejlform: *et resultat formet som succes, der er et ikke-svar.*
Svaret bærer dækningsgraden.

**3. Vi måler om det VIRKER, før vi tror på det.**
«Hybrid er bedre» er en påstand. Uden et sæt rigtige spørgsmål med kendte rigtige
svar kan vi ikke skelne en forbedring fra en dyrere måde at få samme svar på.
`traktorer i Bolivia` er det første element i det sæt.

**4. Bagfyldningen koster penge, og tallet måles før den kører.**
6.781 Neuroner skal indekseres én gang. Prisen skrives ikke ned her, fordi et tal
jeg ikke har målt er et gæt — den måles på ti Neuroner og ganges op, før resten
kører.

## Ikke-mål (ejerens ramme, skrevet ud)

- **Kompilering-ved-indlæsning ændres ikke.** Ikke prompten, ikke rækkefølgen,
  ikke køen.
- **Neuron-formatet ændres ikke.** Ingen nye felter i frontmatter, ingen migration
  af eksisterende sider.
- **FTS5 fjernes ikke.** Den er stadig den halvdel der finder et præcist navn,
  et kode-id eller en filsti — dét er vektorer dårlige til.
- **Ingen Postgres, ingen pgvector.** F84 er et selvstændigt enterprise-spor.
- **Ingen omskrivning af chat-personaen.** F251's arbejde står urørt.

## Stories

| # | Hvad |
|---|---|
| **F254.1** | Vektorer ved skrivning + bagfyldning, EU-ruten, bevist på svaret |
| **F254.2** | Hybrid genfinding med fusion — og et ærligt signal når halvdelen mangler |
| **F254.3** | Mål om det virker: et evaluerings-sæt og en før/efter-kørsel |
| **F254.4** | Aidan og admin-søgningen bruger den |

## Reuse

Discovery-tjek kørt 6. september mod `discovery.broberg.ai/api/search`:

| Behov | `@broberg/*`? | Beslutning |
|---|---|---|
| Embeddings | **Ja, indirekte** — `@broberg/ai-sdk` har en `embedding`-tier | **Genbrug**, med EU-override. Ingen rå provider-integration. |
| Vektor-lagring / lighed | Nej («embedding», «vector search», «rag», «retrieval» gav alle nul træf) | Byg her — det er Trails eget skema |
| Rank-fusion | Nej | Byg her; det er 15 linjer og ingen afhængighed værd |

Bliver fusionen + EU-embedding-opskriften brugbar for andre repoer (cms' chat er
den oplagte), er DET kandidaten til `components` — ikke før den har kørt ét sted.

## Rollout

1. F254.1 bag et flag, slukket. Bagfyld én videnbase, mål prisen.
2. F254.3's evaluerings-sæt FØR F254.2 tændes — ellers har vi ingen før-måling.
3. F254.2 tændes for admin-søgningen først, hvor kun vi kigger.
4. F254.4 til Aidan sidst, når tallene fra 3 står.

Ingen nøgen udskiftning: FTS5 svarer hele vejen igennem, også hvis vektor-halvdelen
aldrig tændes.
