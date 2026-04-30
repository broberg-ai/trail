# F172 — Self-service onboarding (sign-up + first trail)

**Status:** Planned · **Phase:** 2 (lands after F33 Phase 1B) · **Owner:** trail-server · **Drives:** none

## TL;DR

Today onboarding is hand-provisioning: Christian + cc create rows in
`control.db` via SQL, mint a Bearer key via the F111.2 bridge script,
and hand the values over. F172 closes that loop with a self-service
flow on `app.trailmem.com`:

1. **`/onboarding`** — new users land here from the "Initialize trail"
   CTA on www.trailmem.com. Email + tenant-name inputs. System creates
   org, user, control_tenant, first KB, allocates an engine, sends a
   magic-link. Magic-link click logs them in to their fresh trail.db.
2. **`/login`** — existing users land here from the "Sign in" CTA.
   Email input. System sends magic-link. Click → logged in to their
   tenant's admin.

Magic-link auth on its own (Phase 1B) only works for accounts that
already exist. F172 is the bridge: a way for an account to come into
existence without operator-in-the-loop.

## Motivation

- **Operator scaling.** Phase 1A onboarded Sanne via SSH + SQL. That's
  fine for customer #1; impossible at customer #20.
- **Demo path.** A prospective customer landing on trailmem.com today
  has nowhere to go. The "Initialize trail" button is dead-link
  (`href="#"`). Until F172, the marketing site is a brochure with no
  trial flow.
- **Org boundary at signup, not later.** F33's `control_tenants` schema
  treats org → tenants as 1:N (one org can have many tenants). The
  cleanest moment to create the org is at first-signup; later
  conversions ("user wants a second tenant") are easier when the org
  already exists from day 1.

## Scope (in)

### 1. Two routes on the admin SPA

`apps/admin/src/routes.tsx` mounts two new top-level routes that don't
require auth (everything else does):

```
/login        — email entry → POST /api/auth/magic-link → "check your email"
/onboarding   — email + org-name + tenant-name entry → POST /api/auth/sign-up
                → "check your email" (magic-link arrives, completes setup)
/auth/verify  — magic-link landing page → sets session cookie → redirects
                to admin home (or /onboarding/welcome if first-time)
```

Both `/login` and `/onboarding` use the same `<EmailEntryForm>` component
(shared visual + validation), differentiated by which submit endpoint
they hit and what extra fields they show.

### 2. Onboarding wizard — three short steps

```
Step 1: Identity
  ── Email          [you@example.com]
  ── Your name      [Sanne Andersen]
  ── Continue →

Step 2: Your organization
  ── Org name       [Sanne Andersen]      (defaults to "Your name")
  ── URL slug       [sanne-andersen]       (auto-generated, editable)
  ── Continue →

Step 3: Your first trail
  ── Trail name     [Default Trail]
  ── Language       [Danish ▾]              (auto-detect from browser)
  ── Create my Trail →
```

Each step is a small modal-card; back/forward buttons preserve state
in URL params (`/onboarding?step=2&email=...&org=...`) so a refresh
doesn't lose progress. Submit on Step 3 fires `POST /api/auth/sign-up`
with the full payload.

### 3. Server-side `/api/auth/sign-up`

Lives on **admin** (`trail-admin` Fly app), writes to its `control.db`.
Logic:

