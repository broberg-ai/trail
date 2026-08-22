import { Hono } from 'hono';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { apiKeys, knowledgeBases } from '@trail/db';
import { requireAuth, getUser, getTenant, getTrail } from '../middleware/auth.js';
import { addBearer, revokeBearer } from '../lib/key-index.js';
import { PARTNER_SCOPE } from '../middleware/partner-scope.js';
import type { AppBindings } from '../app.js';

export const apiKeyRoutes = new Hono<AppBindings>();

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Format: `trail_<64 lowercase hex chars>` (32 random bytes). */
function generateKey(): string {
  return `trail_${randomBytes(32).toString('hex')}`;
}

// List all non-revoked keys for the current user (no raw key in response)
apiKeyRoutes.get('/api-keys', requireAuth, async (c) => {
  const trail = getTrail(c);
  const user = getUser(c);
  const rows = await trail.db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))
    .all();
  return c.json(rows);
});

// Create a new API key — raw key returned ONCE, store it now
apiKeyRoutes.post('/api-keys', requireAuth, async (c) => {
  const trail = getTrail(c);
  const user = getUser(c);
  const tenant = getTenant(c);
  let body: { name?: string; scope?: string; kbId?: string } = {};
  try { body = await c.req.json(); } catch { /* ignore */ }
  const name = body?.name?.trim();
  if (!name) {
    return c.json({ error: 'name is required' }, 400);
  }

  // F205.1 — the scope is now EXPLICIT. It used to be omitted entirely, which
  // silently produced a 'full' key (unrestricted, acts as the user across the
  // whole tenant) every single time. Omitting it still means 'full' so nothing
  // that exists today changes — but a partner key can now be asked for.
  const scope = body?.scope?.trim() || 'full';
  if (scope !== 'full' && scope !== PARTNER_SCOPE) {
    return c.json({ error: `Unknown scope "${scope}" — expected "full" or "${PARTNER_SCOPE}"` }, 400);
  }

  // A partner key is meaningless without the one KB it is confined to, and a
  // partner key that fell back to tenant-wide access would be the exact bug
  // this feature exists to remove. So: refuse, never default.
  let kbId: string | null = null;
  if (scope === PARTNER_SCOPE) {
    const requested = body?.kbId?.trim();
    if (!requested) {
      return c.json({ error: 'kbId is required for a partner key' }, 400);
    }
    // Confirm the KB is one of THIS tenant's — otherwise a member of tenant A
    // could bind a partner key to tenant B's knowledge base.
    const kb = await trail.db
      .select({ id: knowledgeBases.id })
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, requested))
      .get();
    if (!kb) {
      return c.json({ error: 'Knowledge base not found' }, 404);
    }
    kbId = kb.id;
  }

  const raw = generateKey();
  const id = crypto.randomUUID();
  const keyHash = hashKey(raw);
  const createdAt = new Date().toISOString();
  await trail.db.insert(apiKeys).values({
    id,
    tenantId: tenant.id,
    userId: user.id,
    name,
    keyHash,
    scope,
    kbId,
  });
  // F40.2a-B — dual-write: keep the global /data/key-index.db in sync
  // so the auth-middleware can resolve this bearer → tenant without
  // opening every tenant DB. No-op when the index file doesn't exist
  // (e.g. local dev).
  addBearer({ keyHash, tenantSlug: tenant.slug, userId: user.id, createdAt });
  return c.json({ id, name, scope, kbId, key: raw }, 201);
});

// Revoke a key (soft delete — sets revoked_at)
apiKeyRoutes.delete('/api-keys/:id', requireAuth, async (c) => {
  const trail = getTrail(c);
  const user = getUser(c);
  const id = c.req.param('id')!;
  // Read the hash before revoking so we can mirror the soft-delete into
  // the global key-index (which is keyed by hash, not id).
  const row = await trail.db
    .select({ keyHash: apiKeys.keyHash })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))
    .get();
  const result = await trail.db
    .update(apiKeys)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))
    .run();
  if (result.rowsAffected === 0) {
    return c.json({ error: 'Not found or already revoked' }, 404);
  }
  if (row?.keyHash) revokeBearer(row.keyHash);
  return c.json({ ok: true });
});
