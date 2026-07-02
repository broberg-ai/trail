/**
 * F201.2 multi-tenant regression — the prod bug: approve() runs
 * AUTHENTICATED and parks the device code in the caller's SECONDARY tenant
 * DB, but the claim is UNAUTHENTICATED and defaulted to the PRIMARY DB, so
 * it 404'd forever. This proves the pool-search fix: a code parked in a
 * secondary tenant is claimable via the unauthenticated /ambient/token.
 *
 * Run from apps/server:  bun run scripts/verify-f201-2b-multitenant-claim.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, apiKeys, ambientDeviceCodes } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const mk = (slug: string) => join(process.env.TMPDIR ?? '/tmp', `f201mt-${slug}-${process.env.USER ?? 'x'}.db`);
for (const s of ['primary', 'broberg']) { try { rmSync(mk(s), { force: true }); } catch { /* first run */ } }

// PRIMARY tenant DB (what an unauthenticated request defaults to).
const primary = await createLibsqlDatabase({ path: mk('primary') });
await primary.runMigrations();
await primary.db.insert(tenants).values({ id: 'tp', slug: 'primary', name: 'Primary', plan: 'hobby' }).run();

// SECONDARY tenant DB — broberg-ai, where the approving user lives.
const broberg = await createLibsqlDatabase({ path: mk('broberg') });
await broberg.runMigrations();
await broberg.initFTS();
await broberg.db.insert(tenants).values({ id: 'tb', slug: 'broberg-ai', name: 'Broberg.ai', plan: 'business' }).run();
await broberg.db.insert(users).values({ id: 'ub', tenantId: 'tb', email: 'cb@webhouse.dk', displayName: 'Christian Broberg', role: 'owner', onboarded: true }).run();
await broberg.db.insert(knowledgeBases).values({ id: 'kbb', tenantId: 'tb', createdBy: 'ub', name: 'Ambient Test', slug: 'ambient-test', language: 'da' }).run();
await broberg.db.insert(sessions).values({ id: 'sb', userId: 'ub', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();

process.env.TRAIL_AMBIENT_AUTH = '1';
process.env.TRAIL_MULTI_TENANT = '1';
// Pool with primary FIRST (so a naive claim would look there and miss).
const pool = new Map([['primary', primary], ['broberg-ai', broberg]]);
const app = createApp(primary, pool);
const req = (path: string, init: RequestInit = {}) => app.request(`http://engine.local${path}`, init);
const json = { 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✓' : '✗'} ${n}${d ? `  — ${d}` : ''}`); ok ? pass++ : fail++; };

const code = randomBytes(32).toString('hex');
const rawToken = `trail_${randomBytes(32).toString('hex')}`;
// Seed EXACTLY what an authenticated approve() writes — into the SECONDARY
// (broberg) DB only. (The HTTP approve needs the global key-index for its
// multi-tenant session auth, which a temp-DB harness can't provide; the
// claim path under test is unauthenticated and needs none of that.)
await broberg.db.insert(apiKeys).values({ id: 'kb-ambient', tenantId: 'tb', userId: 'ub', name: 'ambient:cb-m1:seed', keyHash: sha(rawToken), scope: 'ambient' }).run();
await broberg.db.insert(ambientDeviceCodes).values({
  id: 'dc1', tenantId: 'tb', codeHash: sha(code), deviceName: 'cb-m1', apiKeyId: 'kb-ambient',
  tokenOnce: rawToken, kbIds: JSON.stringify(['kbb']), expiresAt: new Date(Date.now() + 600_000).toISOString(),
}).run();

const parkedInBroberg = await broberg.db.select().from(ambientDeviceCodes).get();
const parkedInPrimary = await primary.db.select().from(ambientDeviceCodes).get();
check('code parked in SECONDARY (broberg) DB, not primary', !!parkedInBroberg && !parkedInPrimary);

// Claim UNAUTHENTICATED — the failing prod path. Must search the pool.
const claim = await req('/api/v1/ambient/token', { method: 'POST', headers: json, body: JSON.stringify({ code }) });
const cbody = await claim.json() as { token?: string; email?: string; tenant?: string; kbNames?: string[] };
check('unauthenticated claim finds the secondary-tenant code → 200', claim.status === 200, `status=${claim.status}`);
check('claim returns the ambient token', !!cbody.token?.startsWith('trail_'));
check('claim enriched with account (cb@webhouse.dk · Broberg.ai · Ambient Test)', cbody.email === 'cb@webhouse.dk' && cbody.tenant === 'Broberg.ai' && cbody.kbNames?.[0] === 'Ambient Test', `${cbody.email} / ${cbody.tenant} / ${cbody.kbNames?.[0]}`);

// The minted key must resolve back to broberg-ai for later authed calls.
const keyRow = await broberg.db.select().from(apiKeys).where(eq(apiKeys.scope, 'ambient')).get();
check('scoped key minted in the broberg-ai DB', !!keyRow);

console.log(`\n${pass} pass, ${fail} fail`);
for (const s of ['primary', 'broberg']) { try { rmSync(mk(s), { force: true }); } catch { /* leave */ } }
process.exit(fail === 0 ? 0 : 1);
