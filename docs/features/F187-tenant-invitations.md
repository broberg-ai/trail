# F187 — Tenant Invitations

**Status:** Planned (interim plan-doc — open questions øverst) · **Phase:** 2
**Effort:** M (2-3d, estimat før spec-lock)
**Depends on:** F40.2a (multi-tenant routing) · F186 (Manage Tenants UI)
**Spawned by:** F186 (designet kræver invitations-fane, der landede som "Coming Soon")

## Open questions (skal afklares før spec lockes)

1. **Invite-mekanik**: Magic-link email til ny bruger (krævet konto efterfølgende),
   eller eksisterende-user-only (kan kun invitere folk der allerede har Trail-konto)?
2. **Email-transport**: Resend (vi bruger det på webhouse.app), Postmark, eller
   smtp direkte fra Fly app? **Fly har ikke smtp out-of-the-box**, så Resend er
   default antagelsen indtil andet besluttes.
3. **Role-tildeling ved invitation**: Inviter vælger rolle (owner/admin/editor/viewer)
   ved oprettelse — eller en default `editor` der kan opgraderes efter accept?
4. **Pending-invitations levetid**: Aldrig udløber, eller fx 7-dages window
   før invitation auto-cancels?
5. **Revoke flow**: Kan en pending invitation cancelles af inviter? Hvilken role
   må cancel'e en andens invite?
6. **Tværgående tenant-policy**: Hvis bruger X allerede er medlem af tenant Y med
   role `viewer`, og bliver inviteret igen til samme tenant med role `editor` —
   upgrade eller error?
7. **Audit-log**: Skal alle invite-handlinger (sent/accepted/declined/revoked)
   logges i tenants `activity_log`?

## Motivation

F186 leverer Manage Tenants UI med Invitations-fane og row-action "Members".
Begge dele kræver et reelt invitation-flow før de kan blive funktionelle.
Designet (`docs/design/trail_app/src/manage-tenants.jsx::InvitationsList`)
viser exactly hvilken UX vi går efter — inviter, accept, decline, revoke.

Indtil F187 lander viser F186 "Coming Soon"-toast + tooltip på alle
invitation-handlinger.

## Scope (preliminary — skal låses efter spørgsmål 1-7 er besvaret)

### In scope (sandsynligvis)

- **`tenant_invitations`-tabel** (id, tenant_slug, invited_email, role,
  invited_by_user_id, invited_at, expires_at, status, accepted_user_id)
- **Server endpoints**: POST `/tenants/:slug/invitations`, GET
  `/tenants/:slug/invitations`, POST `/invitations/:id/accept`, POST
  `/invitations/:id/decline`, DELETE `/invitations/:id` (revoke)
- **Email transport** (afhænger af Q2)
- **Manage Tenants Invitations-fane** funktionel (accept/decline UI fra F186 design)
- **TopNav notifikation** når pending invitation lander (bell-ikon eller dot på TenantSwitcher)

### Non-goals (preliminary)

- Bulk-invite (CSV-upload)
- Self-serve "ask for invitation"-flow
- Cross-tenant role-transfer
- SAML/SCIM provisioning

## Architecture sketch

(Skitse — afventer Q1-Q7 før den størkner)

```
Inviter (Manage Tenants UI)
  → POST /tenants/sanne-andersen/invitations {email, role}
    → server creates tenant_invitations row
    → server sends email via Resend with magic-link
      "<base>/invitations/<token>?email=<email>"
Invited user clicks link
  → /invitations/:token route
    → if signed-in + email match: show Accept/Decline buttons
    → if not signed-in: redirect to /login, store invite-token in
      session, prompt user to sign in with matching email
    → POST /invitations/:id/accept
      → server adds user to tenant_users, sets status=accepted
      → redirect to /kb/... (Home for that tenant)
```

## Verification plan (preliminary)

- Send invite til ny email → modtag mail → klik link → accept → ny tenant
  synlig i TenantSwitcher
- Revoke pending invite → link returnerer 410 Gone
- Expire-window respekteres (hvis vi går med Q4=7 dage)

## Rollout

To faser når spec lockes:
- Phase 1 — backend (tabel + endpoints + Resend integration)
- Phase 2 — UI (port F186's Invitations-fane fra "Coming Soon" til funktionel)
