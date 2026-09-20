/**
 * F210.2 verification — provisioning a tenant makes it live IMMEDIATELY.
 *
 * The clause that matters is "no restart". Before this, `tenant-pool.ts` said
 * in its own header that the pool is frozen at boot: a tenant created in the
 * admin existed on disk and answered 401 to every request until someone
 * restarted the engine. A test that restarts before asserting cannot tell a
 * working provision from that broken one — so this one never restarts.
 *
 * Run: bun run apps/server/scripts/verify-f210-2.ts
 */
import { rmSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = mkdtempSync(join(tmpdir(), 'f210-2-'));
process.env.TRAIL_DATA_DIR = DATA;

const { createLibsqlDatabase } = await import('@trail/db');
const { provisionTenant } = await import('../src/lib/tenant-pool.js');
const { adminTenantRoutes } = await import('../src/routes/admin-tenants.js');
const { seedTenantIdentity } = await import('../src/bootstrap/seed-tenant.js');
type Pool = Awaited<ReturnType<typeof import('../src/lib/tenant-pool.js').openTenantPool>>;

let failures = 0;
function assert(cond: boolean, msg: string, detail?: string): void {
  if (!cond) { console.error('  ✗ ' + msg + (detail ? `\n      ${detail}` : '')); failures++; return; }
  console.log('  ✓ ' + msg);
}

const pool: Pool = new Map();
let booted: string[] = [];
const boot = async (db: Parameters<Parameters<typeof provisionTenant>[0]['boot']>[0]) => {
  await db.runMigrations();
  await db.initFTS();
  booted.push('ok');
};

// ── The negative control FIRST: an unknown slug must not resolve.
console.log('\n[before] an unprovisioned slug does not resolve');
assert(!pool.has('fd-aalborg'), 'pool does NOT have fd-aalborg yet');
assert(!existsSync(join(DATA, 'fd-aalborg')), 'no directory on disk yet');

// ── Provision.
console.log('\n[provision] create it');
const res = await provisionTenant({ pool, slug: 'fd-aalborg', boot });
assert(res.slug === 'fd-aalborg', 'returns the slug');
assert(existsSync(join(DATA, 'fd-aalborg', 'trail.db')), 'trail.db exists on disk');
assert(booted.length === 1, 'the boot sequence ran exactly once', `ran ${booted.length}×`);

// ── THE POINT: live now, with no restart.
console.log('\n[live] resolvable immediately — no restart');
assert(pool.has('fd-aalborg'), 'the pool resolves fd-aalborg RIGHT AFTER the call');

// And the DB is really migrated + writable, not merely present.
//
// Guarded rather than `!`: under AC5's mutation (pool.set removed) the pool
// does not resolve, and a bare non-null assertion made the run DIE here with
// a TypeError — which reads like a broken probe instead of the product defect
// the mutation is demonstrating. The remaining assertions are reported as
// failures with a reason, so the output says what it means.
const db = pool.get('fd-aalborg');
if (!db) {
  console.error('  ✗ cannot inspect the new DB — the pool never resolved it (see the failure above)');
  failures++;
} else {
const cols = await db.client.execute("SELECT name FROM pragma_table_info('documents')");
assert(cols.rows.length > 0, 'the documents table exists (migrations really ran)', `${cols.rows.length} columns`);
const mig = await db.client.execute('SELECT count(*) n FROM __drizzle_migrations');
assert(
  Number((mig.rows[0] as unknown as { n: number }).n) > 0,
  'migrations are recorded',
  `${(mig.rows[0] as unknown as { n: number }).n} rows`,
);
}

// ── A second call for the same slug is refused, and changes nothing.
console.log('\n[duplicate] refused, disk untouched');
const filesBefore = readdirSync(join(DATA, 'fd-aalborg')).sort().join(',');
let threw = '';
try {
  await provisionTenant({ pool, slug: 'fd-aalborg', boot });
} catch (e) { threw = e instanceof Error ? e.message : String(e); }
assert(/already/.test(threw), 'a second provision throws "already…"', `threw: ${threw || '(nothing)'}`);
assert(readdirSync(join(DATA, 'fd-aalborg')).sort().join(',') === filesBefore, 'the directory is unchanged');
assert(booted.length === 1, 'the boot sequence did NOT run a second time', `ran ${booted.length}×`);

// ── A hostile slug cannot escape the data dir.
console.log('\n[slug] a path-traversal slug is refused');
for (const bad of ['../escape', 'UPPER', 'has space', '', '-leading']) {
  let msg = '';
  try { await provisionTenant({ pool, slug: bad, boot }); } catch (e) { msg = String(e); }
  assert(/invalid tenant slug/.test(msg), `refused: ${JSON.stringify(bad)}`, msg || '(no throw)');
}
assert(!existsSync(join(DATA, '..', 'escape')), 'nothing was created outside the data dir');

// ─────────────────────────────────────────────────────────────────────────────
// THE ROUTE ITSELF, driven for real.
//
// Everything above exercises provisionTenant(). That is the right function,
// but it is not the SURFACE: AC4 says an unauthenticated call must be refused
// and must create no directory, and until this section existed nothing checked
// that at all. The one assertion saying a stranger who can reach this port
// cannot create directories on a production volume was the one with no test.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[route] the HTTP surface, not just the function');

const SECRET = 'f210-2-probe-secret';
const routePool: Pool = new Map();
let routeBooted = 0;
const routeApp = adminTenantRoutes({
  pool: routePool,
  boot: async (db) => { await db.runMigrations(); await db.initFTS(); routeBooted++; },
  seed: seedTenantIdentity,
});

interface Answer { status: number; body: Record<string, unknown> }
async function post(payload: unknown, bearer: string | null): Promise<Answer> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer !== null) headers.Authorization = `Bearer ${bearer}`;
  const r = await routeApp.request('/admin/tenants', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  // Read defensively: a 500 comes back as HTML, and a bare .json() there dies
  // with "Failed to parse JSON" — which reads like a broken probe rather than
  // a broken product. The assertion must be able to SAY what it got.
  const raw = await r.text();
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; }
  catch { body = { nonJsonBody: raw.slice(0, 120) }; }
  return { status: r.status, body };
}

