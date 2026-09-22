/**
 * F191.9 — `?kb=` på /documents?awaitingLocalCompile=true er en ALLOWLIST.
 *
 * Testet i BEGGE retninger, fordi buddy målte fælden 22/9: et filter der tavst
 * ignoreres giver det forventede tal når man filtrerer på den Brain der
 * tilfældigvis rummer alt (23 = 23). Først når en Brain UDEN ventende kilder
 * giver 0, er det bevist at filteret virker.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys, documents } from '@trail/db';
import { createApp } from './../app.js';

const T = 't-kbf', U = 'u-kbf';
const MUSIC = '11111111-1111-4111-8111-111111111111';
const TRAIL = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'trail_kbfilter_' + 'k'.repeat(40);
let app: ReturnType<typeof createApp>;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function awaiting(query = '') {
  const res = await app.request(`http://engine.local/api/v1/documents?awaitingLocalCompile=true${query}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return { status: res.status, body: (await res.json()) as { documents?: { id: string }[]; ids?: string[]; unknown?: string[] } };
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `kbf-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  const trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'kbf', name: 'KBF', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'k@b.dk', displayName: 'K', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values([
    { id: MUSIC, tenantId: T, createdBy: U, name: 'Music', slug: 'music', language: 'en' },
    { id: TRAIL, tenantId: T, createdBy: U, name: 'Scout', slug: 'scout', language: 'da' },
  ]).run();
  await trail.db.insert(documents).values([
    { id: 'm1', tenantId: T, knowledgeBaseId: MUSIC, userId: U, kind: 'source', filename: 'a.md', fileType: 'md', awaitingLocalCompile: true },
    { id: 'm2', tenantId: T, knowledgeBaseId: MUSIC, userId: U, kind: 'source', filename: 'b.md', fileType: 'md', awaitingLocalCompile: true },
  ]).run();
  await trail.db.insert(apiKeys).values({ id: 'k', tenantId: T, userId: U, name: 'probe', keyHash: sha(TOKEN) }).run();
  app = createApp(trail, new Map([['kbf', trail]]));
});

test('uden ?kb= er svaret uændret: alle ventende kilder i tenanten', async () => {
  const r = await awaiting();
  expect(r.status).toBe(200);
  expect(r.body.ids!.sort()).toEqual(['m1', 'm2']);
});

test('DEN BÆRENDE: en Brain uden ventende kilder giver 0 — filteret er ikke tavst ignoreret', async () => {
  const r = await awaiting(`&kb=${TRAIL}`);
  expect(r.status).toBe(200);
  expect(r.body.ids).toEqual([]);
  expect(r.body.documents).toEqual([]);
});

test('Brainen der rummer kilderne giver dem — også via slug', async () => {
  expect((await awaiting(`&kb=${MUSIC}`)).body.ids!.sort()).toEqual(['m1', 'm2']);
  expect((await awaiting('&kb=music')).body.ids!.sort()).toEqual(['m1', 'm2']);
  expect((await awaiting('&kb=scout,music')).body.ids!.sort()).toEqual(['m1', 'm2']);
});

test('en ukendt Brain giver 400 med navnet — aldrig en tom liste proben ville læse som drænet', async () => {
  const r = await awaiting('&kb=scout,musik');
  expect(r.status).toBe(400);
  expect(r.body.unknown).toEqual(['musik']);
  expect((await awaiting('&kb=')).status).toBe(400);
});
