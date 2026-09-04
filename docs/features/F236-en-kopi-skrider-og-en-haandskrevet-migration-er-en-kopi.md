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
