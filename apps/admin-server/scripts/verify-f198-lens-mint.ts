/**
 * F198 — verify Trail's Lens minter (the `createSession` callback for
 * @broberg/lens) against a throwaway control.db. The package's generic 80%
 * (bearer/503/TTL/storageState/rate-limit/never-cb) is covered by components'
 * own suite + the live e2e; this proves Trail's auth-specific 20%.
 *
 * Run: cd apps/admin-server && \
 *   rm -f /tmp/trail-f198-verify.db* && \
 *   TRAIL_ADMIN_CONTROL_DB=/tmp/trail-f198-verify.db bun run scripts/verify-f198-lens-mint.ts
 */
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';
import { mintLensCookie, isLensPrincipalSession, LENS_EMAIL } from '../src/lens-session.js';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log('\n=== F198 Lens minter verify ===\n');
await runMigrations();

// ── seed: org + broberg-ai tenant + a cb@ user with a session ───────────────
const ORG = 'org-bv';
const TENANT = 'tnt-bv';
await db.insert(schema.organizations).values({ id: ORG, slug: 'broberg-ai', name: 'broberg-ai' }).run();
await db
  .insert(schema.controlTenants)
  .values({ id: TENANT, organizationId: ORG, slug: 'broberg-ai', name: 'broberg-ai' })
  .run();
await db
  .insert(schema.controlUsers)
  .values({ id: 'usr-cb', organizationId: ORG, email: 'cb@webhouse.dk', name: 'cb', onboarded: true })
  .run();
await db
  .insert(schema.sessions)
  .values({ id: 'sess-cb', userId: 'usr-cb', expiresAt: new Date(Date.now() + 3.6e6).toISOString() })
  .run();

// The context the @broberg/lens core passes into createSession.
const expiresAt = Date.now() + 600_000;
const ctx = { principal: LENS_EMAIL, host: 'app.trailmem.com', secure: true, ttlMs: 600_000, expiresAt };

// ── 1. mint ─────────────────────────────────────────────────────────────────
console.log('[1] mintLensCookie (Trail createSession callback)');
const cookie = await mintLensCookie(ctx);
assert(cookie.name === 'trail-session', 'returns the trail-session cookie');
assert(typeof cookie.value === 'string' && cookie.value.length === 64, 'value = raw 64-hex session id (unsigned)');
const sessionId = cookie.value;

// ── 2. dedicated NON-cb principal, broberg-ai only, TTL clamped ─────────────
console.log('\n[2] dedicated read-only principal (never cb@)');
const lens = await db.query.controlUsers.findFirst({ where: eq(schema.controlUsers.email, LENS_EMAIL) });
assert(!!lens, `lens user exists (${LENS_EMAIL})`);
assert(lens?.email !== 'cb@webhouse.dk', 'principal is NOT cb@webhouse.dk');
const mem = await db.query.controlMemberships.findFirst({
  where: and(eq(schema.controlMemberships.userId, lens!.id), eq(schema.controlMemberships.tenantId, TENANT)),
});
assert(mem?.role === 'member', 'member membership in broberg-ai only');
const sess = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, sessionId) });
assert(sess?.userId === lens!.id, 'session belongs to the lens principal');
assert(
  sess != null && Math.abs(new Date(sess.expiresAt).getTime() - expiresAt) < 2_000,
  'session row clamped to the package TTL (~10 min)',
);

// ── 3. idempotent — no duplicate principal, fresh session each mint ─────────
console.log('\n[3] idempotent find-or-create');
const cookie2 = await mintLensCookie(ctx);
const lensUsers = await db.select().from(schema.controlUsers).where(eq(schema.controlUsers.email, LENS_EMAIL)).all();
assert(lensUsers.length === 1, 'exactly ONE lens user after two mints (no dupe)');
assert(cookie2.value !== sessionId, 'each mint issues a fresh session');

// ── 4. guard discrimination ─────────────────────────────────────────────────
console.log('\n[4] isLensPrincipalSession');
assert((await isLensPrincipalSession(sessionId)) === true, 'lens session → true (guard would 403 its writes)');
assert((await isLensPrincipalSession('sess-cb')) === false, "cb's session → false (real users unaffected)");

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
