# F186 — Design 1:1 Port (Claude Design → Trail Admin)

**Status:** Planned · **Phase:** 1 · **Effort:** L (5-7d fordelt over flere sessioner)
**Depends on:** F40.2a (multi-tenant routing, shipped) · **Spawns:** F187 (invitations stub), F188 (user-level API keys stub)
**Owner:** trail cc · **Plan-locked:** 2026-05-28

## Motivation

Claude Design leverede 2026-05-21 et komplet redesign-forslag i `docs/design/trail_app/`
(10 sektioner React+Babel-standalone). Den nuværende admin er funktionel
men visuelt usammenhængende — 11-tab horizontal stripe i top-baren skalerer
ikke, tenant-skift findes ikke (admin vælger første tenant pr. org),
keyboard-power-user-flow mangler, og empty-states er ad-hoc pr. panel.

Beslutningen er truffet 2026-05-28: vi **fastholder vores stak** (Preact 10
+ Vite + Tailwind v4 + shadcn/ui + preact-iso), men porter Claude Designs
visuelle lag **1:1** — pixels, spacing, tokens, copy, states matcher
designet eksakt. Inline-`style={{...}}`-blokke i designets JSX oversættes
til Tailwind-utility-classes og shadcn-byggeklodser, men output skal være
visuelt identisk med `trail-admin-standalone.html`.

## Scope

### In scope

- **10 spec-sektioner** portes 1:1 (login, top-nav, tenant-switcher,
  user-menu, command-palette, empty-states, mobile, inner-trail sidebar,
  manage-tenants page, user-settings page)
- **Inner-trail sidebar erstatter 11-tab horisontal-stripen** — alle 21
  eksisterende panels mappes til den nye 4-gruppe navigation (`Brug` /
  `Kanon` / `Pipeline` / `Input`) + footer (Omkostning + Indstillinger)
- **Cmd+K command palette** — ny feature, vi har ingen i dag
- **Dedikerede ruter** `/settings` (user-level) og `/tenants` (manage)
- **Tenant-switcher pille** ved siden af logoet — multi-tenant synlighed
  fra dag 1 (`cb@webhouse.dk` skal se både `sanne-andersen` + `broberg-ai`)
- **Empty-states på ALLE 21 panels** (ikke kun de 3 designet viser)
- **Mobile-first sheets** via shared `components/ui/sheet.tsx` primitive
- **Constellation-baggrund** på Home, Manage Tenants, Settings og
  inner-trail panes (alle steder designet viser den)
- **Serif H1/H2** med `var(--font-serif)` overalt (allerede defineret)

### Non-goals (eksplicit OUT)

- **Stack-skift** — ingen React, ingen inline-styles, ingen babel-standalone.
  Vi beholder Preact/Tailwind/shadcn.
- **Tweaks-panel** (designets `tweaks-panel.jsx`) — det er Claude Designs
  prototype-værktøj, ingen produkt-værdi.
- **Backend-ændringer ud over multi-tenant `/me`-endpoint** (skal returnere
  liste af tenants, ikke kun den første)
- **Phone-frame wrapper** (`app.jsx::isMobile`) — det er en design-demo,
  vi vil have rigtige responsive breakpoints.
- **Plan-billing UI** — `plan` + `usage` skjules indtil F40.2b lander
- **Invitations + personal API keys** — separate F-features (F187, F188)
  med "Coming Soon"-stubs i denne port

## Locked decisions

Disse svar er frosset 2026-05-28 efter Niveau-2 walkthrough.
Afvigelse fra dem under implementering = ny tur med Christian, ikke
ensidigt fortolket.

### Login (Section 01)

| Q | Decision |
|---|---|
| Methods | Google + GitHub + Magic-link, **i den rækkefølge** ovenfra |
| Magic-link UX | Email-felt direkte under de tre OAuth-knapper (ikke modal) |
| 4 states fra designet | Cold, Redirecting, Splash, Error — alle portes |

### Top-nav (Section 02)

