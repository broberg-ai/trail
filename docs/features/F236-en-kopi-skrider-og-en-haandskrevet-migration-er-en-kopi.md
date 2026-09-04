# F236 — en kopi skrider, og en håndskrevet migration er en kopi

**Kort:** trail-F236 · story · medium · **bygget i samme tur**

## Kom fra en anden sessions fejl, ikke fra vores egen

fd-sundhed fandt en fælde i cardmems opskrift for mail-skabeloner: artefaktet er
en **kopi**, og en kopi skrider. Retter man kilden uden at genkøre generatoren,
beskriver artefaktet stadig den gamle udgave — og cardmem sammenligner sin
gemte kopi med artefaktet, finder dem ens, og svarer **`synced`** om noget
forældet.

Deres sætning er hele argumentet:

> *«unknown shouts, stale shouts, but a stale file that matches itself lies with
> a green word.»*

Trail undgik netop den fælde ved at fravælge artefaktet (F235.2). Men **formen
findes i vores eget skema**, og jeg havde rørt den fire gange samme nat.

## Vores egen udgave af den

Migrationerne **0044–0047 er skrevet i hånden**, ikke genereret fra `schema.ts`.
Så de to kan være uenige, og intet i byggeriet ville opdage det:

- ORM'en typetjekker glad mod en kolonne databasen ikke har
- fejlen dukker først op i drift, som et **tavst forkert svar**

Det er nøjagtig den fejlfamilie dette repo mødte fire gange på ét døgn. Og
`pnpm typecheck` er grøn i begge verdener — den kender kun `schema.ts`.

## Målingen

**Ingen drift i dag:** 27 tabeller, 330 kolonner, alle til stede efter en frisk
kørsel af migrationerne.

Det er et beroligende tal og en værdiløs garanti. Et tjek der kører én gang
beskytter mod ingenting; det næste håndskrevne `ALTER TABLE` er det der tæller.
**Derfor er det en port, ikke en engangsmåling.**

## Hvordan tjekket er skruet sammen

**Mod en frisk database bygget af den rigtige migrations-kører** — ikke mod
SQL-teksten. At læse `.sql`-filerne ville bevise at en streng *nævner* en
kolonne, ikke at det at anvende dem *frembringer* den. Præcis samme skel som
fd-sundheds: filen der matcher sig selv.

**Forudsætnings-tjek først.** Reflektionen over `schema.ts` skal have fundet
mindst 20 tabeller og 200 kolonner, før sammenligningen tæller. Et tomt kort
ville få løkken til at bestå uden at undersøge noget — grøn af ingen grund, som
er den fejl porten findes for at forhindre.

**Negativ kontrol.** Uden den kan «ingen drift» ikke skelnes fra «sammenligningen
sammenlignede aldrig noget». Testen kræver at en kolonne der *findes*
(`min_image_entropy`, håndskrevet) ses, og at en der *ikke gør* ikke gør.

**Mutations-bevist:** erklæres en kolonne i `schema.ts` som ingen migration
opretter, bliver præcis den test rød.

## Den retning der IKKE dækkes, og hvorfor

Tjekket går **schema.ts → database**. Den omvendte — en kolonne i databasen som
`schema.ts` ikke kender — er ikke dækket.

Bevidst: den retning er langt mindre farlig. En ukendt kolonne bliver ignoreret;
en manglende kolonne får en forespørgsel til at fejle eller svare forkert. Skrevet
her, så fraværet er et valg og ikke noget nogen tror er dækket.

---

# F236.2 — porten spurgte pakkerne, og to af dem svarede ikke

**Kom af at skærpe min egen formulering.** Jeg havde sagt til cardmem at
spørgsmålet til et repo er «kører jeres prøver». Det var ikke præcist nok, og
min egen sag viste hvorfor: **der VAR prøver. Der var bare ingen kommando der
kaldte dem.**

> En pakke uden `test`-script rapporterer **det samme som en pakke der består:
> ingenting.**

cardmem målte deres eget repo på den formulering: 461 testfiler, 461 nået af
porten, 0 udenfor. Rent — **men de navngav grunden frem for at tage æren:**
deres port kører `bun test <mapper>` over eksplicitte stier, ikke `pnpm test`
pr. pakke. *«That is luck of architecture, not diligence.»*

**Vores port kører netop den arkitektur der HAR døren.** `turbo run test` spørger
hver pakke om dens eget script. Erklærer en pakke ikke ét, springes den over i
stilhed.

## Målt, og der var to

```
apps/admin-server   1 testfil, intet script   ← login, sessioner, tenants,
                                                invitationer, API-nøgler
packages/core       1 testfil, intet script   ← 6 prøver, 25 kontroller,
                                                skrevet 2. sept, aldrig kørt
```

**Begge var GRØNNE da de endelig blev kørt.** Det er hele pointen: intet
fejlede, så intet kunne afsløre dem. Spørgsmålet «består jeres prøver» ville
have fået svaret ja.

`packages/core` er motorens domænelogik, og prøven er `kb-size.test.ts` — fra
F217.1, *«every Trail shows its size — and refuses to count 708 MB that is
gone»*. Altså præcis den logik der forvirrede mig i nat om manglende MB.

## Porten spørger nu sig selv

En prøve i `packages/core` går workspacet igennem og kræver at **enhver pakke
med testfiler erklærer et `test`-script**.

**Negativ kontrol den anden vej:** en pakke UDEN prøver må ikke tvinges til at
erklære ét. Ellers bliver reglen til «alle skal have et test-script», og folk
tilføjer tomme scripts der består ved at køre ingenting — et usynligt hul byttet
til et grønt.

**Forudsætnings-tjek:** scanningen skal have fundet >10 pakker og >4 med prøver,
før påstanden tæller. Ellers består den ved at undersøge ingenting.

**Mutations-bevist:** fjernes `core`s eget test-script, bliver præcis den prøve
rød.

## Og en advarsel fra fd-sundhed, tjekket her

cardmem havde anbefalet `git check-ignore` uden `--no-index` til tre repos —
et tjek der **aldrig kan udløses på en sporet fil**, altså en vagt uden
kaldere. Søgt efter i vores hooks og scripts: **ingen forekomster.** Vi har den
ikke.

---

## Efterskrift: kortet kom for sent, og vagthunden fangede det

**F236.2 blev committet TO gange før kortet fandtes.** Board-integriteten
flaggede det på anden commit:

> *«F236.2 is not a card — create it with acceptance criteria (or drop the
> reference)»*

Mekanismen er værd at navngive, fordi den ikke ligner en forglemmelse: jeg
**tilføjede** F236.2's afsnit til denne plan-doc frem for at gå gennem
`/feature`-skillen. Plan-doc-halvdelen af reglen var derfor opfyldt hele tiden —
det var kort-halvdelen der manglede, og netop den halvdel er den skillen ville
have tvunget frem.

**Ironien er præcis nattens emne:** jeg opdagede at `/feature` havde kørt en
tre måneder gammel udgave (F234), rettede det — og sprang så skillen over næste
gang jeg lavede et F-nummer.

**Klassen lukket, ikke tilfældet.** Alle 25 F-numre fra nattens commits er
krydstjekket mod boardet OG mod disken:

```
plan-doc på disken   25 af 25
kort på boardet      25 af 25   (efter F236.2 blev oprettet)
```