```typescript
async function handleSignUp(input: {
  email: string;          // primary user email
  name: string;           // user display name
  orgName: string;
  orgSlug: string;        // pre-validated unique
  tenantName: string;
  tenantSlug: string;     // pre-validated unique (could == orgSlug)
  language: string;       // 'da' | 'en' | 'de' default 'da'
}) {
  // Reject if email or slug already taken
  await assertEmailFree(input.email);
  await assertOrgSlugFree(input.orgSlug);
  await assertTenantSlugFree(input.tenantSlug);

  // Create the chain in one transaction
  await control.transaction(async (tx) => {
    const orgId = `org-${input.orgSlug}`;
    await tx.insert(organizations).values({ id: orgId, slug: input.orgSlug, name: input.orgName });

    const userId = `u-${randomBytes(8).toString('hex')}`;
    await tx.insert(controlUsers).values({ id: userId, organizationId: orgId, email: input.email, name: input.name });

    const tenantId = `t-${input.tenantSlug}`;
    await tx.insert(controlTenants).values({
      id: tenantId, organizationId: orgId,
      slug: input.tenantSlug, name: input.tenantName, language: input.language,
    });

    // Engine assignment: F170 picks; pre-F170 default to engine-001
    const targetEngine = await pickEngine();
    await tx.insert(tenantEngines).values({
      tenantId, engineId: targetEngine.id, engineUrl: targetEngine.url,
      provisionedAt: nowIso(),
    });
  });

  // Provision empty tenant.db on the chosen engine via F168 import
  // with a synthetic empty seed (F168's force-replace path writes
  // an empty trail.db with just the schema + the new tenant + user
  // rows, and an empty knowledge_bases row for the first trail).
  await provisionEmptyTenant({
    engine: targetEngine,
    tenantId, tenantSlug: input.tenantSlug,
    user: { id: userId, email: input.email, name: input.name, role: 'owner' },
    kb: { slug: input.tenantSlug, name: input.tenantName, language: input.language },
  });

  // Send magic-link (Resend)
  await sendMagicLink({ email: input.email, intent: 'welcome' });

  return { ok: true };
}
```

### 4. Empty-tenant provisioning — `provisionEmptyTenant()`

This is where engine + tenant.db come alive for a fresh sign-up.

The cleanest path reuses F168's existing import endpoint with a
machine-generated empty seed:

```typescript
async function provisionEmptyTenant(opts) {
  // Build a tar containing:
  //   manifest.json  (beam_version=1, fresh tenant)
  //   trail.db       (empty schema + 1 tenant row + 1 user row + 1 KB row)
  //   uploads/       (empty dir)
  const seed = await buildEmptyTenantSeed(opts);

  // POST to engine /internal/beam/import (BEAM_TOKEN auth). Engine
  // untars to staging, atomic-renames to /data/{slug}/.
  await postToEngine(opts.engine.url + '/api/internal/beam/import', seed, {
    'X-Beam-Slug': opts.tenantSlug,
    'X-Beam-Sha256': seed.sha256,
    'X-Beam-Filename': `${opts.tenantSlug}-init.beam.tar`,
  });

  // Restart engine to pick up the new /data/{slug}/trail.db
  await restartEngineMachine(opts.engine.id);
}
```

The empty seed is built locally on admin (admin has all the schema —
it imports `@trail/db` to spin up an in-memory libSQL, runs migrations,
inserts the 3 rows, dumps to a buffer, tars). ~20 lines.

### 5. Magic-link verify route

`/auth/verify?token=...` on admin:
1. Look up token in `control.db` magic_links table
2. Check expires_at > now and used_at IS NULL
3. Mark used; insert session cookie row; set `Set-Cookie: trail-session=...`
4. If user.onboarded === false:
   - Set onboarded=true
   - Redirect to `/onboarding/welcome` (a cheerful "Your Trail is ready"
     screen with next-step nudges)
5. Else redirect to admin home `/`.

### 6. Resend integration

Magic-link emails go through Resend (already used in webhouse-app for
password resets — same vendor, same pattern, separate API key per app).

