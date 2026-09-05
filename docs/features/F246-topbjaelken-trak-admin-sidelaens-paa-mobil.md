# F246 — topbjælken trak hele admin sidelæns på mobilen

**Kort:** trail-F246 · high · ejer-meldt defekt (F180.6: fix + kort i samme tur)

## Motivation

Ejeren, 5/9 2026, med telefonskud af app.trailmem.com på iPhone: «Fix mobil det
kan ikke se sådan ud». Skærmbilledet viser «the wiggle»: siden trukket
sidelæns, kort klippet i venstre kant, tomrum til højre. Den globale beslutning
(01a06b42, 4/9) forbyder sidelæns rulning på mobil og kræver Lens-verifikation
ved 393px — OG at kritikerens grønne svar ikke står alene som bevis.

## Målt årsag (Lens flow 6ba0f927, 393px, prod)

Siden var **510 px bred — 117 px over viewporten**. Synderen: topbjælkens række
(logo-klynge «trail admin» + tenant-pille + ⌘K-knap + brugerpille) hvor intet
element måtte krympe. Kritikeren navngav brugerknappen ved x=414, w=96 → 510.
Begge piller (TenantSwitcher/UserMenu) HAVDE isMobile-støtte — TopNav
aktiverede den bare aldrig.

## Fix (scope)

Én medieforespørgsel i `apps/admin/src/index.css` (max-width 560px) + klasser:

- `.topnav-hide-mobile` på «admin»-teksten, ⌘K-teksten og brugernavnet
- `.topnav-tenant-label` → max-width 96px (ellipsis fandtes allerede)
- `.topnav-crumb` → max-width 110px på KB-brødkrummen
- data-testid på de tre knapper (topnav-palette / topnav-user-menu /
  topnav-tenant-switcher) — F086-ankre til Lens

Ingen resize-lyttere, ingen JS — CSS afgør det, så der ikke findes en
tilstand der kan drifte.

## Non-goals

- Ingen mobil-navigationsomlægning (sidebar/sheet-adfærd røres ikke)
- Ingen ændring af desktop-layoutet (AC beviser uændret 1280px)
- PWA-arbejdet er sit eget epic (ejers ordre samme dag) — ikke her

## Bevis

Lens ved 393px på prod: eget right-edge-assert (navngiver synderne) grønt +
kritiker high=0 + durable still. Desktop-capture ved 1280px uændret.

## Reuse

Ingen ny kapabilitet — ren CSS + eksisterende Lens/cardmem-flådeudstyr.
Discovery-tjek unødigt (ingen provider/integration involveret).
