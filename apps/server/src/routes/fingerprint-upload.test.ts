/**
 * F275.6 — the four cases, measured through the REAL upload paths.
 *
 * AC#2: the question is asked AT UPLOAD, never in the queue afterwards. The human
 * who just dragged the file in knows which of the two it is; the curator three
 * days later does not.
 *
 * The document fixtures stay in Danish: the product's sources are Danish, and the
 * similarity measure works on words.
 */
import { test, expect, beforeAll, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys, documents } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-fa', U = 'u-fa';
/**
 * Every test gets its OWN Brain — but we share one database.
 *
 * The first version created a fresh database in `beforeEach`, and THAT paralysed
 * the whole server suite: a chunked upload triggers a compile (finalize did not
 * honour `localCompile`, see uploads.ts), and the job was left running against a
 * database that had been swapped out underneath it. The run then held
 * global-concurrency forever and wrote 2,576,392 lines of "[backpressure] holding
 * job_…" without a single test finishing.
 *
 * Measured: without this file, 402 green in 10.5 s; with it, forever.
 */
let KB = '';
const KEY = 'trail_' + 'a'.repeat(64);
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

const REPORT = `# Årsrapport 2025

Selskabet har i regnskabsåret realiseret en omsætning på 12,4 millioner kroner mod
9,8 millioner året før. Væksten kommer primært fra nye kundeaftaler inden for
hosting og softwareudvikling. Resultatet før skat udgør 2,1 millioner kroner.
Bestyrelsen indstiller at årets resultat overføres til næste regnskabsår.
Selskabet beskæftigede i gennemsnit fire medarbejdere. Ledelsen forventer fortsat
vækst i det kommende regnskabsår, drevet af den samme kombination som hidtil.`;

const REPORT_NEW_YEAR = REPORT.replace('2025', '2026');

const SOMETHING_ELSE = `# Databehandleraftale

Aftalen regulerer behandling af personoplysninger i forbindelse med levering af
hosting. Databehandleren må alene behandle oplysninger efter dokumenteret instruks
fra den dataansvarlige. Oplysningerne opbevares inden for EU og slettes ved
aftalens ophør. Parterne er enige om at tekniske og organisatoriske
sikkerhedsforanstaltninger skal afspejle risikoen ved behandlingen.`;

type Warning = { kind: string; verdict?: string; similarity?: number | null; resembles?: { filename: string } };