const GOOD = { slug: 'fdaa-route', name: 'FDAA', ownerEmail: 'cb@webhouse.dk', keyHash: 'a'.repeat(64) };
const routeDir = join(DATA, 'fdaa-route');

// Ships dark FIRST: with no secret set, nobody can provision anything.
delete process.env.TRAIL_PROVISION_SECRET;
const dark = await post(GOOD, null);
assert(dark.status === 503, 'no TRAIL_PROVISION_SECRET → 503, it does not provision', `got ${dark.status}`);
assert(!existsSync(routeDir), 'and the ship-dark refusal created NO directory');

process.env.TRAIL_PROVISION_SECRET = SECRET;

// AC4 — the assertion that had no test.
const anon = await post(GOOD, null);
assert(anon.status === 401, 'NO bearer → 401', `got ${anon.status} ${JSON.stringify(anon.body)}`);
const wrong = await post(GOOD, 'not-the-secret');
assert(wrong.status === 401, 'WRONG bearer → 401', `got ${wrong.status} ${JSON.stringify(wrong.body)}`);
assert(!existsSync(routeDir), 'neither unauthenticated call created a directory');
assert(routeBooted === 0, 'and neither of them ran the boot sequence', `ran ${routeBooted}×`);

// F210.5's clause: refuse a tenant that would exist and be unreachable.
const noKey = await post({ slug: 'fdaa-route', name: 'FDAA', ownerEmail: 'cb@webhouse.dk' }, SECRET);
assert(noKey.status === 400, 'no keyHash → 400 (a tenant that could not be reached)', `got ${noKey.status}`);
assert(!existsSync(routeDir), 'and it created no directory either');

// The real thing.
const created = await post(GOOD, SECRET);
assert(created.status === 201, 'authenticated + complete → 201', `got ${created.status} ${JSON.stringify(created.body)}`);
assert(created.body.live === true, 'the response says live:true — the pool has it already', `got ${String(created.body.live)}`);
assert(routePool.has('fdaa-route'), 'and the pool really does resolve it, with no restart');

