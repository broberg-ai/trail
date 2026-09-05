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
hvor den er korrekt: uden for render (event-handlere) og som **initial** state
(`new-trail-modal.tsx` — der er det med vilje et startvalg brugeren derefter
ændrer selv).

**Ude:** oversættelser der mangler, ordbogens indhold, og sprogvalgets placering.
Intet af det er fejlen.

## Værnet

En kilde-test tæller `getLocale()`-kald i render-kroppe og går rød hvis tallet
stiger. Uden den genindfører den næste der tilføjer et panel præcis samme fejl —
og den vil se rigtig ud i review, fordi `getLocale()` er den mest oplagte
funktion at gribe efter.

## Verifikation

Sprogskiftet drives i browseren: DA → EN → DA mens man står på Konto-siden, og
den samme konkrete streng aflæses efter hvert skift. **Begge retninger**, fordi
et tjek der kun ser efter dansk består lige så grønt på en side der altid er
dansk. Plus en reload for at bekræfte at valget overlever.

## Reuse

Discovery-tjek: ingen `@broberg/*`-pakke ejer i18n. `apps/admin/src/lib/i18n.ts`
er appens egen, og hooken der løser problemet fandtes allerede — den var bare
ikke brugt. Intet at hente eller udvide udefra.
