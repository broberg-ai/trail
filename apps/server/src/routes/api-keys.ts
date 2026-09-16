import { Hono } from 'hono';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { apiKeys, knowledgeBases } from '@trail/db';
import { requireAuth, getUser, getTenant, getTrail } from '../middleware/auth.js';
import { addBearer, revokeBearer, lookupBearer } from '../lib/key-index.js';
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
  let body: { name?: string; scope?: string; kbId?: string; kbIds?: string[] } = {};
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
  if (scope !== 'full' && scope !== PARTNER_SCOPE && scope !== 'ambient') {
    return c.json({
      error: `Unknown scope "${scope}" — expected "full", "${PARTNER_SCOPE}" or "ambient"`,
    }, 400);
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

  // F263.17 — EN LÆSE-NØGLE TIL ÉN BRAIN, mintbar over API'et.
  //
  // `ambient`-scopet fandtes allerede og håndhæves i requireAuth (AMBIENT_ALLOWED:
  // søgning + chat + kandidat-skrivning, intet andet), og `scopeKbIds` afgrænser
  // hvilke Trails nøglen må røre. Det var bare ikke muligt at MINTE en over API'et
  // — kun enheds-godkendelsen kunne det. En ekstern kunde som HelpDesk ville
  // derfor have fået en `full`-nøgle, der handler SOM BRUGEREN på tværs af hele
  // kontoen; altså adgang til hver eneste Brain frem for den ene de skal bruge.
  //
  // KRÆVER SIN AFGRÆNSNING, aldrig en standard. En ambient-nøgle uden kbIds ville
  // være tenant-bred, og en tenant-bred nøgle udleveret som «den er begrænset» er
  // værre end en åben: modtageren bygger på en beskyttelse der ikke findes.
  let scopeKbIds: string | null = null;
  if (scope === 'ambient') {
    const bedt = Array.isArray(body?.kbIds) ? body.kbIds.map((x) => String(x).trim()).filter(Boolean) : [];
    if (bedt.length === 0) {
      return c.json({ error: 'kbIds is required for an ambient key — a key without it would span the whole tenant' }, 400);
    }
    const fundne = await trail.db
      .select({ id: knowledgeBases.id })
      .from(knowledgeBases)
      .where(inArray(knowledgeBases.id, bedt))
      .all();
    // Hver enkelt skal findes. Accepterede vi delmængden, ville en tastefejl i ét
    // id give en nøgle med færre Trails end bestilt — og det opdages først den dag
    // et opslag svarer tomt uden at fejle.
    if (fundne.length !== bedt.length) {
      const mangler = bedt.filter((b) => !fundne.some((f) => f.id === b));
      return c.json({ error: `Knowledge base(s) not found: ${mangler.join(', ')}` }, 404);
    }
    scopeKbIds = JSON.stringify(fundne.map((f) => f.id));
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
    scopeKbIds,
  });
  // F40.2a-B — dual-write: keep the global /data/key-index.db in sync
  // so the auth-middleware can resolve this bearer → tenant without
  // opening every tenant DB. No-op when the index file doesn't exist
  // (e.g. local dev).
  addBearer({ keyHash, tenantSlug: tenant.slug, userId: user.id, createdAt });

  // F263.17.1 — SKRIV, OG SPØRG DEREFTER.
  //
  // `addBearer` er et TAVST no-op når nøgle-indekset ikke findes på værten, og
  // indeks-rækken er det ENESTE der fortæller auth hvilken database den skal
  // åbne. Uden den svarer nøglen 401 på ALT — også det den er bevilget til.
  //
  // MÅLT 16/9: en nyminted ambient-nøgle gav 401 på hvert eneste kald, inklusive
  // den Brain den var bundet til. Ruten havde meldt 201 med nøglen i svaret. En
  // udleveret nøgle der ikke virker er værre end en fejl: modtageren bygger
  // videre på den og fejlsøger sin egen ende.
  //
  // Nabofunktionen `lookupBearer` blev skrevet til NETOP dette (F210.5, dens
  // egen kommentar: «provisioning-vejen skriver og spørger derefter, frem for
  // at stole på et kald der ikke kan fejle») — den blev bare aldrig kaldt her.
  //
  // TRE UDFALD, ikke to. `undefined` = intet indeks på værten (lovligt i lokal
  // enkelt-tenant-dev); `null` = indekset findes og rækken landede IKKE.
  // Blandes de to, ville lokal udvikling gå i stå eller produktion tie.
  const iIndeks = lookupBearer(keyHash);
  if (iIndeks === null) {
    await trail.db.delete(apiKeys).where(eq(apiKeys.id, id)).run();
    return c.json({
      error: 'key-index-write-failed',
      message: 'Nøglen blev oprettet i kontoen men kunne ikke skrives i '
        + 'nøgle-indekset, og ville derfor svare 401 på alt. Den er rullet '
        + 'tilbage frem for at blive udleveret som virkende.',
    }, 500);
  }

  return c.json({
    id, name, scope, kbId, scopeKbIds, key: raw,
    // Siger hvad vi FAKTISK ved, frem for at lade tavshed betyde ja.
    keyIndex: iIndeks === undefined ? 'absent-on-host' : 'verified',
  }, 201);
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
