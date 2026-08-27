/**
 * F210.5 — make a freshly provisioned tenant REACHABLE.
 *
 * F210.2 created and migrated `/data/<slug>/trail.db` and hot-added it to the
 * pool. What it never did was put anything IN it: `tenants` was empty, `users`
 * was empty, `api_keys` was empty, and the bearer the control plane had minted
 * existed only in control.db. So the tenant was live, the proxy forwarded a
 * real key, and the engine answered "Invalid or revoked API key" — which the
 * owner saw the first time he opened the customer he had just created.
 *
 * The three rows this writes are the minimum for a request to resolve:
 *
 *   tenants     — what the slug points at
 *   users       — api_keys.user_id is NOT NULL and references it
 *   api_keys    — the sha256 the auth middleware compares against
 *
 * plus one row in the cross-tenant key index at /data/key-index.db, which is
 * what auth reads FIRST to learn which tenant database to open. Miss that and
 * the key is valid but unfindable — the same 401 by a different route.
 *
 * Idempotent: re-provisioning an existing slug is refused upstream, but this
 * still uses insert-if-absent so a retry after a partial failure completes
 * rather than throwing on a row it already wrote.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { tenants, users, apiKeys, type TrailDatabase } from '@trail/db';
import { addBearer, lookupBearer } from '../lib/key-index.js';

export async function seedTenantIdentity(
  db: TrailDatabase,
  args: { slug: string; name: string; ownerEmail: string; keyHash: string },
): Promise<void> {
  const { slug, name, ownerEmail, keyHash } = args;

  let tenant = await db.db.select().from(tenants).where(eq(tenants.slug, slug)).get();
  if (!tenant) {
    const id = randomUUID();
    await db.db.insert(tenants).values({ id, slug, name });
    tenant = await db.db.select().from(tenants).where(eq(tenants.slug, slug)).get();
  }
  if (!tenant) throw new Error(`seed: tenant row for ${slug} did not persist`);

  let user = await db.db.select().from(users).where(eq(users.email, ownerEmail)).get();
  if (!user) {
    const id = randomUUID();
    await db.db.insert(users).values({
      id,
      tenantId: tenant.id,
      email: ownerEmail,
      displayName: ownerEmail.split('@')[0] ?? ownerEmail,
      // The engine's role enum is owner|curator|reader — the control plane's
      // owner/admin/member vocabulary does not exist here.
      role: 'owner',
      onboarded: true,
    });
    user = await db.db.select().from(users).where(eq(users.email, ownerEmail)).get();
  }
  if (!user) throw new Error(`seed: user row for ${ownerEmail} did not persist`);

  const existingKey = await db.db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .get();
  const createdAt = new Date().toISOString();
  if (!existingKey) {
    await db.db.insert(apiKeys).values({
      id: randomUUID(),
      tenantId: tenant.id,
      userId: user.id,
      name: 'control-plane proxy',
      keyHash,
      scope: 'full',
      createdAt,
    });
  }

  // The index auth consults BEFORE opening any tenant database. Without it the
  // key is present in the right database and still unreachable, because
  // nothing knows which database to look in.
  addBearer({ keyHash, tenantSlug: slug, userId: user.id, createdAt });

  /**
   * Read it back rather than trusting the write.
   *
   * `addBearer` cannot fail — when the index file is missing it returns
   * quietly, which is correct for single-tenant hosts and catastrophic here:
   * the tenant would go live with a key nothing can resolve, and the only
   * symptom would be "Invalid or revoked API key" on the customer's screen.
   * The index is also created by a one-off script rather than at boot, so
   * "the file is there" is not a safe assumption on a new machine.
   *
   * undefined = no index on this host (single-tenant; auth does not consult
   * it, so nothing is wrong). null or a wrong slug = the write did not land,
   * and provisioning must fail loudly instead of handing over a dead tenant.
   */
  const back = lookupBearer(keyHash);
  if (back === undefined) return; // no index on this host — single-tenant
  if (!back || back.tenantSlug !== slug) {
    throw new Error(
      `seed: key index did not accept the bearer for ${slug} ` +
        `(read back: ${back ? back.tenantSlug : 'no row'}) — the tenant would be unreachable`,
    );
  }
}
