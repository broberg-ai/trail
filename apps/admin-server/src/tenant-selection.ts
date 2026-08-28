/**
 * F215.3 — the ONE place that answers "which tenants may this caller select?"
 *
 * Two endpoints ask it, for two shipped clients:
 *
 *   GET /api/v1/me/tenants      → the Web Clipper's picker, and the Admin SPA
 *   GET /api/control/my-tenants → the Ingest Station's picker
 *
 * They used to run their own JOIN each, and had already drifted apart in four
 * ways by the time anyone compared them: different auth (one takes a cookie),
 * different response shape, different ordering, and — the one that reached a
 * screen — a single-tenant key got `role: 'member'` as a hardcoded LITERAL.
 * The Ingest Station renders that field, so it printed "member" beside a tenant
 * the caller may own. A constant sitting where a reading belongs cannot look
 * wrong, which is exactly how it survived.
 *
 * The response SHAPES stay different — two deployed clients parse them — but
 * they can no longer disagree about which tenants, because only this function
 * decides. Both routes project from what it returns.
 *
 * SELECTOR, NEVER GRANT: appearing in this list confers no access. Every
 * request still resolves its tenant against control_memberships (proxy.ts
 * resolveApiKey → selectTenant). Lose a membership and the same key narrows on
 * the next request, untouched.
 */

import { and, eq } from 'drizzle-orm';
import { db, schema } from './db.js';

export interface SelectableTenant {
  slug: string;
  name: string;
  /** The caller's role IN this tenant — owner | admin | member. */
  role: string;
  /** True for the tenant used when no X-Trail-Tenant header is sent. */
  home: boolean;
}

/**
 * The tenants `userId` may select: home first, then alphabetical, so a picker
 * has a stable order across reloads.
 *
 * `homeTenantId` is the tenant used when no header is sent. For an API key that
 * is the key's own tenant. For a browser session there is no such column —
 * control_users belongs to an ORGANISATION, not a tenant — so the caller passes
 * the tenant the proxy would fall back to, and null means "no home, just list
 * the memberships".
 */
export async function selectableTenants(
  userId: string,
  homeTenantId: string | null,
  spansAll: boolean,
): Promise<SelectableTenant[]> {
  // LEFT join, deliberately: a key whose user has no membership row for its own
  // home tenant must still get that tenant back. Making it an inner join would
  // lock a working Ingest Station out of a tenant as a side effect of a code
  // cleanup — and whether the caller may USE the tenant is the proxy's call,
  // not this listing's.
  const home = homeTenantId
    ? ((await db
        .select({
          slug: schema.controlTenants.slug,
          name: schema.controlTenants.name,
          role: schema.controlMemberships.role,
        })
        .from(schema.controlTenants)
        .leftJoin(
          schema.controlMemberships,
          and(
            eq(schema.controlMemberships.tenantId, schema.controlTenants.id),
            eq(schema.controlMemberships.userId, userId),
          ),
        )
        .where(eq(schema.controlTenants.id, homeTenantId))
        .get()) ?? null)
    : null;

  // A key that does not span tenants can only ever reach its home, so listing
  // the user's other memberships would offer choices the proxy refuses.
  if (!spansAll) {
    return home ? [{ slug: home.slug, name: home.name, role: home.role ?? 'member', home: true }] : [];
  }

  const rows = await db
    .select({
      slug: schema.controlTenants.slug,
      name: schema.controlTenants.name,
      role: schema.controlMemberships.role,
    })
    .from(schema.controlTenants)
    .innerJoin(
      schema.controlMemberships,
      eq(schema.controlMemberships.tenantId, schema.controlTenants.id),
    )
    .where(eq(schema.controlMemberships.userId, userId))
    .all();

  const others = rows
    .filter((r) => r.slug !== home?.slug)
    .sort((a, b) => a.name.localeCompare(b.name));

  return [
    ...(home ? [{ slug: home.slug, name: home.name, role: home.role ?? 'member', home: true }] : []),
    ...others.map((r) => ({ slug: r.slug, name: r.name, role: r.role, home: false })),
  ];
}
