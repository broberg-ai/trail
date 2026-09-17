/**
 * F280.1 — «parkér til gratis kompilering» skal betyde det samme ad begge veje.
 *
 * Enkelt-POST'en spærrer med `if (isText && !localCompile)`. Den chunk-delte
 * finalize kaldte triggerIngest UBETINGET, og /init læste slet ikke flaget — så
 * en source der var bedt parkeret fik en betalt sky-kompilering alligevel.
 *
 * Bider ikke i dag: Ingest Station bruger enkelt-POST'en. Den bider den dag
 * nogen flytter den til den chunk-delte vej, hvilket er den naturlige vej for
 * store filer — og den ville bide TAVST, for en sky-kompilering ser ud som en
 * vellykket kompilering.
 */
import { test, expect, beforeAll, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys, documents, ingestJobs } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-lc', U = 'u-lc';
const NØGLE = 'trail_' + 'c'.repeat(64);
let KB = '';
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

/** Indholdet varierer pr. fil — ellers rammer vi F162's dedup på contentHash. */
const tekst = (navn: string) =>
  `# Kilde ${navn}\n\nEn tekst der er lang nok til at blive kompileret hvis nogen beder om det.`;

async function chunket(navn: string, query: string) {
  const bytes = new TextEncoder().encode(tekst(navn));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const H = { Authorization: `Bearer ${NØGLE}`, 'Content-Type': 'application/json' };

  const init = await app.request(
    `http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload/init${query}`,
    { method: 'POST', headers: H, body: JSON.stringify({ filename: navn, contentLength: bytes.length, contentHash: hash }) },
  );
  expect(init.status).toBe(201);
  const { uploadId } = (await init.json()) as { uploadId: string };

  await app.request(`http://engine.local/api/v1/uploads/${uploadId}/chunk`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NØGLE}`,
      'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
  });
  const fin = await app.request(`http://engine.local/api/v1/uploads/${uploadId}/finalize`, {
    method: 'POST', headers: H, body: JSON.stringify({ contentHash: hash }),
  });
  expect(fin.status).toBe(201);
  return (await fin.json()) as { doc: { id: string } };
}

async function enkelt(navn: string, query: string) {
  const fd = new FormData();
  fd.append('file', new Blob([tekst(navn)], { type: 'text/markdown' }), navn);
  const res = await app.request(
    `http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload${query}`,
    { method: 'POST', headers: { Authorization: `Bearer ${NØGLE}` }, body: fd },
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function parkeret(id: string) {
  const r = await trail.db
    .select({ p: documents.awaitingLocalCompile }).from(documents).where(eq(documents.id, id)).get();
  return r?.p ?? null;
}

/**
 * BLEV DER BESTILT EN KOMPILERING? Det er det spørgsmål kortet handler om.
 *
 * Første udgave af prøven målte kun `awaiting_local_compile`, og da jeg
 * muterede spærren i finalize væk, forblev den GRØN: parkeringen var bevist,
 * men «og derfor ingen sky-kompilering» var det ikke. To halvdele af én
 * påstand, og kun den ene var målt.
 *
 * `triggerIngest` er fire-and-forget, så rækken skrives et øjeblik after
 * svaret. Vi venter kort og ser after — en tom tabel målt for tidligt ville
 * ligne den adfærd vi ønsker.
 */
async function compileWasQueued(docId: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const r = await trail.db
      .select({ id: ingestJobs.id }).from(ingestJobs).where(eq(ingestJobs.documentId, docId)).all();
    if (r.length > 0) return true;
    await new Promise((r2) => setTimeout(r2, 25));
  }
  return false;
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `lc-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'lc', name: 'Lc', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'l@c.dk', displayName: 'L', role: 'owner', onboarded: true }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(NØGLE).digest('hex'), scope: 'all',
  }).run();
  app = createApp(trail, new Map([['lc', trail]]));
});

let n = 0;
beforeEach(async () => {
  KB = `kb-lc-${n++}`;
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: KB, slug: KB, language: 'da' }).run();
});

test('AC#0 DEN BÆRENDE: chunk-delt med ?localCompile=true PARKERER kilden — og bestiller INGEN kompilering', async () => {
  const r = await chunket('parkeret.md', '?localCompile=true');
  expect(await parkeret(r.doc.id)).toBe(true);
  // Den anden halvdel af påstanden, og den der koster penge hvis den svigter.
  expect(await compileWasQueued(r.doc.id)).toBe(false);
});

test('AC#1 POSITIV KONTROL: chunk-delt UDEN flaget parkerer IKKE — og bestiller en kompilering', async () => {
  // Uden den kan kortet opfyldes ved at slå kompilering fra på hele den
  // chunk-delte vej — en stille funktionsfjernelse forklædt som ensretning.
  const r = await chunket('normal.md', '');
  expect(await parkeret(r.doc.id)).toBe(false);
  expect(await compileWasQueued(r.doc.id)).toBe(true);
});

test('AC#2 ENKELT-POST\'EN ER URØRT — begge retninger', async () => {
  expect(await parkeret((await enkelt('p-parkeret.md', '?localCompile=true')).id)).toBe(true);
  expect(await parkeret((await enkelt('p-normal.md', '')).id)).toBe(false);
});

test('de to veje er ENIGE om hvad flaget betyder', async () => {
  // Var de uenige, ville «gratis kompilering» afhænge af hvilken klient der
  // uploadede — altså af noget der intet har med brugerens ønske at gøre.
  const a = await chunket('enig.md', '?localCompile=true');
  const b = await enkelt('enig2.md', '?localCompile=true');
  expect([await parkeret(a.doc.id), await parkeret(b.id)]).toEqual([true, true]);
});
