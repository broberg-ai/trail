/**
 * F187.4 verification — control_memberships seed + cb-owner enforcement.
 *
 * Runs against a throwaway control.db (TRAIL_ADMIN_CONTROL_DB) so it never
 * touches prod. Proves: the migration creates the table, idempotently seeds
 * one `member` row per user×org-tenant pair, forces cb@webhouse.dk to `owner`
 * on every tenant, and is a no-op on re-run.
 *
 * Run: bun run apps/admin-server/scripts/verify-f187-4.ts
 */
import { rmSync } from 'node:fs';

const DB = '/tmp/verify-f187-4.db';
for (const suffix of ['', '-wal', '-shm']) {
  try { rmSync(DB + suffix); } catch { /* fresh */ }
}
process.env.TRAIL_ADMIN_CONTROL_DB = DB;

const { client } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error('  ✗ ' + msg); process.exit(1); }
  console.log('  ✓ ' + msg);
}
async function count(sql: string, args: unknown[] = []): Promise<number> {
  const r = await client.execute({ sql, args: args as never });
  return Number((r.rows[0] as unknown as { n: number }).n);
}

// [1] First migration — creates tables (no users/tenants yet → no seed).
await runMigrations();
assert(
  (await client.execute("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='control_memberships'")).rows.length === 1,
  'control_memberships table exists',
);

// [2] Seed an org with cb + one other user, and two tenants.
await client.execute("INSERT INTO organizations (id, slug, name) VALUES ('org1','broberg-ai','Broberg.ai')");
await client.execute("INSERT INTO control_users (id, organization_id, email) VALUES ('u-cb','org1','cb@webhouse.dk')");
await client.execute("INSERT INTO control_users (id, organization_id, email) VALUES ('u-x','org1','someone@else.dk')");
await client.execute("INSERT INTO control_tenants (id, organization_id, slug, name) VALUES ('t-a','org1','broberg-ai','Broberg.ai')");
await client.execute("INSERT INTO control_tenants (id, organization_id, slug, name) VALUES ('t-b','org1','sanne-andersen','Sanne Andersen')");

// [3] Second migration — should seed memberships + promote cb.
await runMigrations();
assert(await count('SELECT count(*) n FROM control_memberships') === 4, '4 membership rows seeded (2 users × 2 tenants)');
assert(await count("SELECT count(*) n FROM control_memberships WHERE user_id='u-cb' AND role='owner'") === 2, 'cb@webhouse.dk is owner on BOTH tenants');
assert(await count("SELECT count(*) n FROM control_memberships WHERE user_id='u-x' AND role='member'") === 2, 'other user is member on both (no false elevation)');

// [4] Tamper: demote cb on one tenant, then re-run — self-heals to owner.
await client.execute("UPDATE control_memberships SET role='member' WHERE user_id='u-cb' AND tenant_id='t-a'");
await runMigrations();
assert(await count("SELECT count(*) n FROM control_memberships WHERE user_id='u-cb' AND role='owner'") === 2, 'cb demotion self-heals to owner on re-run (UFRAVIGELIG)');

// [5] Idempotency — no duplicate rows after repeated runs.
await runMigrations();
assert(await count('SELECT count(*) n FROM control_memberships') === 4, 'still exactly 4 rows (seed is idempotent)');

console.log('\n✓ F187.4 verified end-to-end against a temp control.db');
