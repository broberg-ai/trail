# F275 — Samme kilde, ny udgave: den seneste er kanon

**Kort:** trail-F275 · epic · **høj**
**Status:** **UDRULLET 17. september 2026** — F275.1, .2, .3 og .5 er live på
trail-engine-001 og app.trailmem.com. F275.4 og .6 er ikke bygget; se nedenfor.

---

## Ejerens ord

Christian, 16. september 2026, ordret:

> *«Jeg tror at vi skal have en identifikation af en kilde, og hvis kilden den ændrer
> sig, så er det jo den nye kanon og fakta. Og når det sker, så skal du acceptere de
> modsigelser der opstår i køen — så når jeg retter et dokument i CMS, gør det at der
> ikke kommer en ny modsigelse i køen hver gang. For når det handler om indhold på en
> hjemmeside der løbende kan rettes til — og det kommer til at ske rigtig mange gange
> på broberg.ai, fordi der er meget af det der er skrevet der er noget værre lort — så
> nytter det jo ikke noget at du kompilerer og laver modsigelser, fordi det er en nyere
> udgave af den samme kilde. Hvis kilden — altså en URL på en hjemmeside — forbliver
> den samme, ja så skal den seneste udgave være kanon.»*

> *«Det må være en feature vi skal bygge i Trail, og så kan du lave en indstilling som
> hedder om en ny udgave af den samme kilde automatisk skal blive kanon.»*

Og på de to spørgsmål planen stillede:

> *«Det lyder virkelig klogt at der både er en på en brain og en på en connector. Vi
> sætter dem begge to default on så samme kilde med ny indmad bliver ny kanon.»*

## Hvorfor det haster

Natten mellem 15. og 16. september blev én kilde — `broberg.ai/flagskibe/bid` —
redigeret **fra version 2 til version 14 på under en time**, hurtigst ca. én ny version
hvert 45. sekund. Hver gemning i CMS'et sender en ny udgave til Trail via konnektoren
`broberg-ai-site-sync`.

Det er ikke en kantsag. Det er den normale arbejdsform på et site hvor indholdet bliver
skrevet om løbende. Uden denne feature producerer hver eneste rettelse en modsigelse
kuratoren skal tage stilling til — og modsigelsen er falsk, for der er kun ÉN kilde og
den har skiftet mening om sig selv.

**Konsekvensen af at lade være:** jo mere ejeren forbedrer den dårlige tekst på sit eget
site, jo mere arbejde giver Trail ham. Det er et incitament der vender forkert.

## Målt, før noget bygges

```
Råkilder i broberg.ai:                    70
  med en sourceUrl i metadata:            66   (94 %)
  uden (uploads):                          4
Konnektorer:  broberg-ai-site-sync  66  ·  (ingen)  4
```

**Identiteten findes allerede** — `metadata.sourceUrl` er stemplet på hver
site-sync-kilde. Den er bare ikke et felt noget i systemet regner med. Det er en
backfill, ikke en udgravning.

**Men Neuronen bærer INGEN proviens** (målt af peer-sessionen samme nat):

```
kilden     1e94ca9c-…        metadata: {connector, sourceUrl}
Neuronen   doc_ba74c740-115  metadata: None   ingestJobId: None
```

Eneste spor fra en Neuron tilbage til dens kilde er `sources: ["flagskibe_bid.md"]` i
frontmatter — altså prosa, og et filnavn er ikke en identitet. Kilden kender sig selv;
Neuronen kender ikke sin kilde. Begge ender skal lukkes.

Modsigelses-linten (`packages/core/src/lint/contradictions.ts`, 232 linjer) springer
allerede over når to Neuroner har samme `documentId` (linje 66). Den kender ikke
begrebet *samme kilde* — kun *samme dokument*. To Neuroner kompileret fra samme URL på
hver sin dag har hver sit documentId og bliver sammenlignet som uafhængige påstande.
**Det er præcis hullet.**

## Beslutningen

1. **En kilde har en IDENTITET.**
   - Hjemmeside-kilde: **URL'en**. Forbliver URL'en den samme, er det den samme kilde —
     uanset hvor meget teksten ændrer sig.
   - Uploadet fil: **filnavn + Brain** (ejerens afgørelse). Ellers genskaber vi præcis
     det problem featuren fjerner, bare for filer i stedet for sider.
2. **Den seneste udgave af en identitet er KANON.** De tidligere udgaver er ikke
   konkurrerende fakta. De er afløst.
