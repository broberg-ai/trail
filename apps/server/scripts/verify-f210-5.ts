/**
 * F210.5 — a provisioned tenant must be REACHABLE, not merely present.
 *
 * The failure this pins, measured on prod 2026-08-28 minutes after the owner
 * created his first customer: `/data/fd-aalborg/trail.db` existed with all 44
 * tables migrated, the endpoint had answered 201, and the tenant was live in
 * the pool — while `tenants`, `users` and `api_keys` inside it were ALL EMPTY.
 * The control plane had minted a bearer the engine had never heard of, so the
 * customer's every request answered "Invalid or revoked API key".
 *
 * So the assertions here are deliberately NOT "was the database created". That
 * was always true. They are "can a request actually resolve through it".
 *
 * Run: bun run apps/server/scripts/verify-f210-5.ts
 */
import { rmSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const DIR = mkdtempSync(join(tmpdir(), 'f210-5-'));
process.env.TRAIL_DATA_DIR = DIR;

import type { TenantPool } from '../src/lib/tenant-pool.js';
const { provisionTenant } = await import('../src/lib/tenant-pool.js');
const { seedTenantIdentity } = await import('../src/bootstrap/seed-tenant.js');
const { createClient } = await import('@libsql/client');

let failures = 0;
function assert(cond: boolean, msg: string, detail?: string): void {
  if (!cond) { console.error('  ✗ ' + msg + (detail ? `\n      ${detail}` : '')); failures++; return; }
  console.log('  ✓ ' + msg);
}
const one = async (path: string, sql: string) => {
  const c = createClient({ url: `file:${path}` });
  const r = await c.execute(sql);
  c.close();
  return r.rows;
};

const SLUG = 'fd-aalborg';
const OWNER = 'cb@webhouse.dk';
const BEARER = `trail_${randomUUID().replace(/-/g, '')}`;
const KEY_HASH = createHash('sha256').update(BEARER).digest('hex');

try {
  // Build the cross-tenant key index the way a real multi-tenant host has it.
  // Without this the run would exercise the SINGLE-tenant path, where the
  // index is legitimately absent — and would prove nothing about the failure
  // this card exists to fix.
  {
    const { Database } = await import('bun:sqlite');
    const idx = new Database(join(DIR, 'key-index.db'));
    idx.run(`CREATE TABLE IF NOT EXISTS api_key_index (
      key_hash TEXT PRIMARY KEY, tenant_slug TEXT NOT NULL, user_id TEXT NOT NULL,
      created_at TEXT NOT NULL, revoked_at TEXT
    )`);
    idx.close();
  }

  const pool: TenantPool = new Map();
  const { path } = await provisionTenant({
    pool,
    slug: SLUG,
    boot: async (db) => { await db.runMigrations(); },
    seed: (db) => seedTenantIdentity(db, { slug: SLUG, name: 'FD Aalborg', ownerEmail: OWNER, keyHash: KEY_HASH }),
  });

  console.log('\n[exists] the part that ALREADY worked, kept as a control');
  assert(existsSync(path), 'the database file was created');
  assert(pool.has(SLUG), 'and the tenant is live in the pool without a restart');

  console.log('\n[reachable] the part that did not — every row a request needs');
  const t = await one(path, `SELECT slug, name FROM tenants`);
  assert(t.length === 1, 'exactly one tenant row', JSON.stringify(t));
  assert((t[0] as { slug: string })?.slug === SLUG, `tenant slug is ${SLUG}`, JSON.stringify(t[0]));

  const u = await one(path, `SELECT email, role FROM users`);
  assert(u.some((r) => (r as { email: string }).email === OWNER), 'the owner has a user row', JSON.stringify(u));

  const k = await one(path, `SELECT key_hash, scope, revoked_at FROM api_keys`);
  assert(k.length === 1, 'exactly one api_key row', JSON.stringify(k));
  assert(
    (k[0] as { key_hash: string })?.key_hash === KEY_HASH,
    'and it is the hash of the bearer the control plane will forward',
    `stored ${(k[0] as { key_hash: string })?.key_hash?.slice(0, 16)}… expected ${KEY_HASH.slice(0, 16)}…`,
  );
  assert((k[0] as { revoked_at: string | null })?.revoked_at === null, 'the key is not revoked');

  console.log('\n[index] auth reads the cross-tenant index FIRST');
  const idxPath = join(DIR, 'key-index.db');
  assert(existsSync(idxPath), 'the key index exists');
  const idx = await one(idxPath, `SELECT tenant_slug, revoked_at FROM api_key_index WHERE key_hash = '${KEY_HASH}'`);
  assert(idx.length === 1, 'the key is registered in the index', JSON.stringify(idx));
  assert(
    (idx[0] as { tenant_slug: string })?.tenant_slug === SLUG,
    'and it points at THIS tenant — without this the key is valid but unfindable',
    JSON.stringify(idx[0]),
  );

  console.log('\n[negative control] a key nobody minted resolves to nothing');
  const bogus = createHash('sha256').update('trail_not-a-real-key').digest('hex');
  const none = await one(idxPath, `SELECT tenant_slug FROM api_key_index WHERE key_hash = '${bogus}'`);
  assert(none.length === 0, 'an unknown hash has no index row', JSON.stringify(none));
} finally {
  rmSync(DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
