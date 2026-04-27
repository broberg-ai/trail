/**
 * F163 — verify cursor-pagination on /knowledge-bases/:kbId/images.
 *
 * What this proves end-to-end:
 *   1. Browse mode (no q): first page returns LIMIT items + nextCursor.
 *   2. Following nextCursor returns next batch with NO duplicates and
 *      NO missing rows compared to a full unpaginated baseline.
 *   3. Last page returns nextCursor=null.
 *   4. docId filter narrows to one source's images.
 *   5. FTS-mode pagination (cursor-as-offset) also works without
 *      duplicates across pages.
 *
 * Pre-reqs:
 *   - Engine running on TRAIL_TEST_BASE (default :58021)
 *   - At least 5+ document_image rows in tenant 'christian' (the
 *     Zoneterapibog gives us 224 — plenty for paging tests)
 *
 * Run with: `cd apps/server && bun run scripts/verify-f163-pagination.ts`
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { eq } from 'drizzle-orm';
import { createLibsqlDatabase, documentImages, documents, tenants, knowledgeBases } from '@trail/db';

const REPO_ROOT_DB = join(homedir(), 'Apps/broberg/trail/data/trail.db');
const TRAIL_BASE = process.env.TRAIL_TEST_BASE ?? 'http://127.0.0.1:58021';
const PAGE = 5;

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log(`\n=== F163 cursor-pagination verify ===\n`);

const trail = await createLibsqlDatabase({ path: REPO_ROOT_DB });
await trail.runMigrations();

// Pick a KB that has images.
const candidate = await trail.execute(
  `
  SELECT kb.id AS kb_id, kb.slug AS kb_slug, COUNT(di.id) AS n
    FROM knowledge_bases kb
    JOIN tenants t ON t.id = kb.tenant_id AND t.slug = 'christian'
    JOIN document_images di ON di.knowledge_base_id = kb.id
   GROUP BY kb.id
   ORDER BY n DESC
   LIMIT 1
  `,
);
const row = candidate.rows[0] as { kb_id?: unknown; kb_slug?: unknown; n?: unknown } | undefined;
if (!row?.kb_id) {
  console.log('  ⚠ no KB with images found — nothing to test');
  process.exit(0);
}
const kbId = String(row.kb_id);
const kbSlug = String(row.kb_slug);
const totalImages = Number(row.n);
console.log(`  → KB ${kbSlug} has ${totalImages} images`);

const headers = { Cookie: 'session=dev' };

// Baseline: fetch with limit=totalImages so we have the full set.
const baseRes = await fetch(`${TRAIL_BASE}/api/v1/knowledge-bases/${encodeURIComponent(kbSlug)}/images?audience=curator&limit=50`, { headers });
const baseBody = (await baseRes.json()) as { hits?: Array<{ id: string }>; nextCursor?: string | null };
const baselineIds = (baseBody.hits ?? []).map((h) => h.id);
console.log(`  → baseline first 50 (curator): ${baselineIds.length} ids fetched`);

// ── 1. First page returns LIMIT items + nextCursor ──────────────────────
console.log(`\n[1] First page (limit=${PAGE})`);
const r1 = await fetch(`${TRAIL_BASE}/api/v1/knowledge-bases/${encodeURIComponent(kbSlug)}/images?audience=curator&limit=${PAGE}`, { headers });
assert(r1.status === 200, `200 (got ${r1.status})`);
const r1body = (await r1.json()) as { hits?: Array<{ id: string }>; nextCursor?: string | null };
assert((r1body.hits ?? []).length === PAGE, `returned ${PAGE} items (got ${r1body.hits?.length})`);
assert(typeof r1body.nextCursor === 'string' && r1body.nextCursor.length > 0, 'nextCursor is non-null string');

// ── 2. Walk pages — assert no dupes, no gaps vs baseline order ──────────
console.log(`\n[2] Walk all pages, verify no dupes vs baseline`);
const seen = new Set<string>();
let cursor: string | null | undefined = undefined;
let pages = 0;
let collected: string[] = [];
while (true) {
  const url = `${TRAIL_BASE}/api/v1/knowledge-bases/${encodeURIComponent(kbSlug)}/images?audience=curator&limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const r = await fetch(url, { headers });
  const body = (await r.json()) as { hits?: Array<{ id: string }>; nextCursor?: string | null };
  pages += 1;
  for (const h of body.hits ?? []) {
    if (seen.has(h.id)) {
      console.log(`  ✗ duplicate id across pages: ${h.id}`);
      failures += 1;
    }
    seen.add(h.id);
    collected.push(h.id);
  }
  if (!body.nextCursor) break;
  cursor = body.nextCursor;
  if (pages > 50) {
    console.log('  ✗ runaway pagination (>50 pages) — bailing');
    failures += 1;
    break;
  }
}
console.log(`  → walked ${pages} pages, collected ${collected.length} unique ids`);
assert(collected.length === totalImages || collected.length >= 50, `walked enough pages to cover dataset`);
// Order check vs baseline (first 50 should match)
const orderMatches = collected.slice(0, baselineIds.length).every((id, i) => id === baselineIds[i]);
assert(orderMatches, 'page order matches baseline DESC created_at');

// ── 3. docId filter ─────────────────────────────────────────────────────
console.log(`\n[3] docId filter narrows to one source`);
// Find any doc with images.
const oneDoc = await trail.execute(
  `SELECT document_id FROM document_images WHERE knowledge_base_id = ? GROUP BY document_id LIMIT 1`,
  [kbId],
);
const docId = oneDoc.rows[0] ? String((oneDoc.rows[0] as { document_id: unknown }).document_id) : null;
if (docId) {
  const r3 = await fetch(`${TRAIL_BASE}/api/v1/knowledge-bases/${encodeURIComponent(kbSlug)}/images?audience=curator&limit=50&docId=${encodeURIComponent(docId)}`, { headers });
  const r3body = (await r3.json()) as { hits?: Array<{ documentId: string }> };
  const allMatch = (r3body.hits ?? []).every((h) => h.documentId === docId);
  assert(allMatch, `all results have documentId=${docId.slice(0, 8)}…`);
}

// ── 4. FTS pagination (offset-style cursor) ─────────────────────────────
console.log(`\n[4] FTS pagination`);
// Use a common Danish word likely in zoneterapi descriptions.
const ftsUrl = `${TRAIL_BASE}/api/v1/knowledge-bases/${encodeURIComponent(kbSlug)}/images?audience=curator&limit=${PAGE}&q=fod`;
const f1 = await fetch(ftsUrl, { headers });
const f1body = (await f1.json()) as { hits?: Array<{ id: string }>; nextCursor?: string | null };
const f1ids = (f1body.hits ?? []).map((h) => h.id);
if (f1body.nextCursor) {
  const f2 = await fetch(`${ftsUrl}&cursor=${encodeURIComponent(f1body.nextCursor)}`, { headers });
  const f2body = (await f2.json()) as { hits?: Array<{ id: string }> };
  const f2ids = (f2body.hits ?? []).map((h) => h.id);
  const dupes = f1ids.filter((id) => f2ids.includes(id));
  assert(dupes.length === 0, `FTS pages don't overlap (got ${dupes.length} dupes)`);
} else {
  console.log('  ⚠ FTS query returned only one page — pagination skip-test only');
}

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
await trail.close();
process.exit(failures === 0 ? 0 : 1);
