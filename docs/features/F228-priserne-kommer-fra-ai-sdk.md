# F228 — priserne vedligeholdes ÉT sted: @broberg/ai-sdk

**Kort:** trail-F228 · story · high
**Status:** bygget og committet i `f76cfa1` (3. september 2026)

> **Samme regelbrud som F227:** koden kom før planen. Skrevet 4. september så
> snart det blev opdaget. Rækkefølgen var forkert.

## Hvorfor

Ejeren, med skærmbillede af model-vælgeren i Trail-indstillingerne:

> *«Denne prisliste skal automatisk opdateres via ai-sdk, er det den der
> vedligeholder prislisten»* → *«Hvad priserne angår så skal de vedligeholde 1
> sted - i ai-sdk repo eller via en af dens npm funktioner»* → *«Og begynd at
> bruge @broberg/ai-sdk/pricing»*

Det var den ikke. To håndholdte tabeller — `chat-models.ts` og
`ingest-models.ts` — bar hver sit `costPerMillion`-tal, skrevet **13. maj 2026**
med kommentaren *«drift is expected»*.

## Hvad målingen viste

Målt 3. september mod SDK'ets egen prisliste:

```
7 af 9 stemte nøjagtigt
z-ai/glm-5.1              1,1× for høj   (bagatel)
mistral-large-latest      4,0× FOR HØJ   — $2/$6 vist, $0,50/$1,50 reelt
```

**Ét forkert tal, og det værst tænkelige.** Mistral Large er `smart`/`powerful`-
niveauet — altså vores kvalitetsvalg. Vælgeren fortalte ejeren at det kostede
fire gange hvad det gør, i fire måneder.

**En prisliste der er 89 % rigtig er ikke 89 % brugbar — den er en liste man
holder op med at tjekke.**

## Scope

**I scope:** `packages/shared/src/model-pricing.ts` — én facade oven på
`@broberg/ai-sdk/pricing`. `settings-trail.tsx` læser derfra.

**Non-goals:**
- Vi vedligeholder ikke priser her. Er et tal forkert, rettes det **i ai-sdk**.
- Ingen prishistorik eller forbrugsberegning i denne omgang.

## De tre ting facaden gør, som en rå import ikke gør

### 1. Rute ≠ model — `FREE_ROUTES`

**SDK'et prissætter en MODEL; om VI betaler afhænger af RUTEN.** Claude Sonnet
koster $3/$15 gennem API'et og **ingenting** gennem den lokale CLI på Max-planen
— samme model, to kendsgerninger, og kun Trail ved hvilken rute et id betyder.

Fanget mens dette blev bygget: uden skelnen svarede `modelPricing` $3/$15 for
den **gratis** lokale rute, og vælgeren ville have prissat et gratis valg som
vores dyreste. **Det er nøjagtig den fejl hele filen findes for at fjerne,
indført af rettelsen for den.**

### 2. Ukendt pris renderes som UKENDT, aldrig som et tal

`modelPricing()` returnerer `null` — ikke 0 — for et id ingen kender. *«Vi har
ingen pris for den»* og *«den koster $0»* må ikke se ens ud, og et efterladt
literal-tal er præcis hvordan de kommer til det.

### 3. SDK'et kan noget vores tabel ikke kunne: sige hvor gammelt det er

`pricingGeneratedAt()` giver snapshot-tidsstemplet, så et forældet tal kan
**ses** at være forældet. Vores egen tabel så lige troværdig ud i enhver alder —
og var fire måneder gammel.

## Arkitektur

```
@broberg/ai-sdk/pricing  (én kilde, hele flåden)
        ↓  getModelPrice() · pricingGeneratedAt()
packages/shared/src/model-pricing.ts   ← ALIASES + FREE_ROUTES + null-disciplin
        ↓
apps/admin/src/panels/settings-trail.tsx
```

`ALIASES` oversætter vores rute-suffiksede id'er (`…-api`) til SDK'ets model-
id'er. Bevidst **ikke** et gæt-fallback: et id der hverken står i ALIASES eller
i SDK'et giver `null`, og fladen siger det.

## Afhængigheder

`@broberg/ai-sdk` ≥ 0.38 (den version der kræver `region` på `Usage` — derfor
også den ene linje i `apps/server/src/lib/ai.ts`).

## Udrulning

`pnpm ship:admin`. Ingen migration.

## Hvad der IKKE er gjort endnu

`chat-models.ts` og `ingest-models.ts` har stadig deres gamle
`costPerMillion`-felter i typen. De læses ikke længere af vælgeren, men de står
der — og et efterladt tal er en fremtidig kilde nogen kommer til at bruge.
Bør fjernes, egen opgave.
