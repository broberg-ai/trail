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
const db = pool.get('fd-aalborg')!;
const cols = await db.client.execute("SELECT name FROM pragma_table_info('documents')");
assert(cols.rows.length > 0, 'the documents table exists (migrations really ran)', `${cols.rows.length} columns`);
const mig = await db.client.execute('SELECT count(*) n FROM __drizzle_migrations');
assert(
  Number((mig.rows[0] as unknown as { n: number }).n) > 0,
  'migrations are recorded',
  `${(mig.rows[0] as unknown as { n: number }).n} rows`,
);

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

try { rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(failures === 0 ? '\n✓ F210.2 verified\n' : `\n✗ F210.2: ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
