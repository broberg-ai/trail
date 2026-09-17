/**
 * F280.1 — "park it for free compilation" must mean the same thing on both paths.
 *
 * The single POST guards with `if (isText && !localCompile)`. The chunked
 * finalize called triggerIngest UNCONDITIONALLY, and /init did not read the flag
 * at all — so a source asked to be parked got a paid cloud compile anyway.
 *
 * It does not bite today: Ingest Station uses the single POST. It bites the day
 * someone moves it to the chunked path, which is the natural route for large
 * files — and it would bite SILENTLY, because a cloud compile looks exactly like
 * a successful compile.
 */
import { test, expect, beforeAll, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys, documents, ingestJobs } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-lc', U = 'u-lc';
const KEY = 'trail_' + 'c'.repeat(64);
let KB = '';
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

/** The content varies per file — otherwise we hit F162's dedup on contentHash. */
const text = (name: string) =>
  `# Kilde ${name}\n\nEn tekst der er lang nok til at blive kompileret hvis nogen beder om det.`;

async function chunked(name: string, query: string) {
  const bytes = new TextEncoder().encode(text(name));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const init = await app.request(
    `http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload/init${query}`,
    { method: 'POST', headers: H, body: JSON.stringify({ filename: name, contentLength: bytes.length, contentHash: hash }) },
  );
  expect(init.status).toBe(201);
  const { uploadId } = (await init.json()) as { uploadId: string };

  await app.request(`http://engine.local/api/v1/uploads/${uploadId}/chunk`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${KEY}`,
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

async function singlePost(name: string, query: string) {
  const fd = new FormData();
  fd.append('file', new Blob([text(name)], { type: 'text/markdown' }), name);
  const res = await app.request(
    `http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload${query}`,
    { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd },
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function isParked(id: string) {
  const r = await trail.db
    .select({ p: documents.awaitingLocalCompile }).from(documents).where(eq(documents.id, id)).get();
  return r?.p ?? null;
}

/**
 * WAS A COMPILE QUEUED? That is the question this card is about.
 *
 * The first version of the test only measured `awaiting_local_compile`, and when
 * I mutated the guard in finalize away it stayed GREEN: parking was proven, but
 * "and therefore no cloud compile" was not. Two halves of one claim, and only one
 * of them measured.
 *
 * `triggerIngest` is fire-and-forget, so the row is written a moment after the
 * response. We wait briefly and look again — an empty table measured too early
 * would look exactly like the behaviour we want.
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
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'lc', name: 'Lc', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'l@c.dk', displayName: 'L', role: 'owner', onboarded: true }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(KEY).digest('hex'), scope: 'all',
  }).run();
  app = createApp(trail, new Map([['lc', trail]]));
});

let n = 0;
beforeEach(async () => {
  KB = `kb-lc-${n++}`;
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: KB, slug: KB, language: 'da' }).run();
});

test('AC#0 LOAD-BEARING: chunked with ?localCompile=true PARKS the source — and queues NO compile', async () => {
  const r = await chunked('parked.md', '?localCompile=true');
  expect(await isParked(r.doc.id)).toBe(true);
  // The other half of the claim, and the one that costs money when it fails.
  expect(await compileWasQueued(r.doc.id)).toBe(false);
});

test('AC#1 POSITIVE CONTROL: chunked WITHOUT the flag does not park — and queues a compile', async () => {
  // Without it the card can be satisfied by switching compilation off for the
  // entire chunked path — a silent feature removal disguised as alignment.
  const r = await chunked('normal.md', '');
  expect(await isParked(r.doc.id)).toBe(false);
  expect(await compileWasQueued(r.doc.id)).toBe(true);
});

test('AC#2 THE SINGLE POST IS UNTOUCHED — both directions', async () => {
  expect(await isParked((await singlePost('p-parked.md', '?localCompile=true')).id)).toBe(true);
  expect(await isParked((await singlePost('p-normal.md', '')).id)).toBe(false);
});

test('the two paths AGREE on what the flag means', async () => {
  // If they disagreed, "free compilation" would depend on which client uploaded
  // — that is, on something with no bearing on what the user asked for.
  const a = await chunked('agree.md', '?localCompile=true');
  const b = await singlePost('agree2.md', '?localCompile=true');
  expect([await isParked(a.doc.id), await isParked(b.id)]).toEqual([true, true]);
});
