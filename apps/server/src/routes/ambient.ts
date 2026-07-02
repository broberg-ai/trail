/**
 * F201.2 — Ambient device-auth (RFC 8628-lite).
 *
 * Flow: the Trail Ambient agent generates a random device code and opens
 * the browser at app.trailmem.com/ambient/connect?code=…&name=… — the
 * logged-in user approves on the admin page, which calls POST
 * /ambient/approve here (session auth). Approval mints an 'ambient'-scoped
 * trail_ API key (candidates-write + search/chat read only — see the
 * scope gate in middleware/auth.ts) and parks the RAW token in
 * ambient_device_codes until the agent claims it via POST /ambient/token
 * (UNAUTHENTICATED — the device has no credential yet; the code is the
 * bearer). The claim is single-use: token_once is NULLed on delivery.
 *
 * Ship-dark: both endpoints return 404 until TRAIL_AMBIENT_AUTH=1 is set
 * on the engine — no live surface until F201 is ready to onboard devices.
 */
import { Hono } from 'hono';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ambientDeviceCodes, apiKeys, knowledgeBases } from '@trail/db';
import { requireAuth, getUser, getTenant, getTrail } from '../middleware/auth.js';
import { addBearer } from '../lib/key-index.js';
import type { AppBindings } from '../app.js';

export const ambientRoutes = new Hono<AppBindings>();

/** 10 minutes — plenty for an approve-and-poll roundtrip, short enough
 * that a parked raw token is never long-lived. */
const CODE_TTL_MS = 10 * 60 * 1000;

const CODE_RE = /^[0-9a-f]{64}$/;

function enabled(): boolean {
  return process.env.TRAIL_AMBIENT_AUTH === '1';
}

function hashCode(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Approve a device — called by the admin /ambient/connect page (session
// cookie). Mints the scoped key and binds it to the device code.
ambientRoutes.post('/ambient/approve', requireAuth, async (c) => {
  if (!enabled()) return c.json({ error: 'Not found' }, 404);
  const trail = getTrail(c);
  const user = getUser(c);
  const tenant = getTenant(c);

  const body = (await c.req.json().catch(() => null)) as
    | { code?: string; deviceName?: string; kbIds?: string[] }
    | null;
  const code = body?.code?.trim().toLowerCase() ?? '';
  const deviceName = body?.deviceName?.trim() || 'Ukendt enhed';
  const kbIds = Array.isArray(body?.kbIds) ? body.kbIds.filter((k) => typeof k === 'string') : [];
  if (!CODE_RE.test(code)) return c.json({ error: 'Invalid device code format' }, 400);
  if (kbIds.length === 0) return c.json({ error: 'Select at least one knowledge base' }, 400);

  // Granted KBs must exist in THIS tenant — a foreign id is a 400, not a
  // silent drop, so the device never believes it was granted more than it was.
  const owned = await trail.db
    .select({ id: knowledgeBases.id })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.tenantId, tenant.id), inArray(knowledgeBases.id, kbIds)))
    .all();
  if (owned.length !== kbIds.length) {
    return c.json({ error: 'One or more knowledge bases not found in this tenant' }, 400);
  }

  const codeHash = hashCode(code);
  const existing = await trail.db
    .select({ id: ambientDeviceCodes.id })
    .from(ambientDeviceCodes)
    .where(eq(ambientDeviceCodes.codeHash, codeHash))
    .get();
  if (existing) return c.json({ error: 'Device code already approved' }, 409);

  const raw = `trail_${randomBytes(32).toString('hex')}`;
  const keyId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await trail.db.insert(apiKeys).values({
    id: keyId,
    tenantId: tenant.id,
    userId: user.id,
    // Suffix keeps idx_api_keys_user_name unique across re-connects of the
    // same Mac (each connect mints a fresh key; old ones are revocable in
    // Settings → API-nøgler like any other key).
    name: `ambient:${deviceName}:${keyId.slice(0, 8)}`,
    keyHash: createHash('sha256').update(raw).digest('hex'),
    scope: 'ambient',
  });
  addBearer({ keyHash: createHash('sha256').update(raw).digest('hex'), tenantSlug: tenant.slug, userId: user.id, createdAt });

  await trail.db.insert(ambientDeviceCodes).values({
    id: crypto.randomUUID(),
    tenantId: tenant.id,
    codeHash,
    deviceName,
    apiKeyId: keyId,
    tokenOnce: raw,
    kbIds: JSON.stringify(kbIds),
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });

  return c.json({ ok: true, deviceName, kbCount: kbIds.length }, 201);
});

// Claim the token — polled by the device. UNAUTHENTICATED by design (the
// device has nothing yet); the 64-hex code is the single-use bearer.
// Unknown → 404, expired/claimed → 410. Never a silent fallback.
ambientRoutes.post('/ambient/token', async (c) => {
  if (!enabled()) return c.json({ error: 'Not found' }, 404);
  const trail = getTrail(c);

  const body = (await c.req.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim().toLowerCase() ?? '';
  if (!CODE_RE.test(code)) return c.json({ error: 'Invalid device code format' }, 400);

  const row = await trail.db
    .select()
    .from(ambientDeviceCodes)
    .where(eq(ambientDeviceCodes.codeHash, hashCode(code)))
    .get();
  if (!row) return c.json({ error: 'Unknown or unapproved device code' }, 404);
  if (row.claimedAt || !row.tokenOnce) return c.json({ error: 'Device code already claimed' }, 410);
  if (row.expiresAt < new Date().toISOString()) {
    // Expired with the token unclaimed — scrub the parked raw token.
    await trail.db
      .update(ambientDeviceCodes)
      .set({ tokenOnce: null })
      .where(eq(ambientDeviceCodes.id, row.id));
    return c.json({ error: 'Device code expired' }, 410);
  }

  const token = row.tokenOnce;
  await trail.db
    .update(ambientDeviceCodes)
    .set({ tokenOnce: null, claimedAt: new Date().toISOString() })
    .where(and(eq(ambientDeviceCodes.id, row.id), isNull(ambientDeviceCodes.claimedAt)));

  return c.json({
    token,
    kbIds: JSON.parse(row.kbIds) as string[],
    deviceName: row.deviceName,
  });
});
