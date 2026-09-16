/**
 * F263.17.2 — AFGRÆNSNINGEN SKAL OGSÅ GÆLDE NÅR TRAILEN STÅR I KROPPEN.
 *
 * `kbGrantRefusal` i requireAuth læser Trailen ud af STIEN. `/queue/candidates`
 * har ingen kb i stien — den bærer den i KROPPEN. Så en nøgle afgrænset til én
 * Brain kunne skrive i en HVILKEN SOM HELST Brain i kontoen, og det så
 * fuldstændig lovligt ud: 201, ingen fejl, ingen log.
 *
 * MÅLT PÅ PRODUKTIONEN 16/9 med en nøgle bundet til «HelpDesk-Dev»:
 *   søg i broberg.ai        403   ← stien bar kb'en, grænsen holdt
 *   KANDIDAT i broberg.ai   201   ← kroppen bar den, grænsen fandtes ikke
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys } from '@trail/db';
import { createApp } from '../app.js';

// `resolveKbId` slår et ikke-UUID op på SLUG, ikke på id — samme fælde som i
// compile-lease-prøven. Derfor er slug == id her, så kaldet og databasen taler
// om det samme uden at prøven skal oversætte.
const T = 't-kg', U = 'u-kg', MIN = 'kb-min', DIN = 'kb-din';
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;
const NØGLE = 'trail_' + 'k'.repeat(64);

const kandidat = (kbId: string, key = NØGLE) =>
  app.request('http://engine.local/api/v1/queue/candidates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ knowledgeBaseId: kbId, kind: 'external-feed', title: 'p', content: 'p' }),
  });

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `kg-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'kg', name: 'KG', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'k@g.dk', displayName: 'K', role: 'owner', onboarded: true }).run();
  for (const [id, slug] of [[MIN, MIN], [DIN, DIN]] as const)
    await trail.db.insert(knowledgeBases).values({ id, tenantId: T, createdBy: U, name: id, slug, language: 'da' }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'afgrænset',
    keyHash: createHash('sha256').update(NØGLE).digest('hex'),
    scope: 'ambient', scopeKbIds: JSON.stringify([MIN]),
  }).run();
  app = createApp(trail, new Map([['kg', trail]]));
});

test('DEN BÆRENDE: en afgrænset nøgle kan IKKE skrive i en anden Brain', async () => {
  const res = await kandidat(DIN);
  expect(res.status).toBe(403);
  expect((await res.json() as { error: string }).error).toBe('kb-not-granted');
});

test('NEGATIV KONTROL: den BEVILGEDE Brain virker stadig', async () => {
  // Uden den ville «afvis alt» bestå lige så grønt som en port der virker —
  // og HelpDesks prøve-nøgle ville være ubrugelig.
  const res = await kandidat(MIN);
  expect([200, 201]).toContain(res.status);
});

test('en UAFGRÆNSET nøgle er urørt — den gamle vej brydes ikke', async () => {
  // scopeKbIds = NULL betyder «ingen begrænsning optaget» (nøgler mintet før
  // F263.8). De skal opføre sig præcis som før, ellers brækker hver eksisterende
  // integration i det sekund denne spærre ruller ud.
  const fri = 'trail_' + 'f'.repeat(64);
  await trail.db.insert(apiKeys).values({
    id: 'k2', tenantId: T, userId: U, name: 'fri',
    keyHash: createHash('sha256').update(fri).digest('hex'),
    scope: 'ambient', scopeKbIds: null,
  }).run();
  expect([200, 201]).toContain((await kandidat(DIN, fri)).status);
});
