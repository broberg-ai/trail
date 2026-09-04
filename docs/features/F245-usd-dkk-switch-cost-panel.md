# F245 — USD/DKK-switch på Cost-panelet

**Ejerens ønske 4/9-2026:** «Lav en switch mellem USD og DKK: https://app.trailmem.com/kb/broberg-ai/cost»

## Motivation

Cost-panelet viser i dag valuta efter SPROG: dansk locale → DKK (når ECB-kursen kan hentes), ellers USD. Christians admin kører engelsk, så han ser altid USD — og der er ingen måde at vælge DKK uden at skifte sprog på hele fladen. Valuta og sprog er to forskellige valg.

## Scope

- Eksplicit toggle USD | DKK i Cost-panelets header (ved siden af 7d/30d/90d/1y), `data-testid="cost-currency-usd"` / `"cost-currency-dkk"`.
- Default = nuværende adfærd (da→DKK, ellers USD); et klik overstyrer og huskes pr. browser (localStorage, try/catch — får værdien ikke frem, gælder defaulten).
- FX-kursen hentes når valget er DKK (ikke kun når locale er da). Kilden er uændret: ECB/Frankfurter via backendens 4t-cache; `stale`-kurs viser fortsat `~`-præfiks.
- Kan kursen ikke hentes, falder visningen tilbage til USD — og DKK-knappen viser at den ikke kunne (ingen stille forkert visning).
- `lib/currency.ts` får en eksplicit-valuta-formatter; `formatCostForLocale` bliver en wrapper så quality-compare.tsx er urørt.

## Non-goals

- Ingen egen kurs-tabel — én kilde (ECB via backend-cachen) som i dag.
- Ingen ændring af lagringen: cost er og bliver USD-cents i databasen; DKK er ren visning.
- Ingen valuta-switch på andre paneler i denne omgang (quality-compare følger stadig locale).

## Reuse

Genbruger eksisterende getFxRate + formatDkk/formatUsd — hele FX-infrastrukturen findes (F151). Ingen ny afhængighed.

## Verifikation

Typecheck + build. Efter deploy (afventer ejers freeze): Lens på /kb/broberg-ai/cost — klik DKK-knappen, assert at Total-tallet skifter fra `$`-format til `kr`-format og at valget overlever en genindlæsning (localStorage-persistens læst tilbage fra frisk load).
