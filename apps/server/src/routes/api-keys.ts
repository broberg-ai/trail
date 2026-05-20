import { Hono } from 'hono';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { apiKeys } from '@trail/db';
import { requireAuth, getUser, getTenant, getTrail } from '../middleware/auth.js';
import { addBearer, revokeBearer } from '../lib/key-index.js';
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
  let body: { name?: string } = {};
  try { body = await c.req.json(); } catch { /* ignore */ }
  const name = body?.name?.trim();
  if (!name) {
    return c.json({ error: 'name is required' }, 400);
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
  });
  // F40.2a-B — dual-write: keep the global /data/key-index.db in sync
  // so the auth-middleware can resolve this bearer → tenant without
  // opening every tenant DB. No-op when the index file doesn't exist
  // (e.g. local dev).
  addBearer({ keyHash, tenantSlug: tenant.slug, userId: user.id, createdAt });
  return c.json({ id, name, key: raw }, 201);
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
