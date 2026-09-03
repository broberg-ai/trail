# F227 — sorterbare kolonner i billedlisten

**Kort:** trail-F227 · story · medium
**Status:** bygget og committet i `f76cfa1` (3. september 2026)

> **Denne plan-doc er skrevet EFTER koden, og det er en regelbrud jeg selv
> begik.** Husreglen er at plan-doc'en lander i SAMME tur som F-nummeret.
> `f76cfa1` introducerede F227 og F228 uden hverken kort eller plan. Skrevet
> her så snart det blev opdaget (4. september), mens konteksten stadig lever —
> men rækkefølgen var forkert, og det står der.

## Hvorfor

Ejeren, med skærmbillede af billedlisten: *«Lav kolonnerne sorterbare».*

Billedpanelet i admin viser Description · Page · Size for hvert billede i en
Trail. Uden sortering kan man ikke finde **de største** billeder (dem der fylder
disken), **de udokumenterede** (dem uden beskrivelse) eller **rækkefølgen på
siden**. Det er præcis de tre spørgsmål panelet findes for at besvare.

## Scope

**I scope:** klikbar sortering på de tre kolonner der allerede vises. Første
klik stigende, andet faldende, tredje tilbage til serverens egen rækkefølge.

**Non-goals:**
- **Server-side sortering.** Panelet henter én side ad gangen; sortering sker
  på det hentede. Se advarslen nedenfor.
- Nye kolonner, filtre eller bulk-handlinger.

## De tre valg der er MÅLT, ikke gættet

| valg | hvorfor |
|---|---|
| **Size sorterer på AREAL** (b×h), ikke bredde | En **2000×10** skillestreg er det BREDESTE og næst-mindste billede i Sannes Trail. Sorteret på bredde ligger den øverst i en liste hvis eneste formål er at vise de store. |
| **Manglende værdi synker til bunden i BEGGE retninger** | Et manglende sidetal talt som `0` ville parkere alt udokumenteret øverst ved stigende sortering — og ligne et resultat. «Vi ved det ikke» og «det er nul» må ikke se ens ud. |
| **Sorteringen er stabil** | En anden kolonne omroder ikke den første for lige værdier. |

## Fladen siger selv hvad den IKKE kan

Under listen står: *«Sorteret på de N billeder der er hentet — ikke hele
Trailen.»*

Det er den vigtigste linje i hele kortet. **En sorteret delmængde ser præcis ud
som en sorteret helhed** — samme pile, samme rækkefølge, ingen visuel forskel.
Uden sætningen ville «det største billede» betyde «det største på side 1», og
ingen kunne se forskel. Det er dagens gennemgående fejlform: ét signal, to
kendsgerninger.

## Arkitektur

`sortHits()` trukket ud i `apps/admin/src/panels/images-sort.ts` som en ren
funktion — så reglerne kan prøves uden DOM. 9 prøver i
`images-sort.test.ts`, herunder de tre valg ovenfor som hver sin påstand.

`data-testid` på hver kolonneknap (`images-sort-description` · `-page` ·
`-size`), så Lens kan klikke dem.

## Afhængigheder

Ingen. Ren klient-ændring i `apps/admin`.

## Udrulning

`pnpm ship:admin`. Ingen migration, ingen serverændring.
