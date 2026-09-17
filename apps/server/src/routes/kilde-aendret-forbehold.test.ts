/**
 * F275.5 AC#1 — den gamle påstand må ikke svare som GÆLDENDE.
 *
 * At markere en side i databasen er ikke nok: mærket skal nå frem til det sted
 * hvor siden bliver til et svar. Ellers er afløsningen kun ryddet op i køen,
 * mens hjernen svarer videre på gårsdagens tekst — og det er værre end i dag,
 * fordi det ikke længere ligner et problem.
 *
 * Målt gennem det ÆGTE hentnings-endepunkt, ikke gennem formateringsfunktionen.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  createLibsqlDatabase, tenants, users, knowledgeBases, documents, documentChunks, apiKeys,
} from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-kaf', U = 'u-kaf', KB = 'kb-kaf';
const NØGLE = 'trail_' + 'f'.repeat(64);
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

const PÅSTAND = 'Projektet bygges nu og er endnu ikke lanceret hos kunderne i Danmark.';

async function hent() {
  const res = await app.request(`http://engine.local/api/v1/knowledge-bases/${KB}/retrieve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${NØGLE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'projektet lanceret kunderne', topK: 5 }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { formattedContext: string; chunks: unknown[] };
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `kaf-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.initFTS();
  await trail.db.insert(tenants).values({ id: T, slug: 'kaf', name: 'Kaf', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'k@f.dk', displayName: 'K', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Kaf', slug: KB, language: 'da' }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(NØGLE).digest('hex'), scope: 'all',
  }).run();
  await trail.db.insert(documents).values({
    id: 'overview', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/', filename: 'overview.md', title: 'Overblik', content: PÅSTAND, fileType: 'md',
  }).run();
  await trail.db.insert(documentChunks).values({
    id: 'c1', tenantId: T, knowledgeBaseId: KB, documentId: 'overview', chunkIndex: 0, content: PÅSTAND, tokenCount: 20,
  }).run();
  app = createApp(trail, new Map([['kaf', trail]]));
});

test('POSITIV KONTROL: uden mærke svarer siden uden forbehold', async () => {
  // Uden den beviser prøven herunder kun at der stod noget i svaret.
  const r = await hent();
  expect(r.formattedContext).toContain('bygges nu');
  expect(r.formattedContext).not.toContain('⚠️');
});

test('AC#1 DEN BÆRENDE: med mærke bærer svaret et forbehold — FØR indholdet', async () => {
  await trail.db.update(documents)
    .set({ sourceChangedAt: Date.parse('2026-09-16T10:00:00Z') })
    .where(eq(documents.id, 'overview')).run();
  const r = await hent();

  expect(r.formattedContext).toContain('Kilden bag denne side fik en ny udgave');
  // DANSK TID PÅ NAVN: 16/9 kl. 10:00 UTC er 16. september i København.
  expect(r.formattedContext).toContain('16. september');
  expect(r.formattedContext).toContain('svar aldrig som om det er bekræftet mod den nyeste kilde');

  // RÆKKEFØLGEN ER BÆRENDE. En advarsel UNDER en tekst læses efter påstanden
  // er troet — af et menneske og af en model.
  expect(r.formattedContext.indexOf('⚠️')).toBeLessThan(r.formattedContext.indexOf('bygges nu'));
});

test('mærket ryddes ⇒ forbeholdet forsvinder igen', async () => {
  // Vejen tilbage har sin egen prøve: et mærke der kun kan SÆTTES ville se
  // identisk ud med et der virker, indtil nogen prøvede at rydde det.
  await trail.db.update(documents).set({ sourceChangedAt: null }).where(eq(documents.id, 'overview')).run();
  const r = await hent();
  expect(r.formattedContext).not.toContain('⚠️');
  expect(r.formattedContext).toContain('bygges nu');
});
