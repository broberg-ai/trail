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