3. **En ny udgave rejser derfor ingen modsigelse mod sin egen forgænger.**
4. **TO kontakter, begge default ON** — pr. Brain (hovedafbryderen) og pr. konnektor
   (den præcise). En Brain som CB-M1 har både hjemmeside-sync og manuelle uploads, så
   ét valg for hele hjernen ville nødvendigvis være forkert for den ene af dem.
5. **Afgør på INDHOLDS-HASH, aldrig på `updatedAt`.** Målt: `updatedAt` flyttede sig
   mens version, filstørrelse og hash stod stille. «Nogen skrev» og «indholdet er nyt»
   er to spørgsmål.

### Forbeholdet ejeren overtog bevidst

Peer-sessionens råd var **upload default OFF** — en upload er en bevidst handling hvor
mennesket måske TILFØJER frem for at erstatte. Ejeren valgte ON. Det er hans kald, og
konsekvensen står her frem for at blive glattet ud: **to forskellige `rapport.pdf` i
samme Brain betyder at den anden lydløst overskriver den førstes viden.**

Derfor er besked-linjen ved upload — *«dette erstatter rapport.pdf fra 3. september,
tryk her hvis det er en ny kilde»* — ikke en pæn detalje. **Den er det eneste
sikkerhedsnet mod navnesammenfald, og den skal leveres SAMMEN med kontakten, ikke
efter.** Uden den er default ON en lydløs overskrivning, og et lydløst indgreb kan ikke
skelnes fra at intet skete.

## Afgrænsning

**I epic'en:**

- Kilde-identitet som førsteklasses felt på BÅDE kilden og Neuronen + backfill.
- De to kontakter, begge default ON, med et entydigt og synligt hierarki.
- Linten respekterer identiteten: samme identitet ⇒ erstatning, aldrig modsigelse.
- Afløsningen FORPLANTER sig til de Neuroner der citerer kilden (F275.5).
- Genkompilering ERSTATTER en kildes viden frem for at lægge lag på.

**Non-goals:**

- **At slukke modsigelses-linten mellem FORSKELLIGE kilder.** To sider der er uenige er
  stadig et ægte fund. Det er kun selv-modsigelsen over tid der er støj.
- **At slette de gamle udgaver.** Dokumenter er versionerede i forvejen; historikken
  bevares i databasen. Det der ændres er hvad der regnes for KANON — ikke hvad der
  gemmes.
- **At rydde op i eksisterende modsigelser i køen.** Ændringen er fremadrettet.
- **En automatisk «ingen forældede citater»-port.** Se F263.16's non-goal: den kan ikke
  bygges, fordi en side der dokumenterer historik SKAL indeholde de gamle citater. Det
  der kan håndhæves mekanisk er proveniens, ikke overensstemmelse.

## Arkitektur-skitse

```
  kilde-række      + sourceIdentity     URL (site-sync) | filnavn+Brain (upload)
                   + contentHash        afgør «ny udgave», ikke updatedAt
  NEURON-række     + sourceIdentity     Neuronen skal kende sin kilde
  knowledge_base   + newVersionIsCanon  bool, default TRUE   ← hovedafbryder
  connector        + newVersionIsCanon  bool, default TRUE   ← den præcise

  ingest/recompile  →  slår op på sourceIdentity, ikke på documentId
                    →  tidligere udgave + begge kontakter TIL:
                         markér forrige som AFLØST, ikke som modpart
                       upload m. navnesammenfald: SIG DET FØRST

  contradictions.ts →  skip når sourceIdentity(a) === sourceIdentity(b)
                       INGEN identitet ⇒ MODSIGELSE (den sikre standard)
```

**Den sikre standard er ikke en detalje.** Alle eksisterende Neuroner mangler feltet
indtil backfill'en er kørt. Falder tvivlen ud til «afløsning», bliver hele den nuværende
base usynlig for modsigelses-detektion i det sekund kontakten slås til — og *en
modsigelse der ikke rejses ser præcis ud som en der ikke findes.*

## Stories

| # | | |
|---|---|---|
| F275.1 | Kilden — og Neuronen — får en identitet | høj · 3 SP | **✓ live** (`ab68c22`, `c0137d6`, `5f3d553`; Neuron-halvdelen i `cd8cb9f`) |
| F275.2 | De to kontakter + besked ved navnesammenfald | høj · 3 SP | **✓ live** (`8565e3a`, `3b5a4cb`) |
| F275.3 | Linten rejser aldrig modsigelse mellem to udgaver af samme kilde | **kritisk** · 3 SP | **✓ live** (`cd8cb9f`) |
| F275.4 | Genkompilering erstatter — den lægger ikke lag på | høj · 3 SP | ikke bygget — se note |
| F275.5 | Afløsningen skal forplante sig | **kritisk** · 5 SP | **✓ live** (`0342916`) |

