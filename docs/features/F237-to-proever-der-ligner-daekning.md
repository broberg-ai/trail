# F237 — to prøver der ligner dækning og ikke er det

**Kort:** trail-F237 · story · medium

## Fundet ved at skærpe et spørgsmål, ikke ved at lede

cardmem påpegede at min gate-vagt målte den svage egenskab: den spurgte om en
pakke **erklærer** et test-script, ikke om scriptet **når** filerne.
`"test": "bun test src/"` med en prøve i `tests/` består den og kører aldrig.

Målt i samme åndedrag:

```
sporede testfiler   28
kørt af porten      26
unåede               2
```

*(Min første udtrækning sagde 4. Den var forkert — awk læste det forkerte felt.
Samme fejlklasse som resten af døgnet, nu i mit eget måleværktøj. Rettet før den
nåede længere end én sætning.)*

## De to filer

```
apps/widget/tests/admin-image-carousel.spec.ts
apps/widget/tests/multi-tenant.spec.ts
```

**Tre grunde til at de aldrig kører, og hver af dem er nok:**

1. `apps/widget` er **ekskluderet fra pnpm-workspacet** (`!apps/widget`), så
   turbo når den ikke uanset hvad dens `package.json` siger.
2. Den har intet `test`-script.
3. Ingen CI-workflow kalder dem.

## Og de importerer rå Playwright, som er forbudt her

```ts
import { test, expect } from '@playwright/test';
```

F112 i `CLAUDE.md` er entydig: browser-automatisering går gennem **Cardmem
Lens**, aldrig rå Playwright.

**Men de brød ikke en regel.** Målt: filerne er fra **20.–30. maj**; reglen
landede i `CLAUDE.md` **15. juni**. De er ældre end forbuddet. **Reglen kom, og
ingen gik tilbage.** Det er en anden historie end en overtrædelse, og den
fortjener at blive fortalt rigtigt.

`playwright.config.ts` og `scripts/verify-admin-ui.ts` i samme mappe har samme
form. `@playwright/test` står som devDependency præcis dét ene sted.

## Hvorfor det er værre end ingen dækning

En prøvefil i repoet ser ud som dækning. `multi-tenant.spec.ts` hedder noget der
lyder som en garanti — *«proves that the engine's F40.2a routing correctly
serves each tenant»*. Den beviser ingenting, fordi den ikke kører.

**Ingen dækning er ærligt. Dækning der ikke kører er en påstand.**

## Beslutningen er ikke taget her

To veje, og valget er ejerens:

| | |
|---|---|
| **Konvertér** | Skriv dem om som Lens-manuskripter. Bevarer den hensigt der var i dem — multi-tenant-routing er værd at prøve |
| **Slet** | De er døde, forbudte og forældede. Fjern dem, og fjern `@playwright/test` med |

**Jeg har ikke slettet dem.** At fjerne prøver — også døde — er ejerens
beslutning, og der er reel værdi i hensigten bag `multi-tenant.spec.ts`.

## Imens: pinnet, ikke muted

Vagten fejler ikke porten, og den tier heller ikke. Den **navngiver præcis de
to** og kræver at mængden er nøjagtig dem:

- kommer der en tredje → **rød**
- bliver de rettet eller slettet → **rød**, med besked om at fjerne pinnen

Det er samme teknik som synonym-listen i F219: en påstand man ikke kan glide ud
af, hverken ved at tilføje eller ved at rette.

## Vagten fik to blinde pletter lukket undervejs

Den ville ikke selv have fundet dette:

1. Den talte kun testfiler under `src/`. Widgetens ligger i `tests/`.
2. Den vidste ikke at en pakke kan være **uden for workspacet**, hvor intet
   script kan redde den.

Begge er samme klasse som den cardmem fandt i deres egen udgave: **en antagelse
om layout, skrevet i vagten frem for læst fra kilden.** Workspace-mapperne
læses nu fra `pnpm-workspace.yaml`.

**Og et tredje udfald blev tilføjet:** et script vagten ikke kan tolke
(`bash scripts/test.sh`) rapporteres som **`unverifiable`**, aldrig som dækket.
«Vi tjekkede og det er fint» og «vi kunne ikke tjekke» må ikke se ens ud.
