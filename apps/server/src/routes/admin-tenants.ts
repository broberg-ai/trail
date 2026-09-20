/**
 * F210.2 — POST /api/admin/tenants, the route the control plane calls to make
 * a brand-new tenant live WITHOUT restarting the engine.
 *
 * WHY THIS IS A MODULE AND NOT INLINE IN index.ts. The handler lived in the
 * entrypoint, which meant no probe could drive it without booting the whole
 * engine — and so AC4, "an unauthenticated call is refused and creates no
 * directory", had no coverage at all. The one assertion that says a stranger
 * who can reach this port cannot create directories on a production volume
 * was the one nothing checked. Factored out so it can be mounted on a bare
 * Hono app and driven for real.
 *
 * The dependencies are injected rather than imported: `index.ts` passes the
 * live pool and its real boot/seed sequence, a probe passes a throwaway pool
 * and its own. Nothing about the auth, the validation or the status codes
 * differs between the two, which is the point.
 */
import { Hono } from 'hono';
import type { TrailDatabase } from '@trail/db';
import { provisionTenant, type TenantPool } from '../lib/tenant-pool.js';

export interface AdminTenantDeps {
  pool: TenantPool;
  /** Migrations + FTS + the one-shots a tenant DB gets at boot. */
  boot: (db: TrailDatabase) => Promise<void>;
  /** F210.5 — makes the tenant REACHABLE (tenants row + api_keys row). */
  seed: (db: TrailDatabase, args: { slug: string; name: string; ownerEmail: string; keyHash: string }) => Promise<void>;
}

export function adminTenantRoutes(deps: AdminTenantDeps): Hono {
  const routes = new Hono();

  routes.post('/admin/tenants', async (c) => {
    // Ships dark: with TRAIL_PROVISION_SECRET unset the route refuses
    // everything, so an engine that has not been given the secret cannot have
    // directories created on its volume by anyone who can reach it.
    const secret = process.env.TRAIL_PROVISION_SECRET;
    if (!secret) {
      return c.json({ error: 'provisioning not configured' }, 503);
    }
    const auth = c.req.header('authorization') ?? '';
    const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    // Length-independent compare would be better; Bun has no timingSafeEqual
    // on strings, and this secret is machine-to-machine over the private
    // network.
    if (presented !== secret) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    let body: { slug?: string; name?: string; ownerEmail?: string; keyHash?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      /* validated below */
    }
    const slug = body.slug?.trim();
    if (!slug) return c.json({ error: 'slug required' }, 400);
    const name = body.name?.trim() || slug;
    const ownerEmail = body.ownerEmail?.trim().toLowerCase();
    const keyHash = body.keyHash?.trim();

    /**
     * F210.5 — a provisioned tenant must be REACHABLE.
     *
     * `keyHash` is the sha256 of the bearer the control plane minted and will
     * forward on this tenant's behalf. The raw key never crosses this wire —
     * the engine only ever stores hashes.
     *
     * Refused when absent rather than provisioning a tenant that cannot be
     * reached: the failure this replaces was a database that existed,
     * migrated cleanly, reported 201, and answered every subsequent request
     * with "Invalid or revoked API key".
     */
    if (!keyHash || !ownerEmail) {
      return c.json(
        { error: 'keyHash and ownerEmail are required to provision a reachable tenant' },
        400,
      );
    }

    try {
      const result = await provisionTenant({
        pool: deps.pool,
        slug,
        boot: deps.boot,
        seed: (db) => deps.seed(db, { slug, name, ownerEmail, keyHash }),
      });
      return c.json({ ok: true, slug: result.slug, live: deps.pool.has(result.slug) }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "already exists" is a conflict, not a server fault — the caller can
      // tell a name clash from a broken engine.
      const conflict = /already (exists|live)/.test(msg);
      console.error(`[provision] ${slug}: ${msg}`);
      return c.json({ error: msg }, conflict ? 409 : 400);
    }
  });

  return routes;
}
