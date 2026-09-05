# F250 — Sprogskiftet nåede ikke seks paneler

**Status:** in progress · **Skrevet:** 5. september 2026 (dansk tid)

## Motivation

Ejeren, i produktet på sin iPhone (IMG_9612): Konto-siden stod på **engelsk** —
«Notifications on this device», «Turn on to subscribe this device», «Queue
candidates» — mens resten af appen var dansk. På hans skærmskud få minutter før
stod menuen på «Kilder».

To sprog på samme skærm. Det er ikke en manglende oversættelse — begge sprog
findes i koden.

## Roden

`getLocale()` er en **øjebliks-aflæsning uden abonnering**:

```ts
let currentLocale: Locale = detectInitial();
export function getLocale(): Locale { return currentLocale; }
```

`setLocale()` opdaterer variablen og notificerer et sæt lyttere — og `useLocale()`
er hooken der er bygget til at abonnere. Men **seks komponenter kalder
`getLocale()` direkte i deres render-krop**:

| Fil | Steder |
|---|---|
| `panels/settings-account.tsx` | 6 |
| `panels/kbs.tsx` | 1 |
| `panels/tenants.tsx` | 1 |
| `panels/tenant-members.tsx` | 1 |
| `panels/cost.tsx` | 1 |
| `components/new-trail-modal.tsx` | 2 (initial state — lovlig) |

En komponent der læser en global variabel i sin render-krop gen-renderer ikke når
variablen ændrer sig. Den bliver stående på det sprog den blev **født** med.

## Hvorfor det ser ud som halv oversættelse frem for en fejl

`detectInitial()` læser `navigator.language` ved modul-load; på en engelsksproget
iPhone giver det `'en'`. Sidebaren gen-renderes ved hver navigation og viser
derfor det opdaterede sprog — mens et panel man **bliver stående på** ikke gør.

Deraf den præcise skærm ejeren så: dansk menu, engelsk side. Fejlen er usynlig
for den der skifter sprog og straks navigerer videre, og synlig for den der
bliver stående — altså for den der faktisk læser siden.

## Scope

**Ind:** `useLocale()` på hvert render-sted i en komponent. `getLocale()` beholdes
hvor den er korrekt: uden for render (event-handlere) og som **initial** state.

**Ude:** oversættelser der mangler, ordbogens indhold, og sprogvalgets placering.
Intet af det er fejlen.

## De fire kald der BLIVER — og hvorfor det ikke er en undtagelse

| Sted | Hvorfor `getLocale()` er rigtig |
|---|---|
| `settings-account` `formatDate` | ren funktion uden for en komponent — en hook er ulovlig dér. Den kaldes fra en render der selv abonnerer, og læser derfor den aktuelle værdi. |
| `cost.tsx` | `useState`-initializer for **startvaluta**. En hook ville overskrive brugerens eget valg ved hvert sprogskift. |
| `new-trail-modal` (2) | initial state + reset. Sproget på en ny Trail følger admin-sproget som **udgangspunkt**, men er brugerens valg derefter. |

Grunden står nu i koden, så de ikke «rettes» af den næste der ser `getLocale` og
tror det er samme fejl.

## Værnet

En kilde-test tæller `getLocale()`-kald og går rød hvis tallet stiger — den
**pinner antallet frem for at forbyde funktionen**, netop fordi de fire ovenfor er
korrekte. Mutations-bevist: sæt `tenants.tsx` tilbage, og testen navngiver filen.

To ting den lærte af sig selv ved første kørsel:

1. **Den talte sit eget kommentar-ord med** (2 kald i `settings-account` hvor der
   er 1). Kommentarer strippes nu før tælling. En test der ikke kan skelne en
   forklaring fra et kald ville ellers enten larme falsk eller blive slækket
   indtil den ikke larmede.
2. **Test nr. 2 fejler hvis et TILLADT kaldested forsvinder.** Uden den ville
   listen kunne blive et fossil der bevogter noget der ikke er der — grøn, mens
   den holder øje med ingenting.

## Verifikation

Sprogskiftet drives i browseren: DA → EN → DA mens man står på Konto-siden, og
den samme konkrete streng aflæses efter hvert skift. **Begge retninger**, fordi
et tjek der kun ser efter dansk består lige så grønt på en side der altid er
dansk. Plus en reload for at bekræfte at valget overlever.

Bevist: Lens-flow `8e270c37`, 13/13 på prod (build `5806a7d`).

**Én ting Lens IKKE kan se, og som derfor er værd at have skrevet ned:** i en
headless WebKit uden installeret PWA rammer notifikations-sektionen sin
iOS-guide-gren, så strengene fra ejerens eget skærmbillede findes slet ikke i
DOM'en. Min første assert sigtede på netop dem og fejlede — på instrumentet, ikke
på produktet. Verifikationen bruger nu en streng der altid renderes, og som
samtidig er ét af de steder rettelsen rørte.

## Reuse

Discovery-tjek: ingen `@broberg/*`-pakke ejer i18n. `apps/admin/src/lib/i18n.ts`
er appens egen, og hooken der løser problemet fandtes allerede — den var bare
ikke brugt. Intet at hente eller udvide udefra.
