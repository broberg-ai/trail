/**
 * F163.2.1 — verify dimension-based auto-flag.
 *
 * Pure-function unit tests for applyDimensionFlag + integration with
 * the sweep-job (which now also covers dim-only flagging on legacy rows
 * where description is empty / clean).
 *
 * Run: `cd apps/server && bun run scripts/verify-f163-2-1-dim.ts`
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
import { applyDimensionFlag } from '../src/services/vision.js';
import { sweepAutoFlag } from '../src/bootstrap/sweep-auto-flag.js';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log(`\n=== F163.2.1 verify (dimension-based auto-flag) ===\n`);

// ── 1. Pure function — applyDimensionFlag ──────────────────────────────
console.log('[1] applyDimensionFlag — text-flag wins, dim only fires when text=normal');

// 1a. Existing text-flag → dim-check skipped
const existingDown = applyDimensionFlag({ signal: true, reason: 'vision-prompt-low' }, 30, 30);
assert(
  existingDown.reason === 'vision-prompt-low',
  `text-flag preserved when both signals would fire (got ${existingDown.reason})`,
);

// 1b. No text-flag + small image → dim flag
process.env.TRAIL_VISION_AUTO_FLAG_MIN_DIM = '80';
const tinyBoth = applyDimensionFlag({ signal: false, reason: null }, 62, 40);
assert(tinyBoth.signal === true, 'tiny image (62×40) flagged');
assert(tinyBoth.reason === 'small-dimensions:62x40', `reason="small-dimensions:62x40" (got ${tinyBoth.reason})`);

// 1c. No text-flag + one axis tiny → still flags (EITHER condition)
const wideStrip = applyDimensionFlag({ signal: false, reason: null }, 1000, 40);
assert(wideStrip.signal === true, '1000×40 (thin strip) flagged');
const tallStrip = applyDimensionFlag({ signal: false, reason: null }, 40, 1000);
assert(tallStrip.signal === true, '40×1000 (narrow strip) flagged');

// 1d. No text-flag + both above → no flag
const decent = applyDimensionFlag({ signal: false, reason: null }, 200, 200);
assert(decent.signal === false, '200×200 stays un-flagged');

// 1e. Edge: exactly at threshold (80) → not flagged (strict <)
const onEdge = applyDimensionFlag({ signal: false, reason: null }, 80, 80);
assert(onEdge.signal === false, '80×80 (exactly at threshold) stays un-flagged');
const justBelow = applyDimensionFlag({ signal: false, reason: null }, 79, 100);
assert(justBelow.signal === true, '79×100 (one below threshold) flagged');

// 1f. Custom threshold via env
process.env.TRAIL_VISION_AUTO_FLAG_MIN_DIM = '50';
const okAt60 = applyDimensionFlag({ signal: false, reason: null }, 60, 60);
assert(okAt60.signal === false, 'with threshold=50, 60×60 un-flagged');
const flagAt40 = applyDimensionFlag({ signal: false, reason: null }, 40, 60);
assert(flagAt40.signal === true, 'with threshold=50, 40×60 flagged');
process.env.TRAIL_VISION_AUTO_FLAG_MIN_DIM = '80'; // reset

// 1g. Missing dimensions → no flag (defensive)
const noDims = applyDimensionFlag({ signal: false, reason: null });
assert(noDims.signal === false, 'undefined dimensions → no flag');

// 1h. Invalid env value falls back to default 80
process.env.TRAIL_VISION_AUTO_FLAG_MIN_DIM = 'banana';
const invalidEnv = applyDimensionFlag({ signal: false, reason: null }, 70, 70);
assert(invalidEnv.signal === true, 'invalid env value falls back to default 80, 70×70 flagged');
process.env.TRAIL_VISION_AUTO_FLAG_MIN_DIM = '80'; // reset

// ── 2. Integration via sweep-job ───────────────────────────────────────
console.log('\n[2] Sweep-job picks up dim-only rows (no description match)');
const REPO_ROOT_DB = join(homedir(), 'Apps/broberg/trail/data/trail.db');
const trail = await createLibsqlDatabase({ path: REPO_ROOT_DB });
await trail.runMigrations();

const tenant = await trail.db
  .select({ id: tenants.id })
  .from(tenants)
  .where(eq(tenants.slug, 'christian'))
  .get();
const hostDoc = await trail.db
  .select({ id: documents.id, knowledgeBaseId: documents.knowledgeBaseId })
  .from(documents)
  .where(and(eq(documents.tenantId, tenant!.id), eq(documents.kind, 'source')))
  .limit(1)
  .get();
const kbId = hostDoc!.knowledgeBaseId;

const PREFIX = `dim_dimsweep_${Date.now()}_`;
const seededIds: string[] = [];
async function seed(label: string, w: number, h: number, desc: string): Promise<string> {
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
      contentHash: `dim-${label}-${Date.now()}`,
      sizeBytes: 100,
      page: 1,
      width: w,
      height: h,
      visionDescription: desc,
      visionModel: 'verify-dim',
      visionAt: new Date().toISOString(),
      autoFlagSignal: 0,
      autoFlagReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
  seededIds.push(id);
  return id;
}

const idTiny = await seed('tiny', 62, 40, 'A clean diagram of something — text gives no flag.');
const idLargeClean = await seed('large-clean', 500, 500, 'Anatomical diagram of human foot.');
const idTextFlag = await seed('text-flagged', 500, 500, 'I am unable to make out the specific content.');

process.env.TRAIL_VISION_AUTO_FLAG_SWEEP = '1';
process.env.TRAIL_VISION_AUTO_FLAG_MIN_DIM = '80';
await sweepAutoFlag(trail);

const after = await trail.db
  .select()
  .from(documentImages)
  .where(inArray(documentImages.id, seededIds))
  .all();
const byId = new Map(after.map((r) => [r.id, r]));
const t1 = byId.get(idTiny);
const t2 = byId.get(idLargeClean);
const t3 = byId.get(idTextFlag);

assert(t1?.autoFlagSignal === 1, `tiny (62×40) flagged by sweep`);
assert(
  t1?.autoFlagReason === 'small-dimensions:62x40',
  `reason='small-dimensions:62x40' (got ${t1?.autoFlagReason})`,
);
assert(t2?.autoFlagSignal === 0, 'large-clean (500×500) NOT flagged');
assert(t3?.autoFlagSignal === 1, 'text-flagged (regex match) still flagged');
assert(
  t3?.autoFlagReason?.startsWith('regex:'),
  `text-flag reason still 'regex:<x>' (got ${t3?.autoFlagReason})`,
);

// ── Cleanup ────────────────────────────────────────────────────────────
console.log('\n[cleanup] removing seeded rows');
await trail.db
  .delete(documentImages)
  .where(inArray(documentImages.id, seededIds))
  .run();

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
await trail.close();
process.exit(failures === 0 ? 0 : 1);
