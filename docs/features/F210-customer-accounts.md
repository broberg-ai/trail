# F210 — Customer accounts: create a tenant, and manage who is in it

**Status:** Planned · **Owner decision:** Christian, 2026-08-27 ·
**Driver:** FDAA (fd-sundhed) needs their own Trail, with Christian as an
admin inside it, and will run **at least 3 knowledge bases** shortly.

## Why now

Christian asked whether he could build fd-sundhed's Trail under his own
login and hand FDAA access later. Measured answer: **no, and not
recoverably.** The three facts that decide it:

| | Measured |
|---|---|
| Invite a person to a *chosen* tenant | No — `invite.ts:64` picks `findFirst(organizationId = inviter.organizationId)`. The invitation always lands in the inviter's own organisation. |
| Move a KB to another account later | No such route, in any of the three apps. |
| One email in two organisations | Explicitly refused — `invite.ts:96` returns `this email is already a member of another organization`. |

So building it under broberg-ai would give FDAA sight of everything in
broberg-ai when they were finally invited, and there would be no way back
out. For health data on ~18,000 municipal employees that is not a
trade-off, it is a non-starter.

### What already exists (and was nearly rebuilt by mistake)

An earlier pass at this question searched only `apps/server/` and
`apps/admin/` and concluded that invitations were a dead UI stub with no
route and no table. **That was wrong** — this repo has a *third* app,
`apps/admin-server/`, which is the whole control plane, and it is not in
the `## Project layout` table in CLAUDE.md. Everything below already
ships there:

- `POST /api/control/invite` — creates the user + sends a magic link
  (through `@broberg/mail`, not a raw Resend call).
- `GET /api/control/invitations` · `DELETE /api/control/invitations/:id`.
- Tables `invitations` and — importantly — **`control_memberships(user_id,
  tenant_id, role)`**, which is already per-TENANT, not per-org.
- A working HTML invite form served at `/invite`.

The per-tenant membership primitive we need therefore exists. What is
missing is a way to *create* a tenant, and a way to point an invitation at
one. The "Coming soon — F186 follow-up" tooltips Christian hit are the
Admin SPA never having been wired to the control plane behind it.

## Reuse

Checked on Discovery before writing this (F217):

| Capability | Verdict |
|---|---|
| `F009 User management + invitation` | **backlog, `package: null`** — an idea on cms's board, nothing installable. |
| `F029 Multi-tenant management` | **backlog, `package: null`** — same. |
| `@broberg/auth 0.2.0` | Better Auth wrapper: login methods (password, magic-link, social). Does **not** cover memberships or invitations. Trail already has its own Google login; adopting it here would be a rewrite, not a reuse. |
| `@broberg/mail 0.1.0` | **Already adopted** — `admin-server/src/email.ts` uses `createMailer()`. The invitation mail must keep going through it. |
| `@broberg/apikey 0.1.0` | Already adopted for key minting; the new tenant's first key uses it. |

**Decision: build.** Nothing shipped covers tenant provisioning. If this
turns out to generalise, it is a candidate to hand to `components` as the
first real implementation behind their F029 — worth telling them once it
works, not before.

## Scope

### In

1. **Create a tenant** from the Admin SPA — the button Christian found
   disabled. Creates the control-plane row, makes the creator `owner` in
   `control_memberships`, and provisions the engine side.
2. **Provision the engine** — a new tenant is useless until
   `/data/<slug>/trail.db` exists, is migrated, and is in the pool.
   `tenant-pool.ts` says in its own header: *"Hot-add (a new tenant
   directory appearing at runtime) is OUT OF SCOPE for F40.2a … the pool
   is frozen at boot."* So a created tenant would silently 401 until
   someone restarted the engine. That is the trap this story exists to
   close.
3. **Members of a chosen tenant** — invite into a named tenant rather
   than "the inviter's first tenant", list who is in it with their role,
   and change or remove a member.

### Out (explicitly)

- **Enforcing roles.** `control_memberships.role` is still display + data,
  as F187.4 left it. Making `member` actually unable to do what `owner`
  can is real RBAC and belongs in its own epic — pretending otherwise
  would ship a permission model that looks enforced and is not.
- **Cross-organisation membership.** One email still belongs to one
  organisation. FDAA's people get accounts in broberg-ai's org, in their
  OWN tenant. Splitting orgs is a bigger change and nothing here needs it.
