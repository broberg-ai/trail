/**
 * F40.2a-1: Build /data/key-index.db from existing tenant DBs.
 *
 * Runs on the engine container. Walks /data/<slug>/trail.db for each
 * known tenant (currently sanne-andersen + broberg-ai), reads their
 * api_keys + sessions tables, INSERTs into the global key-index.
 *
 * Idempotent: re-runs replace stale rows for the same key_hash /
 * session_id. Source-of-truth for revocation stays in the per-tenant
 * api_keys.revoked_at; this script honours it.
 *
 * Read-only on tenant DBs.
 */
import { Database } from 'bun:sqlite';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.TRAIL_DATA_DIR ?? '/data';
const INDEX_PATH = join(DATA_DIR, 'key-index.db');

// Directories under /data that are NOT tenants. Mirrors what
// openTenantPool() will use (F40.2a-3) — keep these two in sync.
const NON_TENANT_DIRS = new Set([
  '_archive',
  '_incoming',
  'backups',
  'lost+found',
  'uploads',
]);

function discoverTenantSlugs(): string[] {
  const slugs: string[] = [];
  for (const entry of readdirSync(DATA_DIR)) {
    if (NON_TENANT_DIRS.has(entry)) continue;
    const full = join(DATA_DIR, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (!existsSync(join(full, 'trail.db'))) continue;
    slugs.push(entry);
  }
  return slugs.sort();
}

// ===== 1. Open/create the index DB =====
const index = new Database(INDEX_PATH);
index.run('PRAGMA journal_mode=WAL');

index.run(`
  CREATE TABLE IF NOT EXISTS api_key_index (
    key_hash TEXT PRIMARY KEY,
    tenant_slug TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  )
`);
index.run(`CREATE INDEX IF NOT EXISTS idx_api_key_index_slug ON api_key_index (tenant_slug)`);

index.run(`
  CREATE TABLE IF NOT EXISTS session_index (
    session_id TEXT PRIMARY KEY,
    tenant_slug TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);
index.run(`CREATE INDEX IF NOT EXISTS idx_session_index_slug ON session_index (tenant_slug)`);

console.log(`✓ key-index.db ready at ${INDEX_PATH}`);

// ===== 2. Pull from each tenant DB =====
const slugs = discoverTenantSlugs();
console.log(`✓ Discovered ${slugs.length} tenants: ${slugs.join(', ')}`);

let apiKeysCopied = 0;
let sessionsCopied = 0;
const nowIso = new Date().toISOString();

for (const slug of slugs) {
  const tenantPath = join(DATA_DIR, slug, 'trail.db');
  const tenant = new Database(tenantPath, { readonly: true });

  // ----- api_keys → api_key_index -----
  // Probe column names — different tenants might have schema-drift.
  const apiKeyCols = (
    tenant.query('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>
  ).map((c) => c.name);
  const hashCol = apiKeyCols.includes('key_hash') ? 'key_hash' : null;
  if (!hashCol) {
    console.warn(`  ${slug}: no key_hash column in api_keys, skipping bearers`);
  } else {
    const rows = tenant
      .query(
        `SELECT key_hash, user_id, created_at, revoked_at FROM api_keys`,
      )
      .all() as Array<{
        key_hash: string;
        user_id: string;
        created_at: string;
        revoked_at: string | null;
      }>;
    for (const r of rows) {
      index.run(
        `INSERT INTO api_key_index (key_hash, tenant_slug, user_id, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key_hash) DO UPDATE SET
           tenant_slug = excluded.tenant_slug,
           user_id     = excluded.user_id,
           created_at  = excluded.created_at,
           revoked_at  = excluded.revoked_at`,
        [r.key_hash, slug, r.user_id, r.created_at, r.revoked_at],
      );
      apiKeysCopied++;
    }
    console.log(`  ${slug}: ${rows.length} api_keys → index`);
  }

  // ----- sessions → session_index -----
  const sessionCols = (
    tenant.query('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
  ).map((c) => c.name);
  if (!sessionCols.includes('id')) {
    console.warn(`  ${slug}: sessions table missing 'id' col, skipping sessions`);
  } else {
    const rows = tenant
      .query(`SELECT id, user_id, expires_at, created_at FROM sessions`)
      .all() as Array<{
        id: string;
        user_id: string;
        expires_at: string;
        created_at: string;
      }>;
    for (const r of rows) {
      // Only copy non-expired sessions — there's no reason to keep
      // expired ones in the auth-hot-path lookup.
      if (r.expires_at < nowIso) continue;
      index.run(
        `INSERT INTO session_index (session_id, tenant_slug, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           tenant_slug = excluded.tenant_slug,
           user_id     = excluded.user_id,
           expires_at  = excluded.expires_at,
           created_at  = excluded.created_at`,
        [r.id, slug, r.user_id, r.expires_at, r.created_at],
      );
      sessionsCopied++;
    }
    console.log(`  ${slug}: ${rows.filter((r) => r.expires_at >= nowIso).length} active sessions → index`);
  }

  tenant.close();
}

// ===== 3. Final verification =====
console.log('\n=== key-index.db final state ===');
const idxApiKeys = (
  index.query('SELECT tenant_slug, COUNT(*) c FROM api_key_index GROUP BY tenant_slug').all()
);
console.log('api_key_index per tenant:', JSON.stringify(idxApiKeys));
const idxSessions = (
  index.query('SELECT tenant_slug, COUNT(*) c FROM session_index GROUP BY tenant_slug').all()
);
console.log('session_index per tenant:', JSON.stringify(idxSessions));

const integrity = (
  index.query('PRAGMA integrity_check').get() as { integrity_check: string }
).integrity_check;
console.log(`integrity: ${integrity}`);

index.run('PRAGMA wal_checkpoint(TRUNCATE)');
index.close();

console.log(
  `\n✓ Backfill complete: ${apiKeysCopied} api_keys + ${sessionsCopied} active sessions indexed across ${slugs.length} tenants`,
);