| Q | Decision |
|---|---|
| Logo-position | **Helt ud til venstre** (som designets `top-nav.jsx`) |
| Logo + wordmark størrelse | **Vores nuværende størrelse beholdes** (ikke designets) |
| KB-tabstribe | **Fjernes helt** — sidebar overtager navigation |
| Top-bar indhold | Logo · TenantSwitcher · ⌘K-palette · UserMenu |
| ⌘K-affordance position | **Højrestillet** mod UserMenu (afviger fra designets centrering — Christian's call) |
| KB-breadcrumb | **Vises i top-baren** når man er inde i en trail |

### Tenant switcher (Section 03)

| Q | Decision |
|---|---|
| Position | Ved siden af logoet (designets `tenant-switcher.jsx`) |
| Multi-tenant synlighed | **Begge tenants synlige i switcher fra dag 1** — kræver `/me`-fix til at returnere fuld tenant-liste |
| Switch-adfærd midt i trail | **Tilbage til Home** (viser den nye tenants trails) |
| Søgning | Filter-input når >8 tenants (designets default) |

### User menu (Section 04)

| Q | Decision |
|---|---|
| Theme/locale/audio placering | **Flyttes ind i user-menuen** (ud af top-bar) — "100x bedre" pr. Christian |
| Plan + usage progress bar | **Skjules indtil F40.2b lander** (ingen `plan`-data på tenant endnu) |
| Sign-out destination | Tilbage til `/login` med cleared session-cookie |

### Command palette (Section 05)

| Q | Decision |
|---|---|
| Trigger | ⌘K / Ctrl+K |
| Action-listen | Kører **på Enter** (ikke åbner modal) |
| Resultat-grupper | Recent neurons · Trails · Actions · Switch tenant (kun current tenant + tenant-switch som separat gruppe — designets default) |
| Cross-tenant search | **Nej** — kun current tenants neurons/trails |

### Empty states (Section 06)

| Q | Decision |
|---|---|
| Coverage | **ALLE 21 panels** skal have empty-state |
| Pattern | Designets `EmptyShell` (56×56 accent-ikon → serif H2 → muted body → primary + optional secondary CTA) |
| Shared component | Trækkes ud som `components/ui/empty-state.tsx` |

### Mobile (Section 07)

| Q | Decision |
|---|---|
| Funktionel mobile target | **JA** — reel responsive support |
| Bottom-sheets | Porteres som shared `components/ui/sheet.tsx` primitive (slide-up overlay fra skærmens bund) — bruges af TenantSwitcher, UserMenu, ManageTenants row-menu mfl. på mobil |
| Phone-frame wrapper | Droppes — vi bruger ægte CSS breakpoints |

### Inner-trail sidebar (Section 08)

| Q | Decision |
|---|---|
| Erstatter 11-tab-strip | **JA** |
| Bredde | **240px** (designets default) |
| Kollapsbar til icon-only | **JA** — toggle-knap (designet viser ingen, men det er Christians krav) |
| Gruppe-navne | `Brug` / `Kanon` / `Pipeline` / `Input` |

**Panel → sidebar slot mapping** (alle 21 panels, frosset):

| Panel i dag | Slot |
|---|---|
| `chat` | `Brug` → Chat |
| `search` | `Brug` → Søg |
| `wiki-tree` (= "Neurons"-listen) | `Kanon` → Neuroner |
| `glossary` | `Kanon` → Ordliste (under Neuroner) |
| `graph` | `Kanon` → Graf |
| `queue` | `Pipeline` → Kø |
| `work` | `Pipeline` → Arbejde |
| `jobs` | `Pipeline` → Jobs |
| `activity` | `Pipeline` → Aktivitet |
| `link-report` | `Pipeline` → Links |
| `sources` | `Input` → Kilder |
| `images` | `Input` → Billeder |
| `cost` | Footer → Omkostning |
| `settings-trail` | Footer → Indstillinger |
| **Uden sidebar-slot** (åbnes fra liste/action): | |
| `wiki-reader` | **Fusioneres med neuron-editor** — read-mode af samme view. Åbnes ved klik på Neuron i listen. |
| `neuron-editor` | Edit-mode af samme view. |
| `kbs` | **Forsvinder** — funktionen dækkes af Home + tenant-switcher |
| `play`, `quality-compare` | Power-user-værktøjer — Settings-gruppen (under footer Indstillinger som sub-tabs) |
| `settings-account` | **Flyttes til top-bar user-menu → `/settings`** (user-level, ikke trail-level) — omdøbes til **"Account Preferences"** |
| `not-found` | Ingen slot — fallback-route |

### Manage Tenants (Section 09, `/tenants`)

| Q | Decision |
|---|---|
| Stat-strip | **Active 30d** computes fra `activity_log` (last_active_at pr. tenant); skjules hvis data-grundlag mangler (degrade gracefully) |
| Invitations-fane | **"Coming Soon"** — F187 (separat plan-doc) |
| Row-action menu (Members/Plan & billing/Settings/Leave) | "Switch to" + "Settings" virker · Resten = **Coming-soon toast + tooltip** |
| Tabs | All · You manage · Invitations (Coming Soon) |

### User Settings (Section 10, `/settings`)

Omdøbes UI-mæssigt til **"Account Preferences"** (Christians krav).

| Sektion | Status i Phase 1 |
|---|---|
| Profile (display name) | **Funktionel** |
| Preferences (theme/locale/audio) | **Funktionel** — synced med user-menu kontroller |
| Notifications (digest/approvals/lint) | **Stub** — toggles synlige men ingen backend yet |
| Sessions (active sessions list) | **Stub** — viser "this device" + "sign out everywhere" disabled |
| Developer (personal API keys) | **"Coming Soon"** — F188 (separat plan-doc) |
| Danger (delete account) | **Funktionel** — kalder eksisterende user-delete endpoint hvis det findes; ellers stub med disabled-knap |

### Cross-cutting

| Q | Decision |
|---|---|
| Copy/i18n | Eksisterende keys i `apps/admin/src/locales/` **bevares**. Nye keys fra `data.js::TRAIL_STRINGS` (signInTitle, emptyTrailsBody, cpRecent osv.) **flettes ind** ved siden af. |
| Constellation-baggrund | **Overalt** designet viser den (Home, Manage Tenants, Settings, inner-trail panes) |
| Serif H1/H2 | `var(--font-serif)` — vi har den allerede. Følg designet. |
| Tweaks-frikobling | `app.jsx::TrailTweaksInline` droppes. `view`-state → `preact-iso` routes. `tweaks.tenant` → real `/me`-data. Alle `window.TRAIL_*` mocks → real API calls. |

## Architecture sketch

### Routes (preact-iso)

```
/                          Home (trails-liste for current tenant)
/login                     Login (Google/GitHub/Magic-link)
/login/redirect            Splash-state mens OAuth roundtrips
/tenants                   Manage Tenants page (F186)
/settings                  Account Preferences (F186)
/kb/:kbId                  Trail view (sidebar + main pane)
/kb/:kbId/chat             Chat panel
/kb/:kbId/search           Search panel
/kb/:kbId/neurons          Wiki-tree (= Neurons-list)
/kb/:kbId/neurons/:slug    Wiki-reader (single neuron, read mode)
/kb/:kbId/neurons/:slug/edit  Neuron-editor (edit mode)
/kb/:kbId/glossary         Glossary
/kb/:kbId/graph            Graph
/kb/:kbId/queue            Queue
/kb/:kbId/work             Work
/kb/:kbId/jobs             Jobs
/kb/:kbId/activity         Activity log
/kb/:kbId/links            Link-report
/kb/:kbId/sources          Sources
/kb/:kbId/images           Images
/kb/:kbId/cost             Cost (footer item)
/kb/:kbId/settings         Settings-trail (footer item)
/kb/:kbId/settings/play    Play (power-user sub-tab)
/kb/:kbId/settings/quality-compare  Quality-compare (power-user sub-tab)
```

### New shared components (`apps/admin/src/components/ui/`)

- `sheet.tsx` — bottom-sheet primitive (mobile + tablet)
- `empty-state.tsx` — `EmptyShell` mønster
- `tenant-switcher.tsx` — pillen ved siden af logoet
- `user-menu.tsx` — top-right pille + dropdown med preferences
- `command-palette.tsx` — ⌘K overlay
- `top-nav.tsx` — top-bar layout (logo · tenant · ⌘K · user)
- `trail-sidebar.tsx` — 240px sidebar med 4 grupper + footer
- `constellation.tsx` — baggrunds-decoration (canvas eller SVG)
- `plan-badge.tsx` — `<span class="plan-badge {plan}">` pille (matcher designets `.plan-badge.starter/pro/hobby`)

### Modified files

- `apps/admin/src/main.tsx` — router-tilføjelser
- `apps/admin/src/app.tsx` — fjern KB-tab-stripe, indsæt `<TopNav>` + `<TrailSidebar>`
- `apps/admin/src/index.css` — port `docs/design/trail_app/src/styles.css` 1:1 (tokens, animations, kbd, segmented, menu, sidebar-item) — overskriv eksisterende tokens hvis nødvendigt
- `apps/admin/src/panels/*.tsx` — hver panel får ny header/empty-state/styling så de matcher inner-trail-aesthetic
- `apps/admin/src/locales/{da,en}.ts` — flet nye keys ind
- `apps/server/src/routes/auth.ts` — `/me` skal returnere fuld tenant-liste, ikke kun primary

## Rollout phases

Hver fase = standalone shippable. Christian godkender før næste starter.

### Phase A — Chrome (TopNav + TenantSwitcher + UserMenu + sidebar shell)

Den synlige ramme uden at røre panel-indhold. Sidebar-items linker til
eksisterende routes, panels renderer uændret indenfor.

- TopNav layout (logo venstre, TenantSwitcher, ⌘K-pille højre, UserMenu)
- TenantSwitcher med dropdown + søgning + mobile-sheet
- UserMenu med theme/locale/audio + sign-out
- TrailSidebar (240px, 4 grupper + footer, kollaps-toggle)
- `/me`-endpoint returnerer fuld tenant-liste

**Effort:** 2-3d. **Verify:** Playwright e2e — login → multi-tenant
switch → sidebar collapse → ⌘K-pille klik åbner palette-shell (tom).

### Phase B — Login + Home + Empty states

Forsiden 1:1 + alle 21 panels får `<EmptyState>`-fallback.

- 3-knap Login (Google + GitHub + Magic-link) med 4 states
- Home med trails-liste + 3 empty-state varianter
- `<EmptyState>` shared component
- 21 panels updaterer deres empty-branch til at bruge komponenten

**Effort:** 1-2d. **Verify:** screenshot pr. panel-empty + login-state matrix.

### Phase C — Command palette

⌘K med 4 grupper (Recent neurons, Trails, Actions, Switch tenant),
keyboard-navigation, action-execution-on-Enter.

**Effort:** 1-2d. **Verify:** Playwright e2e — ⌘K åbner, søg "chat" →
Enter routes til chat-panel; søg tenant-navn → Enter switcher tenant.

### Phase D — `/settings` (Account Preferences) + `/tenants` (Manage)

Begge nye ruter. Funktionelle delmængder pr. tabellerne ovenfor.
F187/F188-stubs renderer "Coming Soon" hvor relevant.

**Effort:** 2d. **Verify:** route-walkthrough + theme-toggle-roundtrip.

### Phase E — Polish

- Inner-trail header-fix (KB-breadcrumb i top-bar)
- Constellation-baggrund på remaining views
- Per-panel header-rework (serif H1, mono-subtitle)
- i18n-flet QA (alle nye keys oversat DA+EN)
- Responsive QA <768px

**Effort:** 1-2d. **Verify:** manuel runthrough hver route DA+EN +
mobile viewport.

## Verification plan

### Per fase

- Playwright e2e i `apps/admin/tests/` der dækker happy-path
- Skærmbilleder af hver state — sammenlign med
  `docs/design/trail_app/trail-admin-standalone.html` i Chrome DevTools
- DA + EN lokalisering verificeret manuelt
- Mobile (390px) + desktop (1440px) viewport-checks

### Final acceptance criteria

1. `cb@webhouse.dk` ser begge sine tenants i TenantSwitcher
2. ⌘K åbner palette; Enter på en action skifter route
3. Sidebar viser alle 21 panels mappet til riktige slots
4. `/settings` viser theme/locale/audio synced med user-menu
5. `/tenants` viser tenants-tabel + Coming Soon-toast på unimplemented actions
6. Mobile (390px viewport): TenantSwitcher åbner bottom-sheet, sidebar
   bliver hamburger-menu, top-bar collapse'er korrekt
7. Lighthouse score for `/` (Home) ≥ 90 (perf + a11y) — vi er på Preact, det burde være trivielt
8. Visuel diff vs. `trail-admin-standalone.html` pr. sektion < 5% pixel-difference (eyeball-test, ikke automated)

## Dependencies

- **F187** (tenant invitations) — Manage Tenants page kalder "Coming Soon"-toast indtil F187 lander
- **F188** (user-level personal API keys) — Settings → Developer-sektion viser "Coming Soon" indtil F188 lander
- **F40.2b** (tenant provisioning + plan/billing) — UserMenu plan-progress + Manage Tenants plan-badges går live når F40.2b lander

## Open questions (skal afklares før implementation)

Per Niveau-2 walkthrough er der ingen åbne questions tilbage på user-level —
alt er locked i tabellerne ovenfor. Disse spørgsmål kommer fra
implementation-perspektiv og kan løses af cc undervejs:

1. **Sidebar collapse-state persistens** — localStorage eller user-preference på serveren? **Default:** localStorage indtil F188 lander.
2. **i18n-key navngivning for nye keys** — bruger jeg designets exact key-navne (`signInTitle`, `cpRecent`) eller normaliserer jeg til vores eksisterende prefix-konvention (`auth.signIn.title`)? **Default:** normaliser til vores konvention, men dokumenter mapping i `locales/_design-mapping.md` så designets reference er linket.
3. **OAuth callback-state-handling** — Hvor lander brugeren efter Google/GitHub-roundtrip? `/` eller en explicit `?return=`-param? **Default:** `/` indtil deep-link-flow bliver et reelt krav.
4. **Cmd+K-palette aktivering på iOS Safari** — `⌘K` virker ikke på touchscreens. **Default:** ekstra `+` floating-action-button i bottom-right på mobile/tablet der åbner samme palette.

## Risks / unknowns

- **Animation-portering**: designets `anim-fade`, `anim-menu`, `anim-palette` keyframes
  defineret i `styles.css` skal ind i vores `index.css`. Tailwind v4 `@theme`
  spiller fint med custom keyframes, men jeg verificerer i Phase A.
- **shadcn-komponent-konflikt**: hvis vores eksisterende shadcn `<Button>` / `<Dialog>` /
  `<Command>` styling kolliderer med designets, går designets style vinder. Vi kan
  ende med at fork'e nogle shadcn-komponenter til `components/ui/` med
  designets klasser. Dette afgøres ved første kollision, ikke up-front.
- **Constellation-baggrund**: `styles.css` har en `.constellation`-class men jeg har
  ikke verificeret om den er ren CSS eller kræver JS-animation. Hvis det er JS,
  porter jeg som lightweight Preact-komponent.
- **`/me` tenant-list**: F40.2a leverede `key-index.db` men admin-server endpoint
  returnerer stadig kun primary. Phase A includes server-fix. Hvis det viser sig
  at kræve større refactor, splittes det ud som F189 og Phase A-sidebar-shell
  hardcoder tenant-listen indtil da.

## Why not just hand-roll new admin?

Designet er allerede leveret som komplet 6095-linje JSX referenceimplementering.
Vi sparer 2-3 dage på at have visuelt-eksakt source-of-truth. Risiko ved
"inspireret af"-port er drift mellem cc-sessioner over tid — 1:1 fastlåser
target og gør visuel QA muligheden ("matcher det?", ikke "er det smukt nok?").