async function upload(name: string, content: string) {
  const fd = new FormData();
  fd.append('file', new Blob([content], { type: 'text/markdown' }), name);
  const res = await app.request(`http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload?localCompile=true`, {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd,
  });
  return { res, body: (await res.json()) as { id: string; warning?: Warning } };
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `fa-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'fa', name: 'Fa', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f@a.dk', displayName: 'F', role: 'owner', onboarded: true }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(KEY).digest('hex'), scope: 'all',
  }).run();
  app = createApp(trail, new Map([['fa', trail]]));
});

let n = 0;
beforeEach(async () => {
  // A fresh BRAIN per test gives each case the isolation it needs — similarity is
  // only looked up within one Brain — without pulling the database out from under
  // a running job.
  // slug == id: resolveKbId looks up a non-UUID by SLUG, not by id.
  KB = `kb-fa-${n++}`;
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: KB, slug: KB, language: 'da' }).run();
});

test('the fingerprint is set at upload — and NULL when the text is too short to measure', async () => {
  const { body } = await upload('rapport.md', REPORT);
  const r = await trail.db
    .select({ a: documents.contentFingerprint }).from(documents).where(eq(documents.id, body.id)).get();
  expect(typeof r!.a).toBe('string');
  expect(r!.a!.length).toBe(64 * 8);

  const short = await upload('kort.md', '# Side 1 af 4');
  const rs = await trail.db
    .select({ a: documents.contentFingerprint }).from(documents).where(eq(documents.id, short.body.id)).get();
  // "Could not be measured" — not "new source", and not a false fingerprint over
  // three words.
  expect(rs!.a).toBeNull();
});

test('AC#3 CASE 1 — high similarity + SAME name = new edition, with the score in the message', async () => {
  await upload('rapport.md', REPORT);
  const { body } = await upload('rapport.md', REPORT_NEW_YEAR);
  expect(body.warning?.kind).toBe('same-source');
  expect(body.warning?.verdict).toBe('new-edition');
  expect(body.warning!.similarity!).toBeGreaterThan(0.85);
});

test('AC#3 CASE 2 — high similarity + DIFFERENT name = same work under a new name', async () => {
  // The case a filename identity CANNOT see: the names differ, after all.
  await upload('rapport.md', REPORT);
  const { body } = await upload('rapport-endelig.md', REPORT_NEW_YEAR);
  expect(body.warning?.kind).toBe('same-work-new-name');
  expect(body.warning?.resembles?.filename).toBe('rapport.md');
  expect(body.warning!.similarity!).toBeGreaterThan(0.85);
});

test('AC#3 CASE 3 — LOW similarity + SAME name = NAME COLLISION, the loudest alarm', async () => {
  // Two works fighting over one name. With filename + Brain as the identity this
  // is EXACTLY where a silent overwrite would happen, and it is invisible after.
  await upload('bilag.md', REPORT);
  const { body } = await upload('bilag.md', SOMETHING_ELSE);
  expect(body.warning?.kind).toBe('same-source');
  expect(body.warning?.verdict).toBe('name-collision');
  expect(body.warning!.similarity!).toBeLessThan(0.85);
});

test('AC#3 CASE 4 — low similarity + different name = a new source, and we say NOTHING', async () => {
  // Without this, "always warn" would pass just as green — and a message on every
  // single upload is no message at all.
  await upload('rapport.md', REPORT);
  const { body } = await upload('aftale.md', SOMETHING_ELSE);
  expect(body.warning).toBeUndefined();
});

test('AC#5 — a file we CANNOT measure does not trigger "same work"', async () => {
  // A scanned PDF with no text layer has no fingerprint. "Could not measure" must
  // never become a claim about similarity — for or against.
  await upload('rapport.md', REPORT);
  const { body } = await upload('scannet.md', '# 1');
  expect(body.warning).toBeUndefined();
});

test('AC#5 — a filename clash WITHOUT fingerprints still reports, but says "undecidable"', async () => {
  // The message must not go missing merely because we could not measure the
  // similarity: the identity already says it is the same source. It is the DEGREE
  // we do not know.
  await upload('scannet.md', '# 1');
  const { body } = await upload('scannet.md', '# 2');
  expect(body.warning?.kind).toBe('same-source');
  expect(body.warning?.verdict).toBe('undecidable');
  expect(body.warning?.similarity).toBeNull();
});

/**
 * THE PATH THE ADMIN PANEL ACTUALLY USES.
 *
 * Written because the mutation "remove the fingerprint from the chunked path"
 * stayed GREEN: every test above goes through the single POST, and the panel uses
 * only the chunked one. A fingerprint set on one path only is green in the tests
 * and absent on the screen — the same trap as in F275.2, and it cost us once
 * already.
 */
async function uploadChunked(name: string, content: string) {
  const bytes = new TextEncoder().encode(content);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const init = await app.request(`http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload/init?localCompile=true`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ filename: name, contentLength: bytes.length, contentHash: hash }),
  });
  expect(init.status).toBe(201);
  const { uploadId } = (await init.json()) as { uploadId: string };

  const chunk = await app.request(`http://engine.local/api/v1/uploads/${uploadId}/chunk`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
  });
  expect(chunk.status).toBe(200);

  const fin = await app.request(`http://engine.local/api/v1/uploads/${uploadId}/finalize`, {
    method: 'POST', headers: H, body: JSON.stringify({ contentHash: hash }),
  });
  expect(fin.status).toBe(201);
  return (await fin.json()) as { doc: { id: string }; warning?: Warning };
}

test('THE CHUNKED PATH sets the fingerprint — otherwise the feature is invisible in the panel', async () => {
  const r = await uploadChunked('chunket.md', REPORT);
  const row = await trail.db
    .select({ a: documents.contentFingerprint }).from(documents).where(eq(documents.id, r.doc.id)).get();
  expect(typeof row!.a).toBe('string');
  expect(row!.a!.length).toBe(64 * 8);
});

test('… and the four cases work THERE TOO: same work under a new name', async () => {
  await uploadChunked('rapport.md', REPORT);
  const r = await uploadChunked('rapport-endelig.md', REPORT_NEW_YEAR);
  expect(r.warning?.kind).toBe('same-work-new-name');
  expect(r.warning?.resembles?.filename).toBe('rapport.md');
});

test('… and the two paths AGREE: a file uploaded chunked is recognised by the single POST', async () => {
  // If they disagreed about the fingerprint, "same work" would depend on which
  // client uploaded — that is, on something unrelated to the content.
  await uploadChunked('rapport.md', REPORT);
  const { body } = await upload('rapport-kopi.md', REPORT_NEW_YEAR);
  expect(body.warning?.kind).toBe('same-work-new-name');
  expect(body.warning?.resembles?.filename).toBe('rapport.md');
});
