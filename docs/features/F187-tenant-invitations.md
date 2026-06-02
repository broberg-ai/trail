# F187 — Tenant Invitations

**Status:** Spec locked 2026-05-30 · **Phase:** 2
**Effort:** M (1d efter spec-lock — backend-mekanikken eksisterede allerede)
**Depends on:** F40.2a (multi-tenant routing) · F186 (Manage Tenants UI)
**Spawned by:** F186 (designet kræver invitations-fane, der landede som "Coming Soon")

## Resolved decisions (locked 2026-05-30)

Spec'en blev låst da implementeringen åbnede `apps/admin-server/src/` og
opdagede at **invite-mekanikken allerede fandtes** (`/api/control/invite` +
`sendMagicLink` via Resend), og at membership-modellen er **én bruger → én
org** — der er ingen `role`-kolonne, ingen many-to-many `tenant_users`-tabel.
Det udelukker det fulde owner/admin/editor/viewer-RBAC som spørgsmål 3+6
forudsatte. Per Rule 2 (simplicity, ingen spekulativ abstraktion) bygges F187
oven på det eksisterende flow frem for at indføre et RBAC-lag resten af appen
ikke kan honorere.

| # | Spørgsmål | Beslutning |
|---|---|---|
| 1 | Invite-mekanik | **Magic-link, auto-opretter bruger** i inviterens org. Genbruger eksisterende `POST /api/control/invite` (allerede bygget). |
| 2 | Email-transport | **Resend** (`email.ts::sendMagicLink`, allerede wired; `RESEND_FROM=trail@webhouse.dk` i Phase 1). |
| 3 | Role | **Gemmes som forward-compat metadata** på invitationen. Genbruger `VALID_ROLES` fra `invite.ts` (`owner/admin/member/service`), UI-default `member`. **Ikke håndhævet** — RBAC er Phase 2+. |
| 4 | Levetid | **7 dage** på invitation-recorden. Magic-LINKET er fortsat 15 min; udløbet link → inviter re-inviterer → samme invitation-row får nyt link. |
| 5 | Revoke | **Enhver indlogget org-bruger** kan revoke en pending invite (ingen role-gate endnu). `DELETE /api/control/invitations/:id`. |
| 6 | Re-invite eksisterende org-bruger | **Opfrisker pending-row** (ny `expiresAt` + role) og re-sender link. `/invite` returnerer allerede `action='reinvited'`. |
| 7 | Audit-log | **Out of scope** — control.db har ingen `activity_log`-tabel. `console.log` bevares som det eksisterende endpoint gør. Ingen ny tabel opfindes. |

### Eksplicitte non-goals (efter lock)

- **Cross-org "accept/decline invitationer til DIG"** — umuligt i én-bruger-én-org-modellen; designets accept/decline-til-dig-UX er en Phase 2+ multi-org-feature.
- **RBAC-håndhævelse** (role bestemmer reelle permissions).
- **Bulk-invite (CSV)**, self-serve "ask for invitation", cross-tenant role-transfer, SAML/SCIM.
- **Tenant-oprettelse + billing** (forbliver "Coming Soon" i Manage Tenants).

## Motivation

F186 leverer Manage Tenants UI med Invitations-fane og row-action "Members".
Begge dele kræver et reelt invitation-flow før de kan blive funktionelle.
Designet (`docs/design/trail_app/src/manage-tenants.jsx::InvitationsList`)
viser exactly hvilken UX vi går efter — inviter, accept, decline, revoke.

Indtil F187 lander viser F186 "Coming Soon"-toast + tooltip på alle
invitation-handlinger.

## Scope (locked)

### In scope

- **`invitations`-tabel** i control.db (id, organization_id, email, role,
  invited_by_user_id, status, created_at, expires_at, accepted_at,
  accepted_user_id). Org-scoped — matcher én-bruger-én-org-modellen.
- **Server endpoints** (mounted under `/api/control`, genbruger eksisterende
  auth-cookie):
  - `POST /invite` — udvidet: sender magic-link (eksisterende) **+** upsert'er
    en pending invitation-row.
  - `GET /invitations` — lister org'ets invitationer (pending først).
  - `DELETE /invitations/:id` — revoke (status → `revoked`).
- **Accept-hook**: `GET /auth/verify` markerer matchende pending invitation
  `accepted` når et `intent='invite'`-magic-link forbruges (genbruger det
  eksisterende verify-flow — ingen ny accept-rute).
- **Manage Tenants Invitations-fane** funktionel: liste over pending/recente
  invitationer + inline invite-form (email + segmented role-picker, ingen
  native `<select>`) + revoke-knap. "Pending"-stat viser ægte tal.

### Non-goals

Se "Eksplicitte non-goals (efter lock)" ovenfor.

## Architecture (locked)