**Note om F275.4:** F252 løste allerede den akutte del (én kilde-fil → én side,
frem for en ny række pr. kompilering), og F275.5's mærkning dækker den del hvor
en gammel udgave ellers ville leve videre i de afledte sider. Det der står
tilbage er en oprydning i PROSA — formuleringer der lægger lag frem for at
erstatte — og det blokerer ikke F277. Kortet står åbent med vilje.

**Note om F275.6:** fingeraftrykket er en SUPPLERENDE identitetsmekanisme til
filer der skifter navn. Uploads har i dag identitet på filnavn + Brain (F275.2),
hvilket er ejerens egen afgørelse og dækker den sag featuren blev født af.

**F275.5 er den der redder featuren fra at gøre skade.** Det var ikke kilde-Neuronen der
stod forkert i nat — det var `overview.md`, `glossary.md` og `flagskib.md`, hvis egen
identitet ikke er kildens URL. Fem sider sagde «bygges nu» efter kilden sagde
«lanceret». Rammer afløsningen kun kilde-Neuronen, bliver køen ren mens hjernen stadig
svarer på gårsdagens tekst — **og det er værre end i dag, fordi det ikke længere ligner
et problem.**

## Reuse

Discovery-tjekket blev kørt **17. september, EFTER kortene var bygget** — ikke før,
som F217 foreskriver. Det står her som det skete frem for at blive dateret
tilbage; en genbrugs-sektion der lyver om hvornår den blev skrevet er værre end
ingen, fordi den næste læser tror processen blev fulgt.

Tre opslag mod `discovery.broberg.ai/api/search`:

| søgt efter | nærmeste træf | genbrugt? |
|---|---|---|
| url-normalisering / kanonisk form | `@broberg/media`, `@broberg/gravatar` | **nej** — ingen af dem normaliserer en URL; vi bruger platformens egen `new URL().href`, hvilket er et endnu stærkere «genbrug» end en pakke |
| indholds-hash / dedup | `@broberg/http`, `@broberg/deploy-core` | **nej** — hash'en fandtes i forvejen i Trails egen upload-rute (F162), og at flytte den ville være en omlægning uden gevinst |
| kilde-identitet / proveniens | `@broberg/config`, `@broberg/lens-engine` | **nej** — «hvad ER en kilde hen over sine udgaver» er Trail-domæne, ikke en tværgående primitiv |

**Konklusionen er BUILD, og den er smal med vilje.** Det eneste stykke der kunne
være en fleet-primitiv er URL-normaliseringen — og dér er det rigtige svar ikke
en `@broberg/`-pakke, men at lade være med at skrive sin egen: `new URL().href`
gør det rigtige (småskriver værten, bevarer stiens kasse, afkoder ikke `%2F`),
og en håndskrevet hjælper ville have ramt alle tre forkert.

**Hvis en anden i flåden får brug for det samme**, er stedet at kigge
`packages/shared/src/kilde-identitet.ts` — og så er det værd at flytte til
`components` frem for at kopiere. Det er ikke sket endnu, og det er ikke lovet.

## Afhængigheder

- **F263.16** (foreslået) — version + indholds-hash på «færdig». De to hænger sammen:
  F263.16 besvarer *hvilken udgave er kompileret*, F275 besvarer *hvad betyder det at
  der er kommet en ny*.
- Modsigelses-linten, `packages/core/src/lint/contradictions.ts`.
- Konnektoren `broberg-ai-site-sync`, som allerede stempler `sourceUrl`.

## Rollout

1. Identitet på kilde + Neuron, plus backfill. Ingen adfærdsændring — feltet fyldes bare.
2. De to kontakter, begge default ON, MED besked ved navnesammenfald.
3. Linten respekterer identiteten.
4. Genkompilering erstatter frem for at lægge lag på.
5. Afløsningen forplanter sig.

Hvert trin er additivt. Slås kontakterne fra, opfører systemet sig præcis som i dag.

## En note der hører til i filen

Featuren handler om at **én kilde ikke må give to konkurrerende sandheder** — og den
blev født som to konkurrerende planer, F275 og F276, skrevet samtidig i hver sin
cc-session fordi ejeren gav beslutningen til begge inden for få minutter. F276 er
omskrevet til en ren henvisning hertil.

Det er ikke et sjovt sammentræf. Det er et bevis på at problemet er reelt og at det
rammer OS, ikke kun CMS-indhold.