// AC1's two clauses that were missing: the migration COUNT matches a database
// migrated by the same code, and a real value ROUND-TRIPS through the new DB.
// Guarded for the same reason as above: under AC5's mutation this is exactly
// the thing that is missing, and a crash here would hide the 4 clean failures
// the mutation is supposed to produce.
const routeDb = routePool.get('fdaa-route');
if (!routeDb) {
  console.error('  ✗ cannot inspect the provisioned DB — the pool never resolved it');
  failures++;
} else {
const reference = await createLibsqlDatabase({ path: join(DATA, 'reference.db') });
await reference.runMigrations();
const countOf = async (d: { client: { execute: (q: string) => Promise<{ rows: unknown[] }> } }) => {
  const r = await d.client.execute('SELECT count(*) n FROM __drizzle_migrations');
  return Number((r.rows[0] as { n: number }).n);
};
const newCount = await countOf(routeDb);
const refCount = await countOf(reference);
assert(newCount === refCount, 'the new tenant has the SAME migration count as a freshly migrated DB', `new ${newCount} vs reference ${refCount}`);

// First: read back the row the PRODUCTION seed wrote. That proves migrations
// ran AND that the real code path's write landed — stronger than a synthetic
// insert of my own, because it is the write the tenant's reachability depends
// on.
const seeded = await routeDb.client.execute({
  sql: 'SELECT slug, name FROM tenants WHERE slug = ?',
  args: ['fdaa-route'],
});
assert(seeded.rows.length === 1, 'the seed wrote the tenants row (F210.5 reachability)');
assert(
  String((seeded.rows[0] as unknown as { name: string }).name) === 'FDAA',
  'and the name round-trips EXACTLY — strict equality, not "contains"',
  `read ${String((seeded.rows[0] as unknown as { name: string } | undefined)?.name)}`,
);

// Then a value that CANNOT already be there, so a broken write cannot look
// green off a leftover row.
const marker = `f210-2-${Date.now()}`;
await routeDb.client.execute({
  sql: "INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)",
  args: [marker, marker, marker],
});
const back = await routeDb.client.execute({ sql: 'SELECT name FROM tenants WHERE id = ?', args: [marker] });
assert(back.rows.length === 1, 'a fresh row written to the new DB can be read back');
assert(
  String((back.rows[0] as unknown as { name: string }).name) === marker,
  'and IT round-trips exactly too',
  `wrote ${marker}, read ${String((back.rows[0] as unknown as { name: string } | undefined)?.name)}`,
);

}

// AC2's negative control, at the route: an unprovisioned slug does not resolve.
assert(!routePool.has('never-provisioned'), 'NEGATIVE CONTROL: a slug nobody provisioned does not resolve');

// AC3 at the route: a second POST for the same slug is a 409, disk untouched.
const filesAfter = readdirSync(routeDir).sort().join(',');
const again = await post(GOOD, SECRET);
assert(again.status === 409, 'a second POST for the same slug → 409', `got ${again.status} ${JSON.stringify(again.body)}`);
assert(readdirSync(routeDir).sort().join(',') === filesAfter, 'and the existing directory is unchanged');
assert(routeBooted === 1, 'the boot sequence still ran exactly once', `ran ${routeBooted}×`);

// AC6 — the tenants that were already live are untouched by a provision.
console.log('\n[untouched] an existing tenant is unaffected by provisioning a new one');
const neighbourDir = join(DATA, 'sanne-andersen');
await provisionTenant({ pool: routePool, slug: 'sanne-andersen', boot: async (db) => { await db.runMigrations(); await db.initFTS(); } });
const neighbour = routePool.get('sanne-andersen');
if (!neighbour) {
  console.error('  ✗ the neighbour tenant never went live — cannot compare it');
  failures++;
} else {
await neighbour.client.execute({
  sql: "INSERT INTO tenants (id, slug, name) VALUES ('n1', 'sanne-andersen', 'Sanne Andersen')",
});
const neighbourBefore = readdirSync(neighbourDir).sort().join(',');
const docsBefore = await neighbour.client.execute('SELECT count(*) n FROM tenants');
await post({ slug: 'third-customer', name: 'Third', ownerEmail: 'cb@webhouse.dk', keyHash: 'b'.repeat(64) }, SECRET);
const docsAfter = await neighbour.client.execute('SELECT count(*) n FROM tenants');
assert(
  Number((docsAfter.rows[0] as { n: number }).n) === Number((docsBefore.rows[0] as { n: number }).n),
  'the neighbour tenant row count is unchanged by a new provision',
  `${Number((docsBefore.rows[0] as { n: number }).n)} → ${Number((docsAfter.rows[0] as { n: number }).n)}`,
);
assert(readdirSync(neighbourDir).sort().join(',') === neighbourBefore, 'and its directory is byte-for-byte the same file list');
assert(routePool.has('sanne-andersen') && routePool.has('third-customer'), 'both tenants are live at the same time');
// NEGATIVE CONTROL for that comparison: it must be able to SEE a change.
await neighbour.client.execute({
  sql: "INSERT INTO tenants (id, slug, name) VALUES ('n2', 'n2-probe', 'x')",
});
const docsTampered = await neighbour.client.execute('SELECT count(*) n FROM tenants');
assert(
  Number((docsTampered.rows[0] as { n: number }).n) !== Number((docsBefore.rows[0] as { n: number }).n),
  'NEGATIVE CONTROL: the count comparison DOES notice an added row',
);
}

try { rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(failures === 0 ? '\n✓ F210.2 verified\n' : `\n✗ F210.2: ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
