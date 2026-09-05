/**
 * F247.3 — web-push-ruter. Alt pr. tenant + bruger via requireAuth.
 *
 * Gem-felt-reglen (F057-hardregel): subscribe/prefs LÆSER rækken tilbage fra
 * databasen efter skrivningen og svarer med DET — aldrig med input-ekkoet.
 */
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { pushSubscriptions, pushPrefs } from '@trail/db';
import { requireAuth, getTenant, getTrail, getUser } from '../middleware/auth.js';
import type { AppBindings } from '../app.js';
import {
  getPushSender,
  readPrefs,
  parsePrefs,
  notifyPush,
  DEFAULT_PUSH_PREFS,
  type PushPrefsShape,
} from '../services/push.js';

export const pushRoutes = new Hono<AppBindings>();

pushRoutes.use('*', requireAuth);

/** Klientens startpakke: den offentlige nøgle (null = push slukket) + brugerens prefs. */
pushRoutes.get('/push/config', async (c) => {
  const trail = getTrail(c);
  const user = getUser(c);
  const sender = getPushSender();
  const prefs = await readPrefs(trail, user.id);
  const subs = await trail.db
    .select({ endpoint: pushSubscriptions.endpoint })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.tenantId, getTenant(c).id), eq(pushSubscriptions.userId, user.id)))
    .all();
  return c.json({
    publicKey: sender?.publicKey ?? null,
    prefs,
    endpoints: subs.map((s) => s.endpoint),
  });
});

pushRoutes.post('/push/subscribe', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const user = getUser(c);
  const body = (await c.req.json().catch(() => null)) as {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  } | null;
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return c.json({ error: 'subscription med endpoint + keys.p256dh + keys.auth er påkrævet' }, 400);
  }
  await trail.db
    .insert(pushSubscriptions)
    .values({
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      tenantId: tenant.id,
      userId: user.id,
      userAgent: c.req.header('user-agent') ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, tenantId: tenant.id, userId: user.id },
    })
    .run();
  // Læs TILBAGE — svaret er hvad databasen holder, ikke hvad klienten sendte.
  const stored = await trail.db
    .select({ endpoint: pushSubscriptions.endpoint, createdAt: pushSubscriptions.createdAt })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, sub.endpoint))
    .get();
  if (!stored) return c.json({ error: 'abonnementet blev ikke gemt' }, 500);
  return c.json({ ok: true, endpoint: stored.endpoint, createdAt: stored.createdAt });
});

pushRoutes.post('/push/unsubscribe', async (c) => {
  const trail = getTrail(c);
  const user = getUser(c);
  const body = (await c.req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) return c.json({ error: 'endpoint er påkrævet' }, 400);
  await trail.db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, body.endpoint), eq(pushSubscriptions.userId, user.id)))
    .run();
  const still = await trail.db
    .select({ endpoint: pushSubscriptions.endpoint })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, body.endpoint))
    .get();
  return c.json({ ok: !still, removed: !still });
});

pushRoutes.put('/push/prefs', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const user = getUser(c);
  const body = (await c.req.json().catch(() => null)) as Partial<PushPrefsShape> | null;
  if (!body || typeof body !== 'object') return c.json({ error: 'prefs-objekt er påkrævet' }, 400);
  const current = await readPrefs(trail, user.id);
  const next: PushPrefsShape = {
    queue: typeof body.queue === 'boolean' ? body.queue : current.queue,
    ingest: typeof body.ingest === 'boolean' ? body.ingest : current.ingest,
    lint: typeof body.lint === 'boolean' ? body.lint : current.lint,
    system: typeof body.system === 'boolean' ? body.system : current.system,
  };
  await trail.db
    .insert(pushPrefs)
    .values({ userId: user.id, tenantId: tenant.id, prefs: JSON.stringify(next) })
    .onConflictDoUpdate({
      target: pushPrefs.userId,
      set: { prefs: JSON.stringify(next), updatedAt: new Date().toISOString() },
    })
    .run();
  // Læs TILBAGE fra databasen — det er DEN række svaret bygger på.
  const stored = await trail.db
    .select({ prefs: pushPrefs.prefs })
    .from(pushPrefs)
    .where(eq(pushPrefs.userId, user.id))
    .get();
  if (!stored) return c.json({ error: 'prefs blev ikke gemt' }, 500);
  return c.json({ ok: true, prefs: parsePrefs(stored.prefs) });
});

/**
 * Test-push til MINE egne enheder (AC-beviset: «en test-push lander på
 * ejerens telefon»). Sender uanset type-prefs — man har lige bedt om den.
 */
pushRoutes.post('/push/test', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const user = getUser(c);
  const sender = getPushSender();
  if (!sender) return c.json({ error: 'web-push er ikke konfigureret på motoren' }, 503);
  const subs = await trail.db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.tenantId, tenant.id), eq(pushSubscriptions.userId, user.id)))
    .all();
  if (subs.length === 0) return c.json({ error: 'ingen abonnerede enheder for din bruger' }, 404);
  const result = await sender.send(
    subs.map((s) => ({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })),
    {
      title: 'Trail',
      body: 'Test-notifikation — push virker på denne enhed ✅',
      navigate: '/settings',
      icon: '/icon-192.png',
      tag: 'trail-test',
    },
  );
  return c.json({ sent: result.sent, dead: result.dead.length, failed: result.failed });
});

// Bruges af hændelses-stederne — re-eksport så kaldesteder kun importerer ét sted.
export { notifyPush, DEFAULT_PUSH_PREFS };