- **Billing, plan limits, seat counts** — F121/F122 own that.
- **Self-serve signup.** A customer still cannot create their own tenant;
  Christian creates it for them. That is the right shape while the fleet
  has a handful of customers.
- **Deleting a tenant.** Destructive, and needs a snapshot policy first.

## Architecture

```
Admin SPA  ──POST /api/control/tenants──▶  admin-server (control.db)
                                              │  1. INSERT control_tenants
                                              │  2. INSERT control_memberships(creator, owner)
                                              │
                                              └──POST /api/admin/tenants──▶ engine
                                                     3. mkdir /data/<slug>
                                                     4. createLibsqlDatabase + migrate + initFTS
                                                     5. pool.set(slug, db)   ← the hot-add
```

The engine call is the half that must not be skipped, and the half that
cannot be proved by a 200 from the control plane. Step 5 is what
`tenant-pool.ts` currently refuses to do.

**Ordering matters:** the control row is written first and the engine
provisioned second, because a tenant that exists in control.db but not on
disk gives a clean "provisioning" state to retry, whereas a database on
disk with no control row is an orphan nobody can see or clean up.

## Dependencies

- `F40.2a` multi-tenant routing (shipped — this builds on the pool it made).
- `F187` invitations (shipped; this widens `POST /invite` to take a tenant).
- `F187.4` `control_memberships` (shipped — the table we write into).
- `F186` Admin SPA design port — the disabled buttons live in its surfaces.

## Rollout

1. Behind no flag: creating a tenant is an owner-only action, and until
   someone calls it nothing changes for existing tenants.
2. **Snapshot the trail-admin volume before the migration runs** — the
   same rule the repo's own hard-rule section demands before touching a
   prod volume.
3. First real use is FDAA. Sanne and broberg-ai must be untouched, and the
   verify script asserts exactly that.

## Non-negotiable — owner access is absolute (F210.4)

Christian, 2026-08-27, verbatim and not open to discussion:

> **"JEG KAN og SKAL og MÅ være admin i ALLE tenants uanset hvilken mail jeg
> anvender."**

All three identities — `cb@webhouse.dk`, `christian@broberg.dk`,
`christian@broberg.ai` — are `owner` on **every** tenant that exists,
customers' included.

Today's enforcement does not deliver that, on three counts, all measured in
`migrations.ts:172-189`:

| Hole | The code |
|---|---|
| **One address only** | `WHERE email = 'cb@webhouse.dk'` — a literal in raw SQL. The other two identities get nothing. |
| **Boot only** | The promotion runs inside `migrations`. A tenant created at runtime does not reach him until someone restarts the control plane. |
| **Org-bounded** | `JOIN control_tenants t ON t.organization_id = u.organization_id` — a tenant in a different organisation never reaches him at all. |

So the fix has three parts, and skipping any one of them leaves a state where
he is locked out of something he owns:

1. **One source of truth, in git** — `packages/shared/src/owner-identities.ts`,
   not an env var. An env var that fails to load would silently strip his
   access from his own system; a constant in the repo cannot go missing between
   deploys. After F210.4, no route, migration, script or test may name an owner
   address as a literal — the three sites that do today (`migrations.ts`,
   `verify-f187-4.ts`, `verify-f198-lens-mint.ts`) are migrated with it.
2. **Enforced at all three moments**, not just boot: on **login** (an owner
   identity signing in for the first time gets a user plus `owner` on every
   existing tenant), on **tenant-creation** (F210.1 grants it in the same
   transaction), and at **boot** (self-heal, as today).
3. **Exempt from the org boundary.** Owner identities get membership on every
   tenant regardless of `organization_id`. This is the deliberate exception to
   the one-user-one-org model — everyone else still belongs to exactly one
   organisation, which is what keeps FDAA's people out of broberg-ai.

Enforcement is **additive only**: it raises to `owner`, never demotes and never
deletes. And every removal/demotion route must refuse an owner identity, with
the row read back afterwards to prove it — a 4xx that did not actually protect
the row is the failure mode this exists to prevent.

**The lens principal is not an owner.** `lens-session.ts` mints a deliberately
read-only `lens@trailmem` principal. Introducing the identity list must not
elevate it, and F210.4 asserts that directly.
