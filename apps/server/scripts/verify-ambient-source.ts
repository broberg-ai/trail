/**
 * F201.13 Phase 1 proof — ambient raw material persists as a first-class Source,
 * end-to-end through the REAL route (createApp → POST .../ambient-source →
 * createAmbientSource → documents row).
 *
 * Proves:
 *   AC1 — the source persists as kind='source' with the ambient fileType AND
 *         appears in the admin Sources list (GET .../documents?kind=source).
 *   AC2 — the raw is preserved VERBATIM: the stored content equals the POSTed
 *         content byte-for-byte (distill is NOT applied to the source body).
 *   ship-dark — with TRAIL_AMBIENT_SOURCES unset the endpoint 404s (inert in prod
 *         until armed).
 *
 * Run from apps/server:  bun run scripts/verify-ambient-source.ts
 */
process.env.TRAIL_AMBIENT_SOURCES = '1'; // arm the ship-dark flag for the happy path
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, documents } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';

const T = 't-f20113', U = 'u-f20113', KB = 'kb-f20113', KB_SLUG = 'ambient13';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f20113-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await trail.db.insert(tenants).values({ id: T, slug: 'f20113', name: 'F20113', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f20113@local.trail', displayName: 'F20113', role: 'owner', onboarded: true }).run();
await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Ambient', slug: 'ambient13', language: 'da' }).run();
await trail.db.insert(sessions).values({ id: 'sess-f20113', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();

const app = createApp(trail, new Map([['f20113', trail]]));
const req = (path: string, init: RequestInit = {}) => app.request(`http://engine.local${path}`, init);
const authed = { 'Content-Type': 'application/json', Cookie: 'session=sess-f20113' };

// A verbatim dictation with Danish + a specific name + punctuation — anything the
// distill would have rewritten must survive untouched on the source.
const RAW = 'Så Lars skal nok ind i ordbogen, og vi committer det hele nu.';

const res = await req(`/api/v1/knowledge-bases/${KB_SLUG}/ambient-source`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ fileType: 'ambient-speech', content: RAW, source: 'audio', rawTranscript: RAW }),
});
check('endpoint returns 201', res.status === 201, `status ${res.status}`);
const created: { id?: string } = res.status === 201 ? await res.json() : {};

const row = created.id ? await trail.db.select().from(documents).where(eq(documents.id, created.id)).get() : null;
check('AC1 persisted kind=source', row?.kind === 'source', `kind=${row?.kind}`);
check('AC1 fileType=ambient-speech', row?.fileType === 'ambient-speech', `fileType=${row?.fileType}`);
check('AC2 content VERBATIM (byte-for-byte)', row?.content === RAW, JSON.stringify(row?.content));
check('rawTranscript kept in metadata', !!row?.metadata && JSON.parse(row.metadata).rawTranscript === RAW);

// AC1 — appears in the admin Sources list filtered by kind=source.
const listRes = await req(`/api/v1/knowledge-bases/${KB_SLUG}/documents?kind=source`, { headers: authed });
const list = await listRes.json();
const docs: Array<{ id: string; fileType?: string }> = Array.isArray(list) ? list : (list?.documents ?? []);
check('AC1 appears in Sources list (kind=source)', docs.some((d) => d.id === created.id && d.fileType === 'ambient-speech'));

// ship-dark — flag off → 404 (endpoint invisible in prod until armed).
delete process.env.TRAIL_AMBIENT_SOURCES;
const darkRes = await req(`/api/v1/knowledge-bases/${KB_SLUG}/ambient-source`, {
  method: 'POST', headers: authed, body: JSON.stringify({ fileType: 'ambient-speech', content: 'x' }),
});
check('ship-dark: 404 when flag off', darkRes.status === 404, `status ${darkRes.status}`);
process.env.TRAIL_AMBIENT_SOURCES = '1';

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
