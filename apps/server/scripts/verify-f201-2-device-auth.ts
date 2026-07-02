/**
 * F201.2 runtime proof — ambient device-auth against the REAL engine app.
 *
 * Boots createApp() on a temp DB and drives the full flow over the real
 * HTTP routes (Hono app.request, no port): ship-dark 404 → approve with a
 * session cookie → single-use token exchange (200 → 410) → the minted
 * 'ambient'-scoped key CAN post a candidate + search but gets 403 on an
 * admin endpoint → expired code → 410. Also proves the token never
 * appears in any URL (POST body only).
 *
 * Run from apps/server:  bun run scripts/verify-f201-2-device-auth.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, apiKeys, ambientDeviceCodes } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';

const T = 't-f201b', U = 'u-f201b', KB = 'kb-f201b';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f201b-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await trail.db.insert(tenants).values({ id: T, slug: 'f201b', name: 'F201b', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f201b@local.trail', displayName: 'F201b', role: 'owner', onboarded: true }).run();
await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Ambient', slug: 'ambient-b', language: 'da' }).run();
await trail.db.insert(sessions).values({ id: 'sess-f201b', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();

const app = createApp(trail, new Map([['f201b', trail]]));
const req = (path: string, init: RequestInit = {}) => app.request(`http://engine.local${path}`, init);
const json = { 'Content-Type': 'application/json' };
const cookie = { ...json, Cookie: 'session=sess-f201b' };

const code = randomBytes(32).toString('hex');

// ── Ship-dark: env flag unset → both endpoints 404 ─────────────────────
delete process.env.TRAIL_AMBIENT_AUTH;
const darkApprove = await req('/api/v1/ambient/approve', { method: 'POST', headers: cookie, body: JSON.stringify({ code, deviceName: 'MBP', kbIds: [KB] }) });
const darkToken = await req('/api/v1/ambient/token', { method: 'POST', headers: json, body: JSON.stringify({ code }) });
check('ship-dark: approve → 404 with TRAIL_AMBIENT_AUTH unset', darkApprove.status === 404, `status=${darkApprove.status}`);
check('ship-dark: token → 404 with TRAIL_AMBIENT_AUTH unset', darkToken.status === 404, `status=${darkToken.status}`);

// ── Enable + approve (session-cookie auth, as the admin page does) ─────
process.env.TRAIL_AMBIENT_AUTH = '1';
const noAuth = await req('/api/v1/ambient/approve', { method: 'POST', headers: json, body: JSON.stringify({ code, deviceName: 'MBP', kbIds: [KB] }) });
check('approve without login → 401', noAuth.status === 401, `status=${noAuth.status}`);

const approve = await req('/api/v1/ambient/approve', { method: 'POST', headers: cookie, body: JSON.stringify({ code, deviceName: "Christians MacBook", kbIds: [KB] }) });
check('approve with session cookie → 201', approve.status === 201, `status=${approve.status} ${await approve.clone().text()}`);

const keyRow = await trail.db.select().from(apiKeys).where(eq(apiKeys.scope, 'ambient')).get();
check("minted key has scope='ambient'", !!keyRow, keyRow?.name ?? '');

// ── Exchange: unknown → 404, real → 200 once, replay → 410 ─────────────
const bogus = await req('/api/v1/ambient/token', { method: 'POST', headers: json, body: JSON.stringify({ code: '0'.repeat(64) }) });
check('unknown code → 404', bogus.status === 404, `status=${bogus.status}`);

const claim = await req('/api/v1/ambient/token', { method: 'POST', headers: json, body: JSON.stringify({ code }) });
const claimBody = (await claim.json()) as { token?: string; kbIds?: string[] };
check('exchange → 200 with trail_ token + granted kbIds', claim.status === 200 && !!claimBody.token?.startsWith('trail_') && claimBody.kbIds?.[0] === KB, `status=${claim.status}`);

const replay = await req('/api/v1/ambient/token', { method: 'POST', headers: json, body: JSON.stringify({ code }) });
check('replayed exchange → 410 (single-use)', replay.status === 410, `status=${replay.status}`);

const scrubbed = await trail.db.select({ t: ambientDeviceCodes.tokenOnce }).from(ambientDeviceCodes).all();
check('raw token scrubbed from DB after claim', scrubbed.every((r) => r.t === null));

// ── Scope enforcement with the claimed token ───────────────────────────
const token = claimBody.token!;
const bearer = { ...json, Authorization: `Bearer ${token}` };
const cand = await req('/api/v1/queue/candidates', {
  method: 'POST', headers: bearer,
  // slug, not raw id — the test id 'kb-f201b' is not UUID-shaped, so the
  // F135 resolver would treat it as a (wrong) slug and 404.
  body: JSON.stringify({ knowledgeBaseId: 'ambient-b', kind: 'external-feed', title: 'Ambient probe', content: 'Aftalt: device-auth-flowet virker end-to-end.', metadata: JSON.stringify({ connector: 'trail-ambient-capture' }) }),
});
check('ambient token CAN post a queue candidate (201)', cand.status === 201, `status=${cand.status}`);

const search = await req(`/api/v1/knowledge-bases/ambient-b/search?q=device`, { headers: bearer });
check('ambient token CAN search (200)', search.status === 200, `status=${search.status}`);

const denied = await req('/api/v1/api-keys', { headers: bearer });
check('ambient token gets 403 on an admin endpoint (/api-keys)', denied.status === 403, `status=${denied.status}`);

const deniedKb = await req('/api/v1/knowledge-bases', { headers: bearer });
check('ambient token gets 403 on KB admin list', deniedKb.status === 403, `status=${deniedKb.status}`);

// ── Expiry: approved but stale → 410 ───────────────────────────────────
const code2 = randomBytes(32).toString('hex');
await req('/api/v1/ambient/approve', { method: 'POST', headers: cookie, body: JSON.stringify({ code: code2, deviceName: 'Stale', kbIds: [KB] }) });
await trail.db.update(ambientDeviceCodes).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(ambientDeviceCodes.deviceName, 'Stale'));
const stale = await req('/api/v1/ambient/token', { method: 'POST', headers: json, body: JSON.stringify({ code: code2 }) });
check('expired code → 410', stale.status === 410, `status=${stale.status}`);

// ── Regression guard: a 'full'-scope key is unrestricted as before ─────
const fullRaw = `trail_${randomBytes(32).toString('hex')}`;
await trail.db.insert(apiKeys).values({ id: 'key-full', tenantId: T, userId: U, name: 'full', keyHash: createHash('sha256').update(fullRaw).digest('hex') }).run();
const fullList = await req('/api/v1/api-keys', { headers: { ...json, Authorization: `Bearer ${fullRaw}` } });
check("existing 'full'-scope keys unaffected (200 on /api-keys)", fullList.status === 200, `status=${fullList.status}`);

console.log(`\n${pass} pass, ${fail} fail`);
try { rmSync(DB_PATH, { force: true }); } catch { /* leave for inspection */ }
process.exit(fail === 0 ? 0 : 1);