```
Inviter (Manage Tenants → Invitations-fane)
  → POST /api/control/invite {email, role}
    → (eksisterende) opretter/genfinder bruger i inviterens org
    → (eksisterende) sender magic-link via Resend, intent='invite'
    → (NYT) upsert invitations-row: status=pending, expires_at=now+7d
Invitee klikker linket
  → GET /auth/verify?token=…
    → (eksisterende) opretter session, stamper onboarded=true
    → (NYT) markerer matchende pending invitation accepted
    → redirect til /  (SPA viser tenant'en via /me)
Inviter revoker
  → DELETE /api/control/invitations/:id  → status=revoked
    (magic-linkets 15-min TTL gør et ubrugt link harmløst uanset)
```

## Verification plan

`apps/admin-server/scripts/verify-f187.ts` mod en temp control.db:
- `POST /invite` ny email → invitations-row pending, expires_at ≈ now+7d.
- `GET /invitations` → rækken er med, status=pending.
- Forbrug magic-link (verify) → invitation status=accepted, accepted_user_id sat.
- `DELETE /invitations/:id` på en anden pending → status=revoked.
- Re-invite samme email → samme row, frisk expires_at, status tilbage til pending.

## Rollout

- Phase 1 — backend (tabel + endpoints + accept-hook). ✅
- Phase 2 — UI (Invitations-fane fra "Coming Soon" → funktionel). ✅
- Begge i ét ryk til `main` (Trail er ikke i production endnu).

---

## F187.4 — Control-plane per-tenant membership roles + real role display

> **Follow-up story, added 2026-06-02.** Revisits the locked non-goal "ingen
> `role`-kolonne, ingen many-to-many `tenant_users`-tabel" (Resolved decisions
> §3). The placeholder shipped in F186; this story makes the role real.

### Motivation

The Manage Tenants "Din rolle / Your role" column is a **hardcoded placeholder**
— `apps/admin/src/panels/tenants.tsx:451-454` renders the literal string
`'medlem'` / `'member'` for **every** tenant, with the comment
`{/* AuthTenant doesn't carry role yet; placeholder. */}`. `AuthTenant`
(`apps/admin/src/api.ts:74-81`) has no `role` field, and `/api/auth/me`
(`apps/admin-server/src/auth.ts:158-230`) returns none — control.db has no
role model at all (membership = same `organization_id`). Result: Christian,
who is owner of everything in `broberg-ai`, shows as "medlem".

This collides with the standing rule that **`cb@webhouse.dk` is ALWAYS owner**
on all his tenants. There is no demotion *mechanism* today (every row-action is
a "Coming Soon" toast, so no lockout risk — the column simply lies), but the
display is wrong and the model can't express "cb owner på begge, Sanne owner på
sin tenant senere". F187.4 introduces the minimal real primitive.

### Scope (in)

- **`control_memberships` table** in control.db: `(user_id, tenant_id, role)`,
  role ∈ `owner | admin | member` (reuse `VALID_ROLES` from `invite.ts`),
  PK `(user_id, tenant_id)`, FKs cascade. Migration in
  `apps/admin-server/src/migrations.ts` (hand-written, matches existing pattern).
- **Backfill seed** (idempotent, runs in the migration): for every existing
  `(control_user, control_tenant)` pair in the same org, insert a membership
  row. **Seed role = `owner`** for the org's founding users so nobody loses
  standing — and explicitly `owner` for `cb@webhouse.dk` on every broberg-ai
  tenant. Never demote/remove cb's rows (UFRAVIGELIG-regel).
- **Thread role through**: `/api/auth/me` joins `control_memberships` for the
  signed-in user and adds `role` to each `tenants[]` entry; add `role` to
  `AuthTenant` (`api.ts`).
- **Render real role**: replace the hardcoded string in `tenants.tsx:451-454`
  with `tenant.role` (capitalised, i18n).

### Scope (explicit non-goals — unchanged from F187)

- **No RBAC enforcement.** Role is still display + data only; it does NOT gate
  any action yet (that stays a later story). This keeps Rule 2 intact — we add
  the column the model was missing, not a half-wired permission layer.
- No member-management UI (add/remove/change-role) — the "Members" row-action
  stays "Coming Soon". F187.4 only seeds + displays.
- No cross-org membership.

### Verification

`apps/admin-server/scripts/verify-f187-4.ts` against a temp control.db:
- Migration creates `control_memberships` AND seeds one row per existing
  user×tenant-in-org pair (assert count delta).
- `cb@webhouse.dk` has a `role='owner'` row for every broberg-ai tenant.
- `/api/auth/me` returns `tenants[].role` matching the seeded rows.
- Re-running the migration is a no-op (idempotent seed).

### Rollout

⚠️ Trail is now in production (Sanne is a live paying tenant; broberg.ai tenant
live). Per the prod-Fly-volume hard rule: **snapshot the trail-admin volume
before running the migration** (`flyctl volumes snapshots create … -a
trail-admin`), then deploy. The seed is additive (new table, INSERTs only) — it
never touches existing control_users/control_tenants rows.
