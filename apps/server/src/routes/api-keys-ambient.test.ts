/**
 * F263.17 — en LÆSE-nøgle til ÉN Brain skal kunne mintes over API'et.
 *
 * Uden den ville en ekstern kunde (HelpDesk, kunde nr. 1 er broberg.ai) have
 * fået en `full`-nøgle: den handler SOM BRUGEREN på tværs af hele kontoen, altså
 * adgang til hver eneste Brain frem for den ene de skal bruge. Det er ikke en
 * bekvemmelighed — det er en databehandler-grænse.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, apiKeys } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from './../app.js';

const T = 't-nk', U = 'u-nk', KB_A = 'kb-a', KB_B = 'kb-b';
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

const mint = (body: unknown) =>
  app.request('http://engine.local/api/v1/api-keys', {
    method: 'POST',
    headers: { Cookie: 'session=sess-nk', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `nk-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'nk', name: 'NK', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'n@k.dk', displayName: 'N', role: 'owner', onboarded: true }).run();
  for (const [id, slug] of [[KB_A, 'a'], [KB_B, 'b']] as const)
    await trail.db.insert(knowledgeBases).values({ id, tenantId: T, createdBy: U, name: id, slug, language: 'da' }).run();
  await trail.db.insert(sessions).values({ id: 'sess-nk', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();
  app = createApp(trail, new Map([['nk', trail]]));
});

test('DEN BÆRENDE: en ambient-nøgle bindes til de Brains der blev bedt om', async () => {
  const res = await mint({ name: 'helpdesk', scope: 'ambient', kbIds: [KB_A] });
  expect(res.status).toBe(201);
  const b = (await res.json()) as { scope: string; scopeKbIds: string; key: string };
  expect(b.scope).toBe('ambient');
  expect(JSON.parse(b.scopeKbIds)).toEqual([KB_A]);

  // LÆST TILBAGE FRA BASEN, ikke fra svaret.
  const row = await trail.db
    .select({ scope: apiKeys.scope, ids: apiKeys.scopeKbIds })
    .from(apiKeys).where(eq(apiKeys.name, 'helpdesk')).get();
  expect(row?.scope).toBe('ambient');
  expect(JSON.parse(row!.ids!)).toEqual([KB_A]);
  expect(JSON.parse(row!.ids!)).not.toContain(KB_B);   // den ANDEN Brain er ude
});

test('EN AMBIENT-NØGLE UDEN kbIds AFVISES — den ville spænde over hele kontoen', async () => {
  // En tenant-bred nøgle udleveret som «den er begrænset» er værre end en åben:
  // modtageren bygger på en beskyttelse der ikke findes.
  const res = await mint({ name: 'uden-graense', scope: 'ambient' });
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toContain('kbIds is required');
});

test('ET UKENDT kb-id AFVISES — en delmængde ville tie om tastefejlen', async () => {
  const res = await mint({ name: 'tastefejl', scope: 'ambient', kbIds: [KB_A, 'kb-findes-ikke'] });
  expect(res.status).toBe(404);
  expect((await res.json() as { error: string }).error).toContain('kb-findes-ikke');
  // og INTET blev mintet
  const row = await trail.db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.name, 'tastefejl')).get();
  expect(row).toBeUndefined();
});

test('NEGATIV KONTROL: en full-nøgle er stadig UBEGRÆNSET — den gamle vej er urørt', async () => {
  // Uden den kunne «alt afgrænses» bestå lige så grønt, og hver eksisterende
  // nøgle ville være brudt uden at nogen så det.
  const res = await mint({ name: 'gammeldags' });
  expect(res.status).toBe(201);
  const b = (await res.json()) as { scope: string; scopeKbIds: string | null };
  expect(b.scope).toBe('full');
  expect(b.scopeKbIds).toBeNull();
});

test('F263.17.1: svaret SIGER om nøgle-indekset blev bekræftet', async () => {
  // TRE UDFALD, ikke to. Her i prøven findes der intet indeks på værten, så
  // svaret skal sige `absent-on-host` — ikke `verified`, og ikke tie.
  //
  // Den TREDJE tilstand (`null` = indekset findes og rækken landede IKKE) kan
  // ikke fremstilles her uden at bygge et indeks ved siden af; den er bevist
  // LIVE ved at gen-minte helpdesks nøgle mod produktionen. Det står her frem
  // for at lade prøven se mere dækkende ud end den er.
  const res = await mint({ name: 'indeks-svar', scope: 'ambient', kbIds: [KB_A] });
  expect(res.status).toBe(201);
  const b = (await res.json()) as { keyIndex?: string };
  expect(b.keyIndex).toBe('absent-on-host');
});
