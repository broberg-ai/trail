# F188 — User-level Personal API Keys

**Status:** Planned (interim plan-doc — open questions øverst) · **Phase:** 2
**Effort:** M (2d, estimat før spec-lock)
**Depends on:** F40.2a (multi-tenant routing, shipped)
**Spawned by:** F186 (Account Preferences → Developer-sektion landede som "Coming Soon")

## Open questions (skal afklares før spec lockes)

1. **Auth-model**: User-level key svarer til "all tenants user is member of"
   eller "explicit-scoped to N tenants"? Designet implicerer cross-tenant
   (kontrast til tenant-level keys vi har i dag).
2. **Tenant-scope**: Hvis cross-tenant, hvordan håndterer routing-laget i
   `key-index.db` flere mulige tenants pr. bearer-hash? Ny `user_id`-kolonne
   med tenant-resolution baseret på request-context, eller key gemmer eksplicit
   tenant-liste?
3. **Permission-model**: User-key arver brugerens role pr. tenant, eller får
   man lov til at scope keyen yderligere (fx "read-only på sanne-andersen,
   admin på broberg-ai")? Sandsynligvis det første for v1, men værd at fryse.
4. **Audit**: Skal alle key-genererede requests logges anderledes end
   session-cookie-requests (fx `user_action_log.via='api-key'`)?
5. **Rate-limiting**: Anden grænse end session-keys? Default delt budget,
   eller har user-keys lavere quota?
6. **Revoke-flow**: Hvad sker med pågående requests når user revoker en key
   mid-flight? Hard-fail eller graceful drain?
7. **CLI-tooling**: Skal vi shippe en `trail cli login --user-key` kommando
   sammen med dette, eller venter CLI på senere F-feature?

## Motivation

F186 leverer Account Preferences med Developer-sektion. Designet
(`docs/design/trail_app/src/user-settings.jsx::Section.developer`) viser en
tabel over personal API keys med navn, prefix, created, last-used, revoke,
plus "Generate new key" CTA.

Indtil F188 lander viser F186 "Coming Soon"-card i Developer-sektionen
med disabled "Generate"-knap.

## Scope (preliminary — skal låses efter Q1-Q7)

### In scope (sandsynligvis)

- **`user_api_keys`-tabel** i admin's `control.db` (id, user_id, name,
  key_hash, key_prefix, created_at, last_used_at, revoked_at)
- **Dual-write til `key-index.db`** så engine-auth-middleware kan O(1)-resolve
  user-keys på samme måde som F40.2a's tenant-keys
- **Server endpoints**: POST `/users/me/api-keys`, GET `/users/me/api-keys`,
  DELETE `/users/me/api-keys/:id`
- **One-time secret-reveal modal** ved generering (vis raw key én gang, gem
  prefix + hash i DB — kan ikke retrieves igen)
- **Account Preferences Developer-sektion** funktionel (port fra "Coming Soon"
  til real table + Generate-modal)

### Non-goals (preliminary)

- OAuth-tokens (separat feature hvis vi nogensinde vil have third-party-integration)
- Service-accounts (det er tenant-niveau, ikke user-niveau)
- Key-rotation-automation

## Architecture sketch

(Skitse — afventer Q1-Q7)

```
User clicks "Generate new key" in /settings → Developer
  → modal opens, prompts for key name
  → POST /users/me/api-keys {name}
    → server generates random 32-byte bearer
    → hash = sha256(bearer)
    → INSERT INTO user_api_keys (...)
    → INSERT INTO key-index.db (key_hash, kind='user-key', user_id, scope=?)
    → return {raw_key, prefix} ONCE
  → modal shows raw key with copy-button + "Save now, won't be shown again"
  → user copies key, uses via Authorization: Bearer <key>
Engine auth-middleware:
  → resolveBearer(hash) → returns {kind: 'user-key', user_id, ...}
  → for each tenant user is member of: load DB into c.set('trail', ...)
    → request body / URL param picks which tenant if ambiguous
```

## Verification plan (preliminary)

- Generate key → use via curl → request lander hos riktige tenant
- Revoke key → next request returnerer 401
- Last-used-at timestamp opdateres ved successful request
- Audit-log noterer `via='user-api-key'` hvis Q4=yes

## Rollout

To faser når spec lockes:
- Phase 1 — backend (tabel + endpoints + key-index integration)
- Phase 2 — UI (port F186's Developer-sektion fra "Coming Soon" til funktionel)
