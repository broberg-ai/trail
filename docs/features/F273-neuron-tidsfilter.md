# F273 — «Hvad lærte jeg mellem X og Y»: Neuron-filter på tidsrum

> Status: plan. Oprettet 15. september 2026 på ejerens direkte anmodning.

## Motivation

Christians egne ord, 15/9 2026:

> «Du kan programmatisk hente den time ud, men jeg kan ikke finde en given
> aktivitet der er sket i Trail i et bestemt interval, altså hvilke Neuroner
> er skrevet i det tidsrum — det skal du lave efterfølgende til mig.
> *Hvad lærte jeg mellem XXXX og YYYY* — et Neurons filter.»

Sætningen kom ud af en konkret opgave samme dag. cardmem spurgte hvad Trail
Ambient havde registreret omkring et fysisk møde med FD Aalborg torsdag 10.
september kl. 16.00 dansk tid. Svaret fandtes — mødet ligger tydeligt i CB-M1
som 16:13–17:34, med 42 minutters tavshed før (transporten) og handlepunktet
udført kl. 18:00 — men det krævede at en agent hentede 946 dokumenter ned,
omregnede tidsstempler til dansk tid og lavede en hul-analyse i et script.

**Ejeren kan ikke selv stille det spørgsmål i produktet.** Det er hullet.

Det er heller ikke en kantsag: hele pointen med Ambient er at fange det der
sker hen over en dag. En base der kun kan søges på ORD kan ikke svare på
«hvad skete der i den time», og det er netop det spørgsmål et menneske
stiller om sin egen dag.

## Scope

### I scope

1. **Motoren kan afgrænse en dokumentliste til et tidsrum.** `from`/`to` på
   listeruten, fortolket i `Europe/Copenhagen`.
2. **Admin kan stille spørgsmålet.** Et tidsrums-vælger på Neuron-listen med
   hurtigvalg (i dag · i går · sidste 7 dage · eget interval).
3. **Svaret siger hvilket vindue det faktisk læste** — tilbage i dansk tid.

### Non-goals

- Ingen ændring af LAGRING. Tidsstempler bliver ved med at være UTC/epoch.
  Denne feature handler om at TALE om tid, ikke om at gemme den.
- Ingen ny fritekst-søgning, ingen ændring af relevansrangering.
- Ingen tidsfiltrering i chat/RAG i denne omgang (kan blive F273.4 senere).

## Målt før planen blev skrevet

Mod `apps/server/src/routes/documents.ts` og den kørende motor, 15/9 2026:

| | |
|---|---|
| Understøttede forespørgselsparametre i dag | `path`, `kind`, `archived`, `sort`, `awaitingLocalCompile` |
| Dato- eller tidsfilter | **findes ikke** |
| Dokumenter i CB-M1 | 946 |
| Rækker med `metadata` sat | **2** (begge fra 3. juli) |
| Rækker med `date` sat | **0** |

## Den bærende fælde: `createdAt` er SKRIVEtid, ikke OPTAGEtid

Dette er featurens vigtigste beslutning, og den er ikke teknisk pynt.

Trail gemmer i dag intet optagetidspunkt for Ambient. `createdAt` er det
øjeblik Neuronen blev SKREVET. For det meste ligger de to tæt nok på hinanden
til at ingen opdager forskellen — og præcis derfor er den farlig.

Målt i CB-M1: **187 af 946 Neuroner (20 %) blev skrevet i minutter der bærer
5 eller flere rækker.** De værste er 3. september kl. 20:29 og 20:30 med **32
rækker hvert minut**. Det er en efter-indlæsning — ikke et minut hvor der
skete 32 ting. Et filter der svarer «du lærte 32 ting mellem 20:29 og 20:30»
ville være teknisk korrekt og menneskeligt forkert.

**Konsekvens for designet:** filteret skal NAVNGIVE hvad det filtrerer på, og
fremtidige Ambient-Neuroner skal bære et rigtigt optagetidspunkt (F273.3), så
spørgsmålet «hvornår skete det» kan skelnes fra «hvornår blev det gemt».

## Den anden fælde: sommertid

En tid uden zone bliver læst i læserens egen zone, lydløst. September i
Danmark er **CEST = UTC+2**, ikke +1. Lægger nogen «én time» til et
UTC-stempel, lander opslaget kl. 15.00 i stedet for 16.00 — og finder enten
det forkerte eller ingenting, hvilket ser ud som «der er ingen data».

**Altid zone-NAVNET `Europe/Copenhagen`, aldrig et fast offset.** Et
hardkodet `+02:00` er en fejl med et halvt års lunte.

## Den tredje tilstand — tomt svar

Et tomt resultat skal kunne skelnes fra et misforstået vindue. Svaret bærer
derfor altid det OPLØSTE vindue tilbage, i dansk tid, så «0 Neuroner mellem
16:00 og 17:30» ikke kan forveksles med «jeg forstod ikke din dato».

Samme fejlform som resten af ugen: et instrument der ikke kan skelne «jeg
kunne ikke se» fra «der er ingenting».

## Arkitekturskitse

| Lag | Sti | Ændring |
|---|---|---|
| Motor | `apps/server/src/routes/documents.ts` | `from`/`to` → `and(gte, lte)` på `documents.createdAt` |
| Delte typer | `packages/shared/` | Zod-skema for vinduet + det opløste svar |
| Admin | `apps/admin/src/panels/` | Tidsrums-vælger + hurtigvalg, egen komponent |
| Ambient | `apps/ambient-capture/`, `packages/ambient-gate/` | stempler `capturedAt` (F273.3) |

**Ingen native kontroller.** Ingen `<input type="date">`. Der bygges/genbruges
en egen date-picker i `apps/admin/src/components/ui/`.

## Afhængigheder

Ingen blokerende. F273.3 kan udskydes uden at .1 og .2 mister værdi — men
uden den svarer filteret på «hvornår blev det skrevet», ikke «hvornår skete
det», og den forskel skal stå i UI'et frem for at blive glattet ud.

## Reuse

Discovery-tjek gennemført 15/9 2026 mod `discovery.broberg.ai`. Der findes
intet `@broberg/*`-paket til tidsrums-valg eller til dansk-tid-fortolkning i
en HTTP-forespørgsel; det er heller ikke en flåde-kapabilitet, men en
rutespecifik parameter på Trails egen dokumentliste. Zone-håndtering sker med
platformens egen `Intl`/`Temporal`-vej og zone-navnet `Europe/Copenhagen` —
intet nyt afhængighed hentes ind, og intet hjemmestrikket offset skrives.

Date-picker-komponenten genbruges fra `apps/admin/src/components/ui/` hvis
den findes; gør den ikke, bygges den DÉR som genbrugelig komponent, ikke
inline i panelet.

## Udrulning

1. F273.1 motor — additiv parameter, eksisterende kaldere uændrede.
2. F273.2 admin — bagefter, så UI'et aldrig kalder noget der ikke findes.
3. F273.3 Ambient-stempel — kan følge senere; ny kolonne er additiv.

Ingen migration der ikke er additiv. Ingen ændring af eksisterende rækker.
