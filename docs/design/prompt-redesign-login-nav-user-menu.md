# Claude Design prompt — Trail login + main nav + user menu redesign

> Paste-ready brief for claude.ai (Sonnet/Opus). Attach the 5 screenshots
> listed at the bottom + the SVG logo before submitting.

---

## Context

**Trail** is a SaaS for AI-curated knowledge bases. Customers upload
sources (PDFs, audio, articles, etc.); Trail compiles them into
"Neurons" — atomic wiki-style notes that link to each other. End-users
chat against the resulting brain via embeddable widgets or the public
admin.

**Current product surfaces:**

| Surface | Domain | What |
|---|---|---|
| Landing | trailmem.com | Marketing site + post-style articles |
| Admin | app.trailmem.com | Multi-tenant curator app — login, manage tenants, edit Neurons, chat, settings |
| Engine | engine.trailmem.com | HTTP API only; no UI |
| Docs | docs.trailmem.com | Developer documentation (Markdown-rendered) |
| Widget | widget.trailmem.com | Embeddable `<trail-chat>` web component |

This redesign focuses on **app.trailmem.com** — specifically the login
flow + the persistent navigation chrome + the user/tenant menu.

## What's wrong with the current state

1. **Login is a generic Google OAuth bounce.** No brand presence on
   the sign-in path. Users land cold.
2. **No tenant switcher.** Users with access to multiple tenants
   currently see only the first one — there's literally no UI to
   switch. This redesign needs to introduce the affordance.
3. **User menu is just a name in the corner.** Should be a real
   menu: identity + tenant + plan + settings + logout.
4. **Top-bar visual hierarchy is flat.** Logo, KB-switcher, locale
   toggle, audio toggle, theme toggle all live as siblings with no
   grouping. It works but it's noisy.

## Brand tokens (already locked in code — do NOT change)

**Logo** — the Trail mark is three concentric circles with the inner
filled, expressed as `apps/admin/public/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <circle cx="16" cy="16" r="14" fill="none" stroke="#1a1715" stroke-width="2"/>
  <circle cx="16" cy="16" r="9" fill="none" stroke="#e8a87c" stroke-width="0.9" opacity="0.55"/>
  <circle cx="16" cy="16" r="3.5" fill="#e8a87c"/>
</svg>
```

In dark mode the outer ring flips to `#f5f1ea`.

**Color palette** (light → dark mode):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#FAF9F5` (warm cream) | `#17140F` (deep brown-black) | Page bg |
| `--color-bg-card` | `#FFFFFF` | `#1F1B16` | Cards, modals |
| `--color-fg` | `#1A1715` | `#F5F1EA` | Primary text |
| `--color-fg-muted` | `rgba(26,23,21,.70)` | `rgba(245,241,234,.70)` | Secondary text |
| `--color-fg-subtle` | `rgba(26,23,21,.40)` | `rgba(245,241,234,.40)` | Tertiary/hint |
| `--color-border` | `rgba(26,23,21,.10)` | `rgba(245,241,234,.10)` | Subtle dividers |
| `--color-border-strong` | `rgba(26,23,21,.20)` | `rgba(245,241,234,.20)` | Active dividers |
| `--color-accent` | `#E8A87C` (warm peach) | same | Brand accent — buttons, focus, brand mark |
| `--color-danger` | `#C2410C` | `#F97316` | Destructive |
| `--color-success` | `#15803D` | `#4ADE80` | Positive |

**Typography:**

- Sans (body, UI): `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif`
- Mono (code, IDs, wordmark): `ui-monospace, "SF Mono", "JetBrains Mono", "Fira Code", monospace`
- Serif (long-form reading, editorial): `"Fraunces", "Source Serif 4", Georgia, serif`

The wordmark "trail" is rendered in **SF Mono / Mono, 600 weight,
-0.02em letter-spacing**, at 18px mobile / 22px desktop (≥768px). The
secondary label "admin" sits next to it in regular weight, muted color.

**Aesthetic direction:**
Warm but technical. Editorial restraint. Generous whitespace.
Monospace for identity moments. Serif used very sparingly for
narrative content. Dark mode is genuinely beautiful (deep brown-black,
not pure black) and should be designed for, not bolted on. The peach
accent (`#E8A87C`) is the only chromatic moment — everything else is
neutral.

**Inspiration we like:** Linear (chrome restraint, command-K palette),
Vercel (typography quality), Notion (information density), Stripe
(form polish, dark-mode care). NOT: Salesforce, Slack, Microsoft 365.

## Tech stack constraints

- **Preact 10** (not React) — so prefer simple JSX over advanced
  React-only patterns
- **Tailwind v4 CSS-first** with the `@theme` directive — tokens
  above are exposed as CSS variables and consumable via
  `text-[color:var(--color-fg)]`, `bg-[color:var(--color-bg-card)]`
- **shadcn/ui** primitives where available (button, dropdown, dialog)
  — but the visual treatment can deviate
- **Lucide** for iconography (already a dependency)
- Browser support: modern only — assume CSS grid, container queries,
  `:has()` are fair game

Designs should be implementable as **components in `apps/admin/src/`**,
not standalone screens.

## What to design (priority order)

### 1. Login flow — `app.trailmem.com` signed-out

Currently bounces to Google. Replace with a branded sign-in page:

- Centered card on the warm-cream bg, ~420px wide
- Logo prominent at top, wordmark "trail" beneath
- A short value-statement (one sentence)
- "Continue with Google" primary button (peach accent)
- A subtle footer line with terms / privacy / docs links

Loading state when the OAuth round-trip is in flight. Error state if
Google denies. Branded "you're being logged in…" splash on the redirect
back from Google.

