# F193 — Membership-gated tenant access (browser auth)

**Status:** shipping
**Date:** 2026-06-07
**Area:** admin-server (auth, proxy, keys)
**Depends on:** F186 (tenant switcher), F187.4 (`control_memberships`), F191.6 (scope=all key already membership-gated)

## Motivation

Onboarding Sanne Andersen (`mail@sanneandersen.dk`) surfaced a tenant-isolation
gap. The intended model (Christian's words) is **tenant = organisation**: each
tenant is its own org; Sanne owns only `sanne-andersen`; Christian
(`cb@webhouse.dk`) is **co-owner of every tenant** as the developer/operator.

The live `control.db` did not match that model, and — more importantly — the
**browser auth layer scoped tenant access by `organizationId`, not by the
`control_memberships` table** (F187.4 built the table but left it "display +
data only, not enforced"). Two consequences:

1. `org-sanne-andersen` actually held **both** tenants (`sanne-andersen` +
   `broberg-ai`). Any user in that org — including Sanne — could
   `switch-tenant` into `broberg-ai` and the proxy would forward her requests
   to the broberg-ai engine. **Tenant isolation was not enforced for browser
   login.**
2. Because a `control_users` row carries a single `organizationId`, "cb in his
   own broberg-ai org **and** co-owner of Sanne's org" was impossible while
   access keyed off org. There is no user↔multi-org primitive.

## Scope

**In:**
- Switch the three browser-auth access decisions from **org-scoped** to
  **membership-scoped** (the `control_memberships` rows are now authoritative
  for *which tenants a user can reach*, not just a cosmetic role):
  - `proxy.ts::resolveSession` — the `/api/v1/*` data path to the engine
    (security-critical). A user resolves only to a tenant they have a
    membership row for; a tampered `trail-active-tenant` cookie can't escape
    the set; fallback is the user's first membership tenant.
  - `auth.ts GET /api/auth/me` — returns only the user's membership tenants
    (the SPA TenantSwitcher renders exactly this list).
  - `auth.ts POST /api/auth/switch-tenant` — may switch only to a membership
    tenant.
  - `keys.ts::resolveContext` — a minted personal API key targets only a
    membership tenant.
- A one-off data restructure so the stored topology matches "tenant = org":
  `broberg-ai` becomes its own organisation; `cb`'s user moves there; cb keeps
  an `owner` membership on **both** tenants; Sanne's `broberg-ai` membership is
  removed.

**Non-goals:**
- No full RBAC enforcement of the `owner`/`admin`/`member` *role* (still
  display + data; gating is binary "member-of-tenant or not"). Role-based
  permission checks remain Phase 2+.
- No change to the `scope=all` personal-key path — it was already
  membership-gated in F191.6 (so this session's ingest key is unaffected).
- No user↔multi-org primitive. Cross-org co-ownership is expressed purely as a
  cross-org `control_memberships` row, which the F187.4 boot migration keeps
  forced to `owner` for `cb@webhouse.dk`.

## Architecture

`control_memberships(user_id, tenant_id, role)` is now the single source of
truth for browser tenant-access. Org membership (`control_users.organizationId`)
still defines a user's *home* org (used by the invite flow, which is
intentionally org-scoped), but no longer grants data access to sibling tenants.

The F187.4 boot migration is the safety net for the UFRAVIGELIG rule
(`cb@webhouse.dk` always owner): on every boot it (1) seeds a `member` row for
each user × same-org tenant pair and (2) force-promotes every cb membership row
to `owner`. cb's cross-org membership on `sanne-andersen` is created manually by
the restructure and is never deleted by the migration — only ever raised to
`owner` — so cb can never lose co-ownership.

### Data restructure (one-off, on prod control.db; snapshot first)

```sql
INSERT OR IGNORE INTO organizations (id, slug, name)
  VALUES ('org-broberg-ai', 'broberg-ai', 'Broberg.ai');
UPDATE control_tenants SET organization_id='org-broberg-ai' WHERE id='t-broberg-ai';
UPDATE control_users   SET organization_id='org-broberg-ai' WHERE email='cb@webhouse.dk';
-- cb owner on BOTH tenants (cross-org co-owner of SA); rows already exist, belt-and-suspenders:
INSERT OR IGNORE INTO control_memberships (user_id, tenant_id, role)
  VALUES ('u-cb-webhouse','t-broberg-ai','owner'), ('u-cb-webhouse','t-sanne-andersen','owner');
UPDATE control_memberships SET role='owner'
  WHERE user_id='u-cb-webhouse' AND tenant_id IN ('t-broberg-ai','t-sanne-andersen');
-- isolate Sanne: remove her broberg-ai access (NEVER touches cb):
DELETE FROM control_memberships WHERE user_id='u-sanne' AND tenant_id='t-broberg-ai';
```

End state:

| User | Reaches (browser) |
|---|---|
| `cb@webhouse.dk` (home org broberg-ai) | broberg-ai **+** sanne-andersen (owner of both) |
| `mail@sanneandersen.dk` (home org sanne-andersen) | **only** sanne-andersen |

## Rollout

1. Code (this commit) + `tsc` green.
2. Manual snapshot of trail-admin's control.db volume.
3. Run the restructure SQL on prod control.db (read-back verify).
4. `pnpm ship` deploy of trail-admin.
5. Verify topology + that `/api/auth/me` and the proxy honour memberships.
6. Send Sanne her magic-link.

## Verification

- Re-run the read-only introspection: cb → [broberg-ai, sanne-andersen];
  Sanne → [sanne-andersen]; cb owner on both.
- Boot the migration once more (deploy) and confirm cb is still owner on both
  (self-heal) and Sanne has no broberg-ai row.
