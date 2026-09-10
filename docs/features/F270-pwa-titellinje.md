# F270 — Den installerede app skal ligne et rigtigt Mac-program

**Status:** in progress · **Rejst af:** Christian, 10/9 2026 (ejer-meldt, F180.6)

## Symptomet

Trail er installeret som app på hans Mac. Vinduets titellinje er creme — med
trafiklys, app-navn, puzzle-ikon og ⋮ — oven på et mørkt design. Det ligner en
macOS-begrænsning. Det er det ikke.

## Root cause — og det er IKKE manifestet

Den nærliggende forklaring er at manifestets `theme_color` er lys. Den er lys, og
den er rettet — men den er ikke fejlen. Metaen i `index.html` vinder over
manifestet så snart siden er indlæst, og den stod sådan her:

```html
<meta name="theme-color" content="#FAF9F5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#17140F" media="(prefers-color-scheme: dark)">
```

Farven var altså bundet til **styresystemet**. Men Trails tema følger ikke
styresystemet — `theme.ts` har to tilstande, gemt i `localStorage`, med **lys som
default uanset hvad maskinen står på**:

```ts
const DEFAULT: Theme = 'light';
function readStored(): Theme { return raw === 'dark' ? 'dark' : 'light'; }
```

De to kilder kan derfor være uenige, og i hans tilfælde er de det: app'en er
mørk, metaen spørger maskinen, og striben bliver lys. **En media-query kan ikke
udtrykke «brugeren valgte mørkt».**

En tredje uenighed lå ved siden af: manifestet sagde `#faf7f2`, app'ens lyse
palet siger `#FAF9F5`. To værdier for samme farve, ingen af dem forkert nok til
at nogen opdagede det.

## Løsning — niveau 1 (F270.1)

Én `theme-color`-meta, sat af **det tema der faktisk anvendes**:

- `theme.ts` skriver farven hver gang temaet anvendes — også ved et skift midt i
  en session, ikke kun ved opstart.
- Den blokerende bootstrap i `index.html` sætter den **før første maling**, så
  vinduet ikke blinker lyst hver gang app'en åbnes.
- Manifestet rettet til `#FAF9F5` — samme værdi som paletten.

## Niveau 2 — eget kort, ikke nu

`"display_override": ["window-controls-overlay"]` fjerner hele bjælken og lader os
tegne ind i titelområdet. Det er dét der får en PWA til at ligne et rigtigt
Mac-program — men det kræver `env(titlebar-area-*)` og et `-webkit-app-region:
drag`-område. **Glemmes træk-området, kan vinduet ikke flyttes**, og det er
værre end en grim stribe. Tages når niveau 1 er set på skærmen.

## To ubekendte som KUN en installeret app kan lukke

buddy bad os måle dem, fordi cardmem har samme sag åben og ingen installation:

1. Forsvinder ⋮ og puzzle-ikonet **helt** med window-controls-overlay?
2. Slår en manifest-ændring igennem **uden** at PWA'en geninstalleres?

Ingen af dem er besvaret endnu. De måles på den kørende app — ikke udledt af
koden. Svaret sendes til cardmem direkte.

## Reuse

Discovery-tjek: intet `@broberg/*`-modul dækker PWA-manifest eller titellinje.
Det er app-lokal markup. Ingen rå leverandør-integration.

## Hvad der beviser det

En prøve der er RØD hvis farven holder op med at følge det anvendte tema — og
derefter hans egne øjne på vinduet. Det sidste er det eneste rigtige bevis her:
en farve i en meta-tag er ikke det samme som en stribe der er væk.
