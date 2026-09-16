/**
 * F263.17.3 — upload til en PRØVE-Brain, og kun dertil.
 *
 * Christians ordre 17/9: «åbn upload for prøve-Brains». Den smalle udgave er
 * ikke en bredere nøgle — det er en egenskab ved MÅLET.
 *
 * `ambient` udelukker kilder med vilje (F201.2: «never keys, settings,
 * sources»). Havde vi bare sat upload på allowlisten, ville en Ambient
 * capture-enhed pludselig kunne lægge filer i den Brain den er parret med —
 * en anden beslutning end den der blev truffet, sket i forbifarten.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys } from '@trail/db';
import { createApp } from '../app.js';

const T = 't-sb', U = 'u-sb', SAND = 'kb-sand', RIGTIG = 'kb-rigtig';
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;
const AFGRÆNSET = 'trail_' + 'a'.repeat(64);
const FRI = 'trail_' + 'b'.repeat(64);

function upload(kb: string, key: string) {
  const fd = new FormData();
  fd.append('file', new Blob(['# prøve\n\nindhold'], { type: 'text/markdown' }), 'p.md');
  return app.request(`http://engine.local/api/v1/knowledge-bases/${kb}/documents/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd,
  });
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `sb-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'sb', name: 'SB', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 's@b.dk', displayName: 'S', role: 'owner', onboarded: true }).run();
  // slug == id: resolveKbId slår et ikke-UUID op på SLUG, ikke på id.
  await trail.db.insert(knowledgeBases).values({ id: SAND, tenantId: T, createdBy: U, name: 'Sandkasse', slug: SAND, language: 'da', isSandbox: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: RIGTIG, tenantId: T, createdBy: U, name: 'Rigtig', slug: RIGTIG, language: 'da' }).run();
  for (const [id, key, ids] of [
    ['k-graense', AFGRÆNSET, JSON.stringify([SAND, RIGTIG])],   // bevilget til BEGGE
    ['k-fri', FRI, null],
  ] as const)
    await trail.db.insert(apiKeys).values({
      id, tenantId: T, userId: U, name: id,
      keyHash: createHash('sha256').update(key).digest('hex'),
      scope: 'ambient', scopeKbIds: ids,
    }).run();
  app = createApp(trail, new Map([['sb', trail]]));
});

test('DEN BÆRENDE: en afgrænset nøgle KAN uploade til en sandkasse', async () => {
  const res = await upload(SAND, AFGRÆNSET);
  expect([200, 201]).toContain(res.status);
});

test('DEN BÆRENDE ANDEN VEJ: samme nøgle kan IKKE uploade til en rigtig Brain', async () => {
  // Nøglen er bevilget til BEGGE Brains — så det her måler sandkasse-kravet
  // og ikke afgrænsningen. Var den kun bevilget til sandkassen, ville prøven
  // bestå af den forkerte grund.
  const res = await upload(RIGTIG, AFGRÆNSET);
  expect(res.status).toBe(403);
  expect((await res.json() as { error: string }).error).toBe('upload-requires-sandbox-kb');
});

test('NEGATIV KONTROL: en UAFGRÆNSET nøgle kan uploade hvor som helst', async () => {
  // Uden den ville «kræv sandkasse af alle» bestå lige så grønt — og hver
  // curator, admin-fladen og hver integration fra før F263.8 ville brække.
  const res = await upload(RIGTIG, FRI);
  expect([200, 201]).toContain(res.status);
});
