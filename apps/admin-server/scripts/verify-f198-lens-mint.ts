/**
 * F198 — verify the Lens mint logic against a throwaway control.db. Proves the
 * security properties (HTTP 503/401 are verified live post-deploy).
 *
 * Run: cd apps/admin-server && \
 *   rm -f /tmp/trail-f198-verify.db* && \
 *   TRAIL_ADMIN_CONTROL_DB=/tmp/trail-f198-verify.db bun run scripts/verify-f198-lens-mint.ts
 */
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';
import { mintLensSession, isLensPrincipalSession, LENS_EMAIL } from '../src/lens-session.js';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log('\n=== F198 Lens mint verify ===\n');
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

// ── 1. mint ─────────────────────────────────────────────────────────────────
console.log('[1] mintLensSession');
const state = await mintLensSession({ tenantSlug: 'broberg-ai', cookieDomain: '.trailmem.com' });
const cookie = state.cookies[0];
assert(cookie?.name === 'trail-session', 'cookie name = trail-session');
assert(cookie?.domain === '.trailmem.com' && cookie.path === '/', 'domain/path set');
assert(cookie?.httpOnly === true && cookie.secure === true && cookie.sameSite === 'Lax', 'httpOnly+secure+SameSite=Lax');
assert(Array.isArray(state.origins) && state.origins.length === 0, 'origins = []');
const ttlMs = (cookie?.expires ?? 0) * 1000 - Date.now();
assert(ttlMs > 9 * 60_000 && ttlMs <= 10 * 60_000 + 5_000, `~10-min TTL (got ${Math.round(ttlMs / 1000)}s)`);
const sessionId = cookie!.value;

// ── 2. principal is a dedicated NON-cb user ─────────────────────────────────
console.log('\n[2] dedicated read-only principal (never cb@)');
const lens = await db.query.controlUsers.findFirst({ where: eq(schema.controlUsers.email, LENS_EMAIL) });
assert(!!lens, `lens user exists (${LENS_EMAIL})`);
assert(lens?.email !== 'cb@webhouse.dk', 'principal is NOT cb@webhouse.dk');
const mem = await db.query.controlMemberships.findFirst({
  where: and(eq(schema.controlMemberships.userId, lens!.id), eq(schema.controlMemberships.tenantId, TENANT)),
});
assert(mem?.role === 'member', 'member membership in broberg-ai only');
const sess = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, sessionId) });
assert(sess?.userId === lens!.id, 'minted session belongs to the lens principal');

// ── 3. idempotent — no duplicate principal, fresh session each mint ─────────
console.log('\n[3] idempotent find-or-create');
const state2 = await mintLensSession({ tenantSlug: 'broberg-ai', cookieDomain: '.trailmem.com' });
const lensUsers = await db.select().from(schema.controlUsers).where(eq(schema.controlUsers.email, LENS_EMAIL)).all();
assert(lensUsers.length === 1, 'exactly ONE lens user after two mints (no dupe)');
assert(state2.cookies[0]!.value !== sessionId, 'each mint issues a fresh session');

// ── 4. guard discrimination ─────────────────────────────────────────────────
console.log('\n[4] isLensPrincipalSession');
assert((await isLensPrincipalSession(sessionId)) === true, 'lens session → true (guard would 403 its writes)');
assert((await isLensPrincipalSession('sess-cb')) === false, "cb's session → false (real users unaffected)");

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
