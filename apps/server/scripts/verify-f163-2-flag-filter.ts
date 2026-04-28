/**
 * F163.2 Phase 3 — verify ?flag=any|auto|user|none endpoint filter.
 *
 * Seeds 5 throwaway image-rows with mixed auto/user flags, then asserts
 * each filter mode returns the correct subset. Cleanup removes all
 * seeded rows on exit.
 *
 * Filter matrix:
 *   img-1: neither flag        → only matches none, any-not-flagged
 *   img-2: auto only           → matches any, auto
 *   img-3: user (curator) only → matches any, user
 *   img-4: both                → matches any, auto, user
 *   img-5: neither flag        → only matches none, any-not-flagged
 *
 * Pre-reqs: engine running, t-christian + at least one source-doc.
 *
 * Run: `cd apps/server && bun run scripts/verify-f163-2-flag-filter.ts`
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { eq, and, inArray } from 'drizzle-orm';
import {
  createLibsqlDatabase,
  documents,
  documentImages,
  knowledgeBases,
  tenants,
  users,
  visionQualityRatings,
} from '@trail/db';

const REPO_ROOT_DB = join(homedir(), 'Apps/broberg/trail/data/trail.db');
const TRAIL_BASE = process.env.TRAIL_TEST_BASE ?? 'http://127.0.0.1:58021';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log(`\n=== F163.2 Phase 3 verify (flag-filter endpoint) ===\n`);

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
const user = await trail.db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.tenantId, tenant.id))
  .get();
if (!user) {
  console.log('  ✗ user for t-christian missing');
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
const kb = await trail.db
  .select({ slug: knowledgeBases.slug })
  .from(knowledgeBases)
  .where(eq(knowledgeBases.id, kbId))
  .get();
const kbSlug = kb?.slug ?? kbId;
console.log(`  → host: kb=${kbSlug} doc=${hostDoc.id.slice(0, 8)}…`);

const PREFIX = `dim_f1632_${Date.now()}_`;
const seededIds: string[] = [];

async function seed(label: string, autoFlag: 0 | 1, autoReason: string | null): Promise<string> {
  const id = `${PREFIX}${label}`;
  const filename = `verify-f163-2-${label}.png`;
  await trail.db
    .insert(documentImages)
    .values({
      id,
      documentId: hostDoc!.id,
      tenantId: tenant!.id,
      knowledgeBaseId: kbId,
      filename,
      storagePath: `${tenant!.id}/${kbId}/${hostDoc!.id}/images/${filename}`,
      contentHash: `verify-${label}-${Date.now()}`,
      sizeBytes: 100,
      page: 1,
      width: 10,
      height: 10,
      visionDescription: `verify ${label}`,
      visionModel: 'verify',
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

console.log('[1] Seed 5 image-rows with mixed flag-state');
const id1 = await seed('1-neither', 0, null);
const id2 = await seed('2-auto-only', 1, 'vision-prompt-low');
const id3 = await seed('3-user-only', 0, null);
const id4 = await seed('4-both', 1, 'regex:too-small-and-unclear');
const id5 = await seed('5-neither', 0, null);
assert(seededIds.length === 5, '5 rows seeded');

// Insert curator-down rating for img-3 + img-4
const now = new Date().toISOString();
for (const id of [id3, id4]) {
  await trail.db
    .insert(visionQualityRatings)
    .values({
      id: `vqr_verify_${id}`,
      imageId: id,
      userId: user.id,
      tenantId: tenant.id,
      rating: 'down',
      model: 'verify',
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

const headers = { Cookie: 'session=dev' };
const url = (flag?: string) =>
  `${TRAIL_BASE}/api/v1/knowledge-bases/${encodeURIComponent(kbSlug)}/images?audience=curator&limit=200${flag ? `&flag=${flag}` : ''}`;

async function fetchIds(flag?: string): Promise<Set<string>> {
  const r = await fetch(url(flag), { headers });
  const body = (await r.json()) as { hits?: Array<{ id: string }> };
  return new Set((body.hits ?? []).map((h) => h.id));
}

// ── 2. flag=any returns img-2,3,4 ──────────────────────────────────────
console.log('\n[2] ?flag=any returns auto OR user-flagged');
const anySet = await fetchIds('any');
assert(anySet.has(id2), 'img-2 (auto-only) in any');
assert(anySet.has(id3), 'img-3 (user-only) in any');
assert(anySet.has(id4), 'img-4 (both) in any');
assert(!anySet.has(id1), 'img-1 (neither) NOT in any');
assert(!anySet.has(id5), 'img-5 (neither) NOT in any');

// ── 3. flag=auto returns img-2,4 only ──────────────────────────────────
console.log('\n[3] ?flag=auto returns auto-only');
const autoSet = await fetchIds('auto');
assert(autoSet.has(id2), 'img-2 in auto');
assert(autoSet.has(id4), 'img-4 in auto');
assert(!autoSet.has(id3), 'img-3 (user-only) NOT in auto');
assert(!autoSet.has(id1) && !autoSet.has(id5), 'unflagged NOT in auto');

// ── 4. flag=user returns img-3,4 only ──────────────────────────────────
console.log('\n[4] ?flag=user returns curator-only');
const userSet = await fetchIds('user');
assert(userSet.has(id3), 'img-3 in user');
assert(userSet.has(id4), 'img-4 in user');
assert(!userSet.has(id2), 'img-2 (auto-only) NOT in user');
assert(!userSet.has(id1) && !userSet.has(id5), 'unflagged NOT in user');

// ── 5. flag=none returns img-1,5 ───────────────────────────────────────
console.log('\n[5] ?flag=none returns neither-flagged');
const noneSet = await fetchIds('none');
assert(noneSet.has(id1), 'img-1 in none');
assert(noneSet.has(id5), 'img-5 in none');
assert(!noneSet.has(id2) && !noneSet.has(id3) && !noneSet.has(id4), 'flagged rows NOT in none');

// ── 6. No flag-param returns all ───────────────────────────────────────
console.log('\n[6] No flag-param returns all 5 + their parents on the page');
const allSet = await fetchIds();
for (const id of seededIds) {
  assert(allSet.has(id), `${id.slice(-15)} present without filter`);
}

// ── 7. autoFlagSignal + userFlagged exposed on hit ─────────────────────
console.log('\n[7] Each hit exposes autoFlagSignal + autoFlagReason + userFlagged');
const r7 = await fetch(url(), { headers });
const body7 = (await r7.json()) as {
  hits?: Array<{ id: string; autoFlagSignal?: boolean; autoFlagReason?: string | null; userFlagged?: boolean }>;
};
const hitMap = new Map((body7.hits ?? []).map((h) => [h.id, h]));
const hit2 = hitMap.get(id2);
const hit4 = hitMap.get(id4);
assert(hit2?.autoFlagSignal === true, 'img-2 hit.autoFlagSignal=true');
assert(hit2?.autoFlagReason === 'vision-prompt-low', `img-2 reason='vision-prompt-low' (got ${hit2?.autoFlagReason})`);
assert(hit2?.userFlagged === false, 'img-2 hit.userFlagged=false');
assert(hit4?.autoFlagSignal === true && hit4?.userFlagged === true, 'img-4 has both signals');

// ── Cleanup ────────────────────────────────────────────────────────────
console.log('\n[cleanup] removing seeded rows');
await trail.db
  .delete(documentImages)
  .where(inArray(documentImages.id, seededIds))
  .run();

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
await trail.close();
process.exit(failures === 0 ? 0 : 1);
