# F288 — en kilde står «ready» med 0 Neuroner, fordi referencerne slås op på FILNAVN

**Fundet 22. september 2026**, af en peer der læste tallet som en kontrol.

Christians ord samme dag, på listen med syv beslutninger: **«4. Byg»**.

---

## 1. Symptomet, målt i produktion

Music-hjernen i `broberg-ai`, 22. september kl. 13.52 dansk tid:

```
kilde 181c3073   status ready   neuronCount 0
KB'ens indhold   1 kilde · 8 Neuroner, alle kompileret FRA den kilde
```

Otte Neuroner findes, er søgbare, og bærer kildens filnavn i deres
`sources:`-frontmatter. Tælleren siger nul.

## 2. Hvorfor det ikke bare er en grim badge

`neuronCount` er den ENESTE maskinlæsbare måde at skelne

* **«kilden ligger der»** (status `ready`) fra
* **«kilden har produceret noget»**.

Den sondring blev bygget netop fordi vi tidligere målte **7 kilder der stod
`ready` med fuldt indhold og nul output** — en fejl der peger i den grønne
retning og derfor ikke opdages.

**Og feltet er allerede taget i brug udefra.** `forager` læser det ved hvert
eneste kald som deres read-back-kontrol på at en afsendt kilde blev til viden.
De er advaret (intercom 22/9) og tæller `kind:"wiki"` i mellemtiden — men
pointen står: et tal der ikke kan skelne «intet produceret» fra «vi mistede
sporet» er ikke en kontrol, det er en kontrol der LIGNER en.

## 3. Årsagen — REPRODUCERET LOKALT, ikke udledt

`apps/server/scripts/verify-neuroncount-filnavn.ts`, kørt mod en frisk
libsql-fil med de rigtige funktioner:

```
to AKTIVE kilder, SAMME filnavn, forskellig sourceUrl
én Neuron der citerer filnavnet i sin frontmatter

backfill skrev 1 reference
  neuron-1  ->  kilde-gammel
  neuronCount(kilde-gammel) = 1
  neuronCount(kilde-ny)     = 0
```

Kæden:

1. `/local-compiled` kalder
   `backfillReferencesForSource(trail, kbId, doc.filename)`
   — **den sender FILNAVNET videre, selvom den har kildens `doc.id` i hånden.**
2. Den finder kandidat-Neuroner og kalder `extractReferencesForDoc()`.
3. Den løser hvert citeret filnavn til en kilde via `resolveSource()`, hvis
   strategi 1 er `eq(documents.filename, normalised)` efterfulgt af `.get()`.
4. `.get()` returnerer ÉN række. Med to kilder på samme filnavn er valget
   SQLites, ikke vores — og opslaget filtrerer **ikke** på `archived`.

Referencen kan altså lande på den forkerte kilde, og den rigtige står tilbage
med nul. Det er præcis hvad der skete i Music: to Miles Davis-kilder med samme
filnavn, den ene arkiveret bagefter.

> **Det er samme fejlform som `F227.5`:** den oplysning der skulle bruges var
> allerede i hånden og blev smidt væk et led før. Der er ikke noget
> tvetydigt ved «hvilken kilde blev lige kompileret» på `/local-compiled` —
> kaldet kender rækkens id og sender dens navn.

## 4. Scope

**I scope:**

1. **`/local-compiled` sender kildens ID, ikke dens filnavn.** Det fjerner
   opslaget helt på den sti hvor svaret allerede er kendt. Det er rettelsen;
   resten er hærdning for de stier der ikke kan undgå et navneopslag.
2. **`resolveSource()` må ikke vælge vilkårligt.** Den skal udelukke
   arkiverede kilder, og ved flere aktive kandidater vælge den NYESTE
   deterministisk frem for at lade `.get()` bestemme.
3. **Tvetydigheden skal kunne ses.** Rammer et navneopslag mere end én aktiv
   kilde, skal det logges med begge id'er. En tavs vilkårlighed er hele
   grunden til at det her tog en uge at opdage.
4. **Bagfyld produktionen** for de kilder der i dag står `ready` med 0 og
   HAR Neuroner — Music's 181c3073 er den kendte.

**Non-goals:**

* **Ikke en ændring af Neuronens frontmatter-format.** `sources: [filnavn]` er
  det de kompilerede Neuroner bærer i dag, og at skifte til id'er ville kræve
  en migrering af hver eneste Neuron i hver hjerne. Navneopslaget skal
  overleve — det skal bare ikke være tavst forkert.
* **Ikke en spærre mod to kilder med samme filnavn.** Det er lovligt (to sites
  leverer begge `index.md`), og identiteten er URL'en eller fingeraftrykket —
  ikke navnet. Se beslutningen `01a0a7c2` i registret.
* **Ikke en udrulning.** Rettelsen landes og bevises; udrulningen er
  Christians egne ord.

## 5. Åbne spørgsmål

* Hvilken af flere aktive kandidater er «rigtig», når en Neuron citerer et navn
  to kilder deler? Forslaget er **den nyeste**, fordi en genuploadet kilde er
  den kanoniske (beslutning `01a0a7bb`: «samme kilde, nyt indhold = ny kanon»).
  Det er et valg, ikke en selvfølge, og det skrives ind hvor det tages.

## Reuse

Discovery-tjek 22. september 2026.

* **Ingen `@broberg/*`-pakke ejer dette.** Det er Trails egen
  reference-udtrækning over Trails egen dokumenttabel — der er ingen
  fælles-primitiv at genbruge og intet her der hører hjemme i `components`.
* **Genbrugt INDEN i repoet:** rettelsen tilføjer ingen ny opslagsvej.
  `resolveSource()` bliver det ene sted navneopslaget sker, og
  `/local-compiled` holder op med at bruge det, fordi den kender svaret.
* **Instrumentet der fandt det var en peers read-back**, ikke vores eget
  tilsyn. Værd at notere: feltet havde været forkert i Music fra første
  kompilering, og ingen af VORES flader ville have vist det.

## 6. Lektien

**Et tal der ikke kan skelne to tilstande er ikke et svagt tal — det er et
forkert tal, der læses som et rigtigt.** `0` betød her enten «intet
produceret» eller «vi mistede sporet», og de to kræver modsat handling: den
første er en fejl i kompileringen, den anden er en fejl i bogføringen. En
kontrol der returnerer samme værdi for begge kan ikke bruges til nogen af dem.
