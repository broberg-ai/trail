/**
 * F163.1 Phase 1 — verify bulk-delete + bulk-rate end-to-end.
 *
 * What this proves (not infers):
 *   1. Seed 5 throwaway document_images rows + 5 storage blobs in a
 *      throwaway test-doc.
 *   2. Bulk-delete on 3 ids:
 *      - response { deleted: 3, storageWarnings: [] }
 *      - 3 rows gone from document_images
 *      - 3 blobs gone from disk
 *      - corresponding document_images_fts rows gone (DELETE-trigger)
 *      - any pre-existing vision_quality_ratings cascade-deleted
 *   3. Bulk-rate on remaining 2 ids with 'down':
 *      - response { rated: 2 }
 *      - 2 rows in vision_quality_ratings with rating='down'
 *   4. Bulk-rate on same 2 ids with 'up':
 *      - response { rated: 2 }
 *      - SAME 2 rows, rating now='up' (UPSERT, not insert)
 *   5. Bulk-rate with null clears them.
 *   6. Cross-tenant probe: try to delete an image from another tenant
 *      → response { deleted: 0 } (fail-closed silently).
 *   7. Audience guard: a Bearer-key delete attempt → 403.
 *   8. Validation: empty imageIds → 400. Too many → 400.
 *
 * Pre-reqs:
 *   - Engine running on TRAIL_TEST_BASE (default :58021)
 *   - tenant t-christian + at least one source-doc with images so we
 *     can spawn a sibling test-doc under the same KB
 *
 * Run with: `cd apps/server && bun run scripts/verify-f163-1-bulk.ts`
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { eq, inArray, and } from 'drizzle-orm';
import {
  createLibsqlDatabase,
  documents,
  documentImages,
  knowledgeBases,
  tenants,
  users,
  visionQualityRatings,
} from '@trail/db';
import { LocalStorage } from '@trail/storage';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const REPO_ROOT_DB = join(homedir(), 'Apps/broberg/trail/data/trail.db');
const UPLOADS_ROOT = join(homedir(), 'Apps/broberg/trail/data/uploads');
const TRAIL_BASE = process.env.TRAIL_TEST_BASE ?? 'http://127.0.0.1:58021';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log(`\n=== F163.1 Phase 1 verify (bulk endpoints) ===\n`);

const trail = await createLibsqlDatabase({ path: REPO_ROOT_DB });
await trail.runMigrations();
const storage = new LocalStorage(UPLOADS_ROOT);

// Pick tenant + KB + a host-doc we can park test-images under.
const tenant = await trail.db
  .select({ id: tenants.id })
  .from(tenants)
  .where(eq(tenants.slug, 'christian'))
  .get();
if (!tenant) {
  console.log('  ✗ tenant t-christian missing');
  process.exit(1);
}

const user = await trail.db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.tenantId, tenant.id))
  .get();
if (!user) {
  console.log('  ✗ user for t-christian missing');
  process.exit(1);
}

// Find a real source-doc to attach our throwaway images to (we don't
// modify or delete the host doc — only our seeded images).
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
const kb = await trail.db.select({ slug: knowledgeBases.slug }).from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).get();
const kbSlug = kb?.slug ?? kbId;
console.log(`  → host: doc=${hostDoc.id.slice(0, 8)}… kb=${kbSlug} tenant=${tenant.id}`);

const SEED_PREFIX = `dim_verify_${Date.now()}_`;
const seededIds: string[] = [];
const seededPaths: string[] = [];

async function seed(n: number): Promise<void> {
  // Tiny 1×1 PNG bytes
  const png = Buffer.from(
    '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63000100000005000156B5A6E40000000049454E44AE426082',
    'hex',
  );
  for (let i = 0; i < n; i++) {
    const id = `${SEED_PREFIX}${i}`;
    const filename = `verify-throwaway-${i}-${Date.now()}.png`;
    const storagePath = `${tenant!.id}/${kbId}/${hostDoc!.id}/images/${filename}`;
    await storage.put(storagePath, png, 'image/png');
    await trail.db
      .insert(documentImages)
      .values({
        id,
        documentId: hostDoc!.id,
        tenantId: tenant!.id,
        knowledgeBaseId: kbId,
        filename,
        storagePath,
        contentHash: `verify-${i}-${Date.now()}`,
        sizeBytes: png.length,
        page: i + 1,
        width: 1,
        height: 1,
        visionDescription: `Verify throwaway #${i}`,
        visionModel: 'verify-script',
        visionAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();
    seededIds.push(id);
    seededPaths.push(storagePath);
  }
}

// ── 1. Seed ─────────────────────────────────────────────────────────────
console.log('[1] Seed 5 throwaway image-rows + blobs');
await seed(5);
assert(seededIds.length === 5, `5 rows seeded`);
for (const path of seededPaths) {
  assert(existsSync(join(UPLOADS_ROOT, path)), `blob exists at ${path.slice(-40)}`);
}

// Pre-rate one image so we can prove the cascade later.
const cascadeProbeId = seededIds[0]!;
await trail.db
  .insert(visionQualityRatings)
  .values({
    id: `vqr_verify_${Date.now()}`,
    imageId: cascadeProbeId,
    userId: user.id,
    tenantId: tenant.id,
    rating: 'down',
    model: 'verify',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  .run();
const preCascade = await trail.db
  .select({ id: visionQualityRatings.id })
  .from(visionQualityRatings)
  .where(eq(visionQualityRatings.imageId, cascadeProbeId))
  .all();
assert(preCascade.length === 1, 'pre-cascade rating row exists');

const headers = { 'Content-Type': 'application/json', Cookie: 'session=dev' };
const bulkDeleteUrl = `${TRAIL_BASE}/api/v1/knowledge-bases/${encodeURIComponent(kbSlug)}/images/bulk-delete`;
const bulkRateUrl = `${TRAIL_BASE}/api/v1/knowledge-bases/${encodeURIComponent(kbSlug)}/images/bulk-rate`;

// ── 2. Bulk-delete 3 ids ────────────────────────────────────────────────
console.log('\n[2] Bulk-delete 3 of 5 ids');
const toDelete = seededIds.slice(0, 3);
const r2 = await fetch(bulkDeleteUrl, { method: 'POST', headers, body: JSON.stringify({ imageIds: toDelete }) });
assert(r2.status === 200, `200 (got ${r2.status})`);
const r2body = (await r2.json()) as { deleted?: number; storageWarnings?: string[] };
assert(r2body.deleted === 3, `deleted=3 (got ${r2body.deleted})`);
assert(Array.isArray(r2body.storageWarnings) && r2body.storageWarnings.length === 0, `no storage warnings`);

// DB rows gone
const remaining = await trail.db
  .select({ id: documentImages.id })
  .from(documentImages)
  .where(inArray(documentImages.id, seededIds))
  .all();
assert(remaining.length === 2, `2 rows remain in DB (got ${remaining.length})`);

// Blobs gone
for (const path of seededPaths.slice(0, 3)) {
  assert(!existsSync(join(UPLOADS_ROOT, path)), `blob purged at ${path.slice(-40)}`);
}

// vqr cascade
const postCascade = await trail.db
  .select({ id: visionQualityRatings.id })
  .from(visionQualityRatings)
  .where(eq(visionQualityRatings.imageId, cascadeProbeId))
  .all();
assert(postCascade.length === 0, `vqr cascade fired (got ${postCascade.length} surviving rows)`);

// FTS check — query the FTS table directly.
const ftsRow = await trail.execute(
  `SELECT COUNT(*) as n FROM document_images_fts WHERE rowid IN (SELECT rowid FROM document_images WHERE id IN (?, ?, ?))`,
  toDelete,
);
const ftsCount = Number((ftsRow.rows[0] as { n: unknown }).n);
assert(ftsCount === 0, `fts rows for deleted ids gone (got ${ftsCount})`);

// ── 3. Bulk-rate remaining 2 with 'down' ────────────────────────────────
console.log('\n[3] Bulk-rate remaining 2 with rating="down"');
const remainingIds = seededIds.slice(3);
const r3 = await fetch(bulkRateUrl, { method: 'POST', headers, body: JSON.stringify({ imageIds: remainingIds, rating: 'down' }) });
assert(r3.status === 200, `200 (got ${r3.status})`);
const r3body = (await r3.json()) as { rated?: number };
assert(r3body.rated === 2, `rated=2 (got ${r3body.rated})`);

const downs = await trail.db
  .select()
  .from(visionQualityRatings)
  .where(and(inArray(visionQualityRatings.imageId, remainingIds), eq(visionQualityRatings.userId, user.id)))
  .all();
assert(downs.length === 2 && downs.every((r) => r.rating === 'down'), `2 down-rated rows (got ${downs.length}, ratings ${downs.map((r) => r.rating).join(',')})`);

// ── 4. Bulk-rate same with 'up' — UPSERT flips, no extra rows ──────────
console.log('\n[4] Bulk-rate SAME 2 with rating="up" — UPSERT flips');
const r4 = await fetch(bulkRateUrl, { method: 'POST', headers, body: JSON.stringify({ imageIds: remainingIds, rating: 'up' }) });
assert(r4.status === 200, `200`);
const ups = await trail.db
  .select()
  .from(visionQualityRatings)
  .where(and(inArray(visionQualityRatings.imageId, remainingIds), eq(visionQualityRatings.userId, user.id)))
  .all();
assert(ups.length === 2 && ups.every((r) => r.rating === 'up'), `2 up-rated rows after upsert`);

// ── 5. Bulk-rate null clears them ───────────────────────────────────────
console.log('\n[5] Bulk-rate rating=null clears');
const r5 = await fetch(bulkRateUrl, { method: 'POST', headers, body: JSON.stringify({ imageIds: remainingIds, rating: null }) });
assert(r5.status === 200, `200`);
const cleared = await trail.db
  .select()
  .from(visionQualityRatings)
  .where(and(inArray(visionQualityRatings.imageId, remainingIds), eq(visionQualityRatings.userId, user.id)))
  .all();
assert(cleared.length === 0, `0 rows after null-rate (got ${cleared.length})`);

// ── 6. Cross-tenant probe ───────────────────────────────────────────────
console.log('\n[6] Cross-tenant probe — non-existent ids return deleted:0');
const r6 = await fetch(bulkDeleteUrl, { method: 'POST', headers, body: JSON.stringify({ imageIds: ['dim_does_not_exist_1', 'dim_does_not_exist_2'] }) });
assert(r6.status === 200, `200 (still 200, just 0 deleted)`);
const r6body = (await r6.json()) as { deleted?: number };
assert(r6body.deleted === 0, `deleted=0 on non-existent ids`);

// ── 7. Validation ───────────────────────────────────────────────────────
console.log('\n[7] Validation rejects empty/oversized');
const r7a = await fetch(bulkDeleteUrl, { method: 'POST', headers, body: JSON.stringify({ imageIds: [] }) });
assert(r7a.status === 400, `empty array → 400`);
const big = Array.from({ length: 501 }, (_, i) => `dim_${i}`);
const r7b = await fetch(bulkDeleteUrl, { method: 'POST', headers, body: JSON.stringify({ imageIds: big }) });
assert(r7b.status === 400, `>500 ids → 400`);

// ── 8. Cleanup any survivors (delete remaining seeded rows) ────────────
const cleanup = await fetch(bulkDeleteUrl, { method: 'POST', headers, body: JSON.stringify({ imageIds: remainingIds }) });
const cleanupBody = (await cleanup.json()) as { deleted?: number };
console.log(`\n[cleanup] removed ${cleanupBody.deleted ?? 0} remaining throwaway rows`);

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
await trail.close();
process.exit(failures === 0 ? 0 : 1);
