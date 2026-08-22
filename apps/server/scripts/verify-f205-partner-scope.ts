/**
 * F205.1 runtime proof — a `partner` API key is upload-only and confined to ONE
 * knowledge base.
 *
 * Why this script exists in this shape: the interesting half of an auth change
 * is what gets REFUSED. A probe that only shows the upload working would pass
 * just as happily on the unrestricted 'full' key this feature exists to stop
 * issuing — so most of the assertions below are negative ones, made with real
 * requests through the real middleware.
 *
 * Run: bun run apps/server/scripts/verify-f205-partner-scope.ts
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibsqlDatabase, apiKeys, users, tenants, knowledgeBases } from '@trail/db';
import { createApp } from '../src/app.js';
import type { TenantPool } from '../src/lib/tenant-pool.js';

const dir = mkdtempSync(join(tmpdir(), 'trail-f205-'));
const dbPath = join(dir, 'test.db');

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`); }
}

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
const newKey = () => `trail_${randomBytes(32).toString('hex')}`;

const trail = await createLibsqlDatabase({ path: dbPath });
await trail.runMigrations();

// ── 1. The migration's DDL actually landed ────────────────────────────────
// Drizzle recording a migration is not the same as the column existing.
const cols = await trail.db.run(`SELECT name FROM pragma_table_info('api_keys')`);
const colNames = (cols.rows ?? []).map((r: unknown) => (r as { name?: string }).name ?? (Array.isArray(r) ? r[0] : ''));
check('api_keys.kb_id column exists', colNames.includes('kb_id'), `saw: ${colNames.join(',')}`);

// ── Seed a tenant, a user and two knowledge bases ─────────────────────────
const now = new Date().toISOString();
await trail.db.insert(tenants).values({ id: 'ten1', slug: 'acme', name: 'Acme' }).run?.();
await trail.db.insert(users).values({ id: 'u1', tenantId: 'ten1', email: 'cb@webhouse.dk', role: 'admin' }).run?.();
await trail.db.insert(knowledgeBases).values({ id: 'kb-a', tenantId: 'ten1', slug: 'kb-a', name: 'KB A', createdBy: 'u1' }).run?.();
await trail.db.insert(knowledgeBases).values({ id: 'kb-b', tenantId: 'ten1', slug: 'kb-b', name: 'KB B', createdBy: 'u1' }).run?.();

// TenantPool is just a Map<slug, TrailDatabase>.
const pool: TenantPool = new Map([['acme', trail]]);
const app = createApp(trail, pool);

// A pre-existing 'full' key, inserted WITHOUT a scope exactly the way the old
// mint call did — this is the "existing keys are unaffected" control.
const fullRaw = newKey();
await trail.db.insert(apiKeys).values({
  id: 'k-full', tenantId: 'ten1', userId: 'u1', name: 'legacy', keyHash: hash(fullRaw), createdAt: now,
}).run?.();

const call = (path: string, key: string, method = 'GET') =>
  app.request(path, { method, headers: { authorization: `Bearer ${key}` } });

// ── 2. Mint a partner key through the REAL endpoint ───────────────────────
const mint = await app.request('/api/v1/api-keys', {
  method: 'POST',
  headers: { authorization: `Bearer ${fullRaw}`, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Acme Partner', scope: 'partner', kbId: 'kb-a' }),
});
const minted = (await mint.json()) as { key?: string; scope?: string; kbId?: string };
check('mint returns 201', mint.status === 201, `got ${mint.status}`);
const partnerRaw = minted.key ?? '';

// Read the row back with raw SQL — never trust the 201 body for a save.
const row = await trail.db.run(
  `SELECT scope, kb_id FROM api_keys WHERE key_hash = '${hash(partnerRaw)}'`,
);
const stored = (row.rows ?? [])[0] as Record<string, unknown> | undefined;
check('stored scope === "partner"', stored?.scope === 'partner', `saw ${JSON.stringify(stored)}`);
check('stored kb_id === "kb-a"', stored?.kb_id === 'kb-a', `saw ${JSON.stringify(stored)}`);

// A partner key without a KB must be refused, not silently widened.
const noKb = await app.request('/api/v1/api-keys', {
  method: 'POST',
  headers: { authorization: `Bearer ${fullRaw}`, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'bad', scope: 'partner' }),
});
check('partner key without kbId is refused (400)', noKb.status === 400, `got ${noKb.status}`);

// ── 3. THE NEGATIVE HALF — what the partner key must NOT reach ────────────
const refusals: Array<[string, string, string]> = [
  ['search',            '/api/v1/knowledge-bases/kb-a/search?q=x', 'GET'],
  ['neuron read',       '/api/v1/documents/doc-1/content',         'GET'],
  ['mint another key',  '/api/v1/api-keys',                   'POST'],
  ['queue candidates',  '/api/v1/queue/candidates',                'POST'],
  ['upload to any KB',  '/api/v1/knowledge-bases/kb-b/documents/upload', 'POST'],
  ['list knowledge bases', '/api/v1/knowledge-bases',              'GET'],
];
for (const [label, path, method] of refusals) {
  const res = await call(path, partnerRaw, method);
  check(`partner key REFUSED on ${label}`, res.status === 403, `got ${res.status}`);
}

// ── 4. And what it MUST reach (the endpoint itself lands in F205.2) ───────
// Until F205.2 exists this proves the gate lets the path through rather than
// 403-ing it; a 404 from the router is the correct "allowed, not implemented".
const allowed = await call('/api/v1/partner/sources', partnerRaw, 'POST');
check('partner key ALLOWED past the scope gate on its own upload path',
  allowed.status !== 403, `got ${allowed.status}`);

// ── 5. Existing keys are unaffected (no naked cutover) ────────────────────
const legacy = await call('/api/v1/knowledge-bases', fullRaw, 'GET');
check('pre-existing scope-less key still works', legacy.status !== 403, `got ${legacy.status}`);

await trail.close();
rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