Required Fly secrets on `trail-admin`:
- `RESEND_API_KEY` (separate from webhouse-app's; per-app Resend key)
- `RESEND_FROM` — **Phase 1: `trail@webhouse.dk`**. Resend currently has
  only `webhouse.dk` verified for Christian's account, so trailmem.com
  cannot send until SPF+DKIM+DMARC records are added (DNS Manager MCP
  call + Resend domain verification, ~15 min). Use `webhouse.dk` until
  then — emails arrive from "Trail <trail@webhouse.dk>" which is
  acceptable for a soft-launch beta. **Phase 2: migrate to
  `noreply@trailmem.com`** once domain is verified; flip secret + send
  one test email to confirm; no code change needed.
- `MAGIC_LINK_BASE_URL` (default `https://app.trailmem.com`)

Email template (HTML + text):
```
Subject: Your Trail is ready
Body:    Click here to log in: {magic-link}
         The link expires in 15 minutes.
```

For onboarding-flow emails the subject is "Welcome to Trail" and the
body has a 1-line context ("Your Trail '{tenantName}' is set up.")

### 7. Landing page CTA wiring

`apps/landing/build.ts` already renders the two CTAs in
`apps/landing/templates/landing.html` (or wherever — I'll grep when
implementing). Both currently `href="#"`. F172 changes them to:

- "Sign in" → `https://app.trailmem.com/login`
- "Initialize trail" → `https://app.trailmem.com/onboarding`

Two-line edit + redeploy of `trail-landing`.

### 8. Slug uniqueness + reservation

`control.db` already has `UNIQUE` on `organizations.slug` and
`control_tenants.slug`. Frontend validates as the user types via
`POST /api/auth/check-slug` returning `{ available: bool }`. Reserved
words: `admin`, `api`, `app`, `auth`, `engine`, `engine-NNN`, `www`,
`mail`, `support`, `help`, `system`. Frontend rejects with friendly
error.

Email uniqueness is global (across orgs). Two orgs sharing one human's
email is not supported in Phase 2; that requires per-org user invites
(future feature).

## Scope (out / explicit non-goals)

- **Multi-user invites at sign-up.** Onboarding creates ONE user (the
  signup-er) as owner. Inviting team members ("u-cb-webhouse" alongside
  "u-sanne") is a future feature (admin → Settings → Invite). For
  Sanne in particular, Christian was added by hand; future Sannes will
  invite operators themselves.
- **Billing / Stripe sign-up.** Free tier on sign-up; payment step is
  separate F-number (likely F156 phase).
- **Domain verification for orgs.** Org slug doesn't need email-domain
  match. Anyone can pick "sanne-andersen" if it's free.
- **Trial expiry / pause.** No tenant lifecycle in F172 — accounts
  stay active until manually retired by operator.
- **Data import wizard.** "Bring your existing PDFs to Trail" is not
  in onboarding. Customer is onboarded with empty Trail; first ingest
  is via the regular admin flow.
- **Social-login (Google / GitHub).** Magic-link only in F172. OAuth
  is F35 (already on roadmap), can layer on top later.
- **Existing-user "claim this tenant" flow.** A user with an email
  that's already taken on a different org can't sign up — they get
  "this email is already in use; sign in instead". No merge / claim
  logic.

## Architecture sketch

```
www.trailmem.com (static)
  ├─ "Initialize trail" → app.trailmem.com/onboarding
  └─ "Sign in"          → app.trailmem.com/login

                                       ↓
                       app.trailmem.com (Fly: trail-admin)
                                       ↓
   ┌────────────────────────────────────────────────────────────────┐
   │                                                                │
   │  /login            — email entry → magic-link → /auth/verify   │
   │                                                                │
   │  /onboarding       — wizard (email, org, first-trail)          │
   │     └─ POST /api/auth/sign-up                                  │
   │          ├─ INSERT organizations + control_users               │
   │          ├─ INSERT control_tenants + tenant_engines            │
   │          ├─ provisionEmptyTenant() → POST engine /beam/import  │
   │          └─ sendMagicLink(email, intent: 'welcome')            │
   │                                                                │
   │  /auth/verify       — token → set session cookie → /           │
   │     └─ if first-time: → /onboarding/welcome                    │
   │                                                                │
   │  control.db                                                    │
   │     organizations | control_users | control_tenants            │
   │     tenant_engines | magic_links | sessions                    │
   │                                                                │
   └────────────────────────────────────────────────────────────────┘
                                       ↓ (provision call)
                                       ↓
                    engine-NNN.trailmem.com (Fly: trail-engine-NNN)
                       /api/internal/beam/import  (F168, BEAM_TOKEN)
                       → /data/{tenantSlug}/trail.db
                       → restart engine machine
```

### Key invariants

- **Org → tenant cardinality.** Sign-up creates 1 org + 1 user + 1
  tenant + 1 KB. The schema supports many tenants per org; UI
  exposes that later via "Add another Trail to this org" in admin.
- **Magic-link is the only auth surface.** No password storage. All
  auth state derives from `magic_links` (single-use, 15-min TTL) +
  `sessions` (cookie-backed, 30-day rolling).
- **Slug uniqueness is global per type.** Two different orgs cannot
  both have slug `sanne`. Two different tenants cannot share slug
  even across different orgs. Engine sees flat slug-space and routes
  on it.
- **Atomic at cutover.** Provisioning is two steps (control.db txn
  + engine beam-import). If the beam fails, the control.db txn is
  rolled back. The user gets "something went wrong, try again" and
  no partial state remains.
- **Email = identity.** A user's email is their canonical handle.
  Renaming users is not supported. Renaming orgs/tenants is — slug
  stays stable, name is editable.

## Dependencies

- **F33 Phase 1B** — admin Fly app (`trail-admin`) must be deployed
  before F172 can land. Magic-link auth infrastructure is built
  there; F172 just adds the sign-up wizard on top.
- **F168** — `/internal/beam/import` endpoint is reused for empty-
  tenant provisioning.
- **F169** — `pickEngine()` calls into the engines catalog. Pre-F170,
  default to engine-001 with capacity check (refuse signup if
  engine-001 has > N tenants and no other engine available).
- **Resend account** — Christian already has one for webhouse-app.
  F172 adds a separate API key + sender domain for trailmem.com.
- **DNS for sender** — `noreply@trailmem.com` requires SPF + DKIM +
  DMARC records. Trivial via DNS Manager MCP.

## Rollout

### Phase 1 — Login flow only (~½ day)

1. `/login` route on admin
2. POST /api/auth/magic-link
3. /auth/verify
4. Resend integration + DNS setup for sender domain
5. Verify-script: round-trip a magic-link locally (Resend test mode)

This makes login work for users who already exist (Sanne,
cb@webhouse.dk). Unblocks Phase 1B admin even without sign-up flow.

### Phase 2 — Onboarding wizard (~1 day)

1. `/onboarding` route + 3-step wizard
2. POST /api/auth/sign-up + slug-validation endpoint
3. provisionEmptyTenant() with empty-seed builder
4. /onboarding/welcome screen
5. Wire landing CTAs to /login and /onboarding
6. Verify-script: sign-up → confirm tenant in control.db → confirm
   trail.db on engine has the right shape.

### Phase 3 — Polish

1. Slug-suggestion UI (show "available" / "taken" as user types)
2. "Resend magic-link" if first email got lost
3. Friendly error states for "email already used" → suggest /login
4. Email rate-limit (prevent abuse: max 5 magic-links per email per hour)

## Open questions

- **Email rate-limiting** — should it live in admin or in front of admin
  (Cloudflare WAF rule)? Phase 1 simple in-admin counter; Phase 2 maybe
  upgrade.
- **Reserved-slug list** — keep it static or allow per-environment
  override? Static for now; revisit if a customer wants a slug we've
  reserved (likely it's reserved for good reason).
- **Magic-link link-format** — `app.trailmem.com/auth/verify?token=...`
  is fine but exposes token in browser history. Consider POST-only
  verify with form-submit on click (more friction but safer). Phase 3.
- **Internationalisation** — onboarding wizard copy is in English first;
  Danish strings are populated as the existing i18n infra. F172 ships
  with EN + DA at minimum.

## Verification plan

`apps/admin/scripts/verify-f172-onboarding.ts`:

1. **Sign-up happy path** — POST /api/auth/sign-up with synthetic
   email/org/tenant. Assert:
   - 1 row in organizations, control_users, control_tenants,
     tenant_engines
   - empty trail.db materialized at /data/{slug}/ on the chosen engine
   - magic-link email queued to Resend (test-mode token captured)
2. **Slug collision** — sign up twice with same orgSlug → second one
   400s with "already taken".
3. **Email collision** — sign up twice with same email → second one
   400s with "use sign-in instead".
4. **Reserved slug** — try `admin`, `system`, `engine-001` → 400s
   with "reserved".
5. **Magic-link verify happy path** — POST sign-up, capture token,
   GET /auth/verify?token=... → asserts session cookie set, user
   onboarded=true, redirect to /onboarding/welcome.
6. **Magic-link expiry** — POST sign-up, fast-forward 16 minutes,
   GET /auth/verify → 401 with "link expired".
7. **End-to-end with provisioned engine** — after sign-up, the new
   user's Bearer-key minting via admin works (round-trip the F111.2
   panel — uses the same control.db rows just provisioned).
