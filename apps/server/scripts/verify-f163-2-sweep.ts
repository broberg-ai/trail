/**
 * F163.2 Phase 5 — verify the legacy sweep-job.
 *
 * Seeds 4 throwaway image-rows with auto_flag_signal=0 and a mix of
 * descriptions:
 *   - 1 with regex-matching text       → should get flagged
 *   - 1 with another regex match       → should get flagged with different reason
 *   - 1 with a clean anatomy description → must NOT be flagged
 *   - 1 with auto_flag_signal=1 already → must be SKIPPED (no overwrite)
 *
 * Calls sweepAutoFlag() directly with TRAIL_VISION_AUTO_FLAG_SWEEP=1
 * env-flag set. Asserts:
 *   1. flagged count = 2 (only the two regex matches)
 *   2. clean-description row stays auto_flag_signal=0
 *   3. already-flagged row's reason was NOT overwritten
 *   4. flag reasons are correctly tagged ('regex:<name>')
 *
 * Idempotency: a second sweep call should find 0 new candidates
 * (already-flagged rows are excluded by WHERE).
 *
 * Run: `cd apps/server && bun run scripts/verify-f163-2-sweep.ts`
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { eq, inArray, and } from 'drizzle-orm';
import {
  createLibsqlDatabase,
  documents,
  documentImages,
  tenants,
} from '@trail/db';
import { sweepAutoFlag } from '../src/bootstrap/sweep-auto-flag.js';

const REPO_ROOT_DB = join(homedir(), 'Apps/broberg/trail/data/trail.db');

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log(`\n=== F163.2 Phase 5 verify (legacy sweep-job) ===\n`);

const trail = await createLibsqlDatabase({ path: REPO_ROOT_DB });
await trail.runMigrations();

const tenant = await trail.db
  .select({ id: tenants.id })
  .from(tenants)
  .where(eq(tenants.slug, 'christian'))
  .get();
if (!tenant) {
  console.log('  ✗ tenant t-christian missing');
  process.exit(1);
}
const hostDoc = await trail.db
  .select({ id: documents.id, knowledgeBaseId: documents.knowledgeBaseId })
  .from(documents)
  .where(and(eq(documents.tenantId, tenant.id), eq(documents.kind, 'source')))
  .limit(1)
  .get();
if (!hostDoc) {
  console.log('  ✗ no source-doc to host test-images');
  process.exit(1);
}
const kbId = hostDoc.knowledgeBaseId;

const PREFIX = `dim_sweep_${Date.now()}_`;
const seededIds: string[] = [];

async function seed(label: string, description: string, autoFlag: 0 | 1, autoReason: string | null): Promise<string> {
  const id = `${PREFIX}${label}`;
  await trail.db
    .insert(documentImages)
    .values({
      id,
      documentId: hostDoc!.id,
      tenantId: tenant!.id,
      knowledgeBaseId: kbId,
      filename: `${label}.png`,
      storagePath: `${tenant!.id}/${kbId}/${hostDoc!.id}/images/${label}.png`,
      contentHash: `sweep-${label}-${Date.now()}`,
      sizeBytes: 100,
      page: 1,
      width: 10,
      height: 10,
      visionDescription: description,
      visionModel: 'verify-legacy',
      visionAt: new Date().toISOString(),
      autoFlagSignal: autoFlag,
      autoFlagReason: autoReason,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
  seededIds.push(id);
  return id;
}

console.log('[1] Seed 4 legacy-style image-rows');
const idMatch1 = await seed('match-1', 'I can see this appears to be a small image too small to identify the content.', 0, null);
const idMatch2 = await seed('match-2', 'A pixel-like shape against a white background.', 0, null);
const idClean = await seed('clean', 'Anatomical diagram of the human foot showing bone structure.', 0, null);
const idPreFlagged = await seed('pre-flagged', 'Already flagged by another path.', 1, 'pre-existing');

assert(seededIds.length === 4, '4 rows seeded');

// Set env-flag and run sweep
process.env.TRAIL_VISION_AUTO_FLAG_SWEEP = '1';

console.log('\n[2] First sweep — should flag 2 rows');
await sweepAutoFlag(trail);

const after1 = await trail.db
  .select()
  .from(documentImages)
  .where(inArray(documentImages.id, seededIds))
  .all();
const byId = new Map(after1.map((r) => [r.id, r]));

const m1 = byId.get(idMatch1);
const m2 = byId.get(idMatch2);
const clean = byId.get(idClean);
const pre = byId.get(idPreFlagged);

assert(m1?.autoFlagSignal === 1, `match-1 flagged (got ${m1?.autoFlagSignal})`);
assert(
  m1?.autoFlagReason?.startsWith('regex:'),
  `match-1 reason starts with 'regex:' (got ${m1?.autoFlagReason})`,
);
assert(m2?.autoFlagSignal === 1, `match-2 flagged (got ${m2?.autoFlagSignal})`);
assert(
  m2?.autoFlagReason === 'regex:pixel-like',
  `match-2 reason='regex:pixel-like' (got ${m2?.autoFlagReason})`,
);
assert(clean?.autoFlagSignal === 0, `clean stays un-flagged (got ${clean?.autoFlagSignal})`);
assert(pre?.autoFlagSignal === 1 && pre?.autoFlagReason === 'pre-existing',
  `pre-flagged row's reason NOT overwritten (got ${pre?.autoFlagReason})`);

// ── 3. Idempotency — second sweep finds nothing new ────────────────────
console.log('\n[3] Second sweep — idempotent, no new flags');
// Capture timestamps to confirm no UPDATE fired again on already-flagged rows
const updatedAtBefore = m1?.updatedAt;
await new Promise((resolve) => setTimeout(resolve, 50)); // ensure clock would advance if UPDATE fired
await sweepAutoFlag(trail);
const after2 = await trail.db
  .select({ id: documentImages.id, updatedAt: documentImages.updatedAt })
  .from(documentImages)
  .where(eq(documentImages.id, idMatch1))
  .get();
assert(after2?.updatedAt === updatedAtBefore, `match-1 updated_at unchanged on re-run (idempotent)`);

// ── 4. Sweep skipped when env-flag absent ──────────────────────────────
console.log('\n[4] No env-flag → sweep is a no-op');
delete process.env.TRAIL_VISION_AUTO_FLAG_SWEEP;
// Reset one row so we can detect if sweep wrongly fires
await trail.db
  .update(documentImages)
  .set({ autoFlagSignal: 0, autoFlagReason: null })
  .where(eq(documentImages.id, idMatch1))
  .run();
await sweepAutoFlag(trail);
const after3 = await trail.db
  .select({ autoFlagSignal: documentImages.autoFlagSignal })
  .from(documentImages)
  .where(eq(documentImages.id, idMatch1))
  .get();
assert(after3?.autoFlagSignal === 0, `sweep was no-op without env-flag (got autoFlagSignal=${after3?.autoFlagSignal})`);

// ── Cleanup ────────────────────────────────────────────────────────────
console.log('\n[cleanup] removing seeded rows');
await trail.db
  .delete(documentImages)
  .where(inArray(documentImages.id, seededIds))
  .run();

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
await trail.close();
process.exit(failures === 0 ? 0 : 1);