Mobile: same card, full-bleed, no margin shrinkage.

### 2. Main top-nav (persistent chrome)

The bar at the top of every admin screen. Current contents:

- Trail logo + "trail / admin" wordmark (link to home)
- KB switcher (dropdown of trails within current tenant)
- Right cluster: locale toggle (EN/DA), audio toggle, theme toggle,
  user name

The redesign should:

- Group related controls visually. Logo on the far left, KB-switcher
  next to it (it's the "current location" affordance). Far-right
  cluster groups user-related controls.
- Introduce a **tenant switcher** — see section 3.
- Consider a command palette / search affordance (Cmd+K) — currently
  hidden, should be a visible shortcut.
- Stay readable at narrow widths (down to ~720px). Mobile collapses
  the toggles into the user menu.

### 3. Tenant switcher (NEW component)

A user can have access to multiple tenants in their org. Right now
the admin auto-picks the first. The new UI:

- A pill/button next to the logo: shows current tenant name (e.g.
  "Sanne Andersen" or "Broberg.ai")
- Click → dropdown menu listing all accessible tenants, with the
  current one marked active
- Each entry shows tenant name + small plan badge ("hobby" / "pro")
- Searchable when count exceeds ~8
- "Manage tenants…" link at the bottom (links to settings)

Make it feel inevitable — the user should immediately understand
this is how they switch contexts. Not buried in a settings page.

### 4. User menu (top-right)

Replace the static name with a real menu. Click on
avatar/name/initials → dropdown:

- Header section: avatar + display name + email + current tenant
  badge
- Settings link
- Theme + locale + audio toggles (relocated from top-bar — they're
  user-personal, not app-global)
- Plan info: "Hobby plan · 18 / 200 Neurons used" with upgrade link
- Sign out (destructive, distinct visual)

Avatar: 28px circle. Falls back to colored initials with the user's
display-name hash as the background.

### 5. Mobile (≤720px)

- Top-bar collapses logo + tenant pill on the left; everything else
  goes into a hamburger / user menu
- Login card is full-width with adjusted vertical padding
- All dropdowns become bottom sheets

## Interaction details to spec

- **Hover, focus, active** states on every clickable surface — every
  button must have a visible `:focus-visible` ring (peach accent
  outline, 2px, 2px offset)
- **Loading** — primary buttons show inline spinner + disable. No
  full-screen blockers
- **Empty states** — if a tenant has no Neurons yet, the home screen
  needs a welcoming empty state with the first action
- **Animation** — subtle, 150-200ms cubic-bezier(.4,0,.2,1). No
  parallax, no scroll-jacking, no decorative motion. Menu open/close
  is a soft fade+translate, not a flip
- **Keyboard** — Cmd+K opens the search palette; Esc closes any open
  menu; Tab order is visible and logical

## Deliverables

For each of the 5 sections above:

1. **A mock** (or annotated wireframe) showing the layout in light +
   dark mode at desktop + mobile widths
2. **A short rationale** (3-5 sentences) — why this works for Trail
   specifically. Avoid generic "modern, clean, intuitive" — be
   specific to what the brand stands for
3. **Token references** — every color, every spacing value should
   cite the CSS variable name from the table above. No raw hex in
   the spec
4. **Microcopy** — sign-in CTA, tenant-switcher heading, empty-state
   text, error messages
5. **Edge cases I haven't thought of** — explicitly call them out
   ("what if a user belongs to 50 tenants?", "what if Google OAuth
   returns no email?")

## Explicit non-goals

- **Don't redesign the KB inner views** (Neuron editor, source list,
  queue, graph) — those are out of scope for this round
- **Don't propose new colors** — the palette is locked
- **Don't suggest a new logo** — the three-circle mark stays
- **Don't replace OAuth with something else** — the auth backend
  isn't changing

## Reference materials attached

- Screenshots: `01-current-login.png`, `02-current-admin-home.png`,
  `03-current-trail-inner.png`, `04-current-user-area.png`,
  `05-current-mobile.png`
- Logo SVG: `trail-logo.svg` (the three-circle mark above)
- Color swatch reference (optional): a single PNG with all
  tokens labelled

---

## On the screenshot question

**Yes, take screenshots.** Five specific ones:

1. **`01-current-login.png`** — the Google OAuth bounce page (or the
   "you're being signed in" splash if it's already brand-presenting)
2. **`02-current-admin-home.png`** — what you saw at app.trailmem.com
   after login: the "Trails" list, Sanne Andersen tenant active,
   "Neuroner på denne trail-server: 76", top-nav visible
3. **`03-current-trail-inner.png`** — click into Sanne Andersen, then
   into a KB, then into the Neuron editor or one of the panels. Shows
   how the chrome wraps content
4. **`04-current-user-area.png`** — close-up of the top-right corner:
   locale toggle, audio toggle, theme toggle, user name. Maybe with
   the user dropdown open (if there is one)
5. **`05-current-mobile.png`** — same admin home on iPhone width
   (~400px). Shows how the current layout breaks

Why these matter:
- Claude can analyze visual hierarchy, spacing, weight choices much
  better with the actual UI than from any description
- The redesign brief should be specific to what's GOOD that should be
  preserved (the warm palette, the mono wordmark) and what's WEAK
  (no tenant switcher, flat top-bar)
- A picture of "what it looks like now" is the cheapest grounding
  Claude can get

Bonus: a screenshot of **inspiration** sites (Linear's command palette
when open, Vercel's project switcher, Notion's sidebar) — but only if
you find a specific moment you want stolen. Otherwise the brief above
already names them so Claude can recall the patterns.
