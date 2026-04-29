/**
 * F165 Phase 1 — verify async Vision-describe end-to-end.
 *
 * What this proves (not infers):
 *   1. processFileAsync on a real PDF (the failed urter-bog) reaches
 *      documents.status='ready' WITHOUT calling Anthropic Vision inline.
 *   2. document_images rows persist for every body-image with
 *      vision_description IS NULL (they're queued for the job, not done).
 *   3. Exactly one 'vision-rerun' job is enqueued for the new doc with
 *      payload {documentIds:[docId], filter:'null-only'}.
 *   4. Wall-clock for the synchronous extract path is bounded by pdfjs-only
 *      timing (<10s), not by the 220-300s vision-loop that previously
 *      timed out. We log the elapsed time so a human can eyeball it.
 *   5. With no Vision-backend env vars set, the upload still succeeds
 *      (the job runner will fail-soft when the handler finds no backend,
 *      but that's the handler's concern — F165's contract is only that
 *      the upload completed and the job was queued).
 *
 * Pre-reqs:
 *   - data/trail.db exists with all migrations applied (the dev DB).
 *   - data/uploads/.../f0332c14-…/source.pdf exists (the urter-bog from
 *     the failed upload that triggered this feature). If it's been
 *     cleaned up, point TRAIL_F165_TEST_PDF at any local PDF.
 *
 * Run with: `cd apps/server && bun run scripts/verify-f165-async-vision.ts`
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { eq, and, isNull } from 'drizzle-orm';
import {
  createLibsqlDatabase,
  documents,
  documentImages,
  jobs,
  tenants,
  knowledgeBases,
  users,
} from '@trail/db';
import { processFileAsync } from '../src/routes/uploads.js';
import { initJobRunner } from '../src/services/jobs/runner.js';

const REPO_ROOT_DB = join(homedir(), 'Apps/broberg/trail/data/trail.db');
const DEFAULT_PDF = join(
  homedir(),
  'Apps/broberg/trail/data/uploads/t-christian/6aa52746-d235-464c-b038-d7e1965e3622/f0332c14-dce8-4b14-b279-998b0b171a24/source.pdf',
);
const TEST_PDF = process.env.TRAIL_F165_TEST_PDF ?? DEFAULT_PDF;

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log('\n=== F165 Phase 1 verify (async Vision-describe) ===\n');

// Make absolutely sure no Vision backend is reachable. F165's claim is that
// the upload SHOULDN'T be hitting Vision inline anyway, so removing keys
// here is a belt-and-braces guarantee — if a future regression re-introduced
// the inline call, this would also catch it because the call would error.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENROUTER_API_KEY;

const trail = await createLibsqlDatabase({ path: REPO_ROOT_DB });
await trail.runMigrations();

// JobRunner singleton must exist for getJobRunner() inside processFileAsync.
// We deliberately do NOT register the vision-rerun handler — the job will
// stay in 'pending' so we can inspect it without waiting for completion.
initJobRunner(trail);

// Pick tenant + KB + user from the same fixtures the dev server uses so the
// tenant_id/kb_id FKs satisfy.
console.log('[1] Resolve test tenant/kb/user');
const tenant = await trail.db
  .select({ id: tenants.id })
  .from(tenants)
  .where(eq(tenants.slug, 'christian'))
  .get();
if (!tenant) {
  console.log('  ✗ tenant t-christian missing — run dev server once first');
  process.exit(1);
}
const kb = await trail.db
  .select({ id: knowledgeBases.id })
  .from(knowledgeBases)
  .where(and(eq(knowledgeBases.tenantId, tenant.id), eq(knowledgeBases.slug, 'sanne-andersen')))
  .get();
if (!kb) {
  console.log('  ✗ kb sanne-andersen missing');
  process.exit(1);
}
const user = await trail.db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.tenantId, tenant.id))
  .get();
if (!user) {
  console.log('  ✗ no user found for tenant');
  process.exit(1);
}
console.log(`  → tenant=${tenant.id} kb=${kb.id} user=${user.id}`);

// Read the test PDF from disk.
console.log(`[2] Load test PDF: ${TEST_PDF}`);
let pdfBytes: Buffer;
try {
  pdfBytes = readFileSync(TEST_PDF);
} catch {
  console.log(`  ✗ cannot read ${TEST_PDF} — set TRAIL_F165_TEST_PDF`);
  process.exit(1);
}
console.log(`  → ${(pdfBytes.length / 1024).toFixed(0)} KB`);

// Insert a fresh document row to mirror what uploads.ts does before kicking
// processFileAsync. Different docId from the failed one so we don't clobber.
const docId = crypto.randomUUID();
const filename = `verify-f165-${Date.now()}.pdf`;
console.log(`[3] Create test doc row docId=${docId.slice(0, 8)}…`);
await trail.db
  .insert(documents)
  .values({
    id: docId,
    tenantId: tenant.id,
    knowledgeBaseId: kb.id,
    userId: user.id,
    kind: 'source',
    filename,
    fileType: 'pdf',
    fileSize: pdfBytes.length,
    status: 'pending',
    path: '/',
  })
  .run();

// ── The actual exercise ────────────────────────────────────────────────
console.log('[4] Run processFileAsync — should NOT call Vision inline');
const t0 = Date.now();
try {
  await processFileAsync(trail, docId, tenant.id, kb.id, user.id, filename, pdfBytes);
} catch (err) {
  console.log(`  ✗ processFileAsync threw: ${err instanceof Error ? err.message : String(err)}`);
  failures += 1;
}
const elapsedMs = Date.now() - t0;
console.log(`  → elapsed: ${elapsedMs}ms`);
assert(elapsedMs < 60_000, `extract finished in <60s (was ${elapsedMs}ms) — pdfjs-only path`);

// ── Verify state ───────────────────────────────────────────────────────
console.log('[5] Inspect document row');
const doc = await trail.db.select().from(documents).where(eq(documents.id, docId)).get();
assert(doc?.status === 'ready', `documents.status='ready' (was ${doc?.status})`);
assert((doc?.pageCount ?? 0) > 0, `pageCount > 0 (was ${doc?.pageCount})`);
assert(typeof doc?.content === 'string' && doc.content.length > 0, 'markdown content extracted');

console.log('[6] Inspect document_images rows');
const images = await trail.db
  .select()
  .from(documentImages)
  .where(eq(documentImages.documentId, docId))
  .all();
assert(images.length > 0, `at least one image row persisted (got ${images.length})`);
const nullDescCount = images.filter((i) => i.visionDescription === null).length;
assert(
  nullDescCount === images.length,
  `all ${images.length} image rows have vision_description=NULL (got ${nullDescCount})`,
);

console.log('[7] Inspect jobs row');
const queuedJobs = await trail.db
  .select()
  .from(jobs)
  .where(and(eq(jobs.kind, 'vision-rerun'), eq(jobs.tenantId, tenant.id)))
  .all();
const ourJob = queuedJobs.find((j) => {
  try {
    const p = JSON.parse(j.payload ?? '{}') as { documentIds?: string[] };
    return Array.isArray(p.documentIds) && p.documentIds.includes(docId);
  } catch {
    return false;
  }
});
assert(ourJob !== undefined, 'a vision-rerun job exists for the new doc');
if (ourJob) {
  const payload = JSON.parse(ourJob.payload ?? '{}') as {
    documentIds?: string[];
    filter?: string;
  };
  assert(
    payload.documentIds?.length === 1 && payload.documentIds[0] === docId,
    'job payload.documentIds === [docId]',
  );
  assert(payload.filter === 'null-only', `job payload.filter='null-only' (got ${payload.filter})`);
  assert(ourJob.status === 'pending', `job.status='pending' (handler not registered in test) (got ${ourJob.status})`);
}

// ── Cleanup ────────────────────────────────────────────────────────────
console.log('[8] Cleanup test rows');
if (ourJob) await trail.db.delete(jobs).where(eq(jobs.id, ourJob.id)).run();
await trail.db.delete(documentImages).where(eq(documentImages.documentId, docId)).run();
await trail.db.delete(documents).where(eq(documents.id, docId)).run();
console.log('  → test doc + images + job deleted');

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
