import { client } from './db.js';

/**
 * Bootstrap migrations for control.db. Idempotent — runs every boot,
 * each statement uses IF NOT EXISTS so re-runs are no-ops.
 *
 * For Phase 1B we keep this inline rather than using drizzle-kit's
 * migration runner — control.db is small and won't drift much. Move
 * to drizzle-kit when we have ≥ 3 migrations or a schema change that
 * affects production data.
 */

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS control_users (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    onboarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_control_users_email ON control_users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_control_users_org ON control_users(organization_id)`,

  `CREATE TABLE IF NOT EXISTS control_tenants (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'da',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_control_tenants_org ON control_tenants(organization_id)`,

  `CREATE TABLE IF NOT EXISTS tenant_engines (
    tenant_id TEXT PRIMARY KEY NOT NULL REFERENCES control_tenants(id) ON DELETE CASCADE,
    engine_id TEXT NOT NULL,
    engine_url TEXT NOT NULL,
    engine_internal_url TEXT,
    provisioned_at TEXT NOT NULL,
    retired_at TEXT,
    notes TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tenant_engines_engine ON tenant_engines(engine_id, retired_at)`,

  `CREATE TABLE IF NOT EXISTS control_api_keys (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES control_tenants(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES control_users(id) ON DELETE CASCADE,
    prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT,
    last_used_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_control_api_keys_tenant ON control_api_keys(tenant_id, revoked_at)`,

  `CREATE TABLE IF NOT EXISTS magic_links (
    token TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES control_users(id) ON DELETE CASCADE,
    intent TEXT NOT NULL DEFAULT 'login',
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_magic_links_user ON magic_links(user_id)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES control_users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT,
    user_agent TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at)`,

  // F187 — tenant invitations. Org-scoped (one-user-one-org model);
  // role is forward-compat metadata, not enforced. status: pending |
  // accepted | revoked | expired.
  `CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY NOT NULL,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    invited_by_user_id TEXT NOT NULL REFERENCES control_users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    accepted_user_id TEXT REFERENCES control_users(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(organization_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email)`,

  // F187.4 — per-tenant membership roles (first real RBAC primitive).
  // role: owner | admin | member. Display + data only; not enforced yet.
  `CREATE TABLE IF NOT EXISTS control_memberships (
    user_id TEXT NOT NULL REFERENCES control_users(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES control_tenants(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, tenant_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_control_memberships_tenant ON control_memberships(tenant_id)`,
  // F194 — linked OAuth identities (Google/GitHub account-linking).
  `CREATE TABLE IF NOT EXISTS oauth_identities (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES control_users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_subject TEXT NOT NULL,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_identities_provider_subject ON oauth_identities(provider, provider_subject)`,
  `CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(user_id)`,
];

export async function runMigrations(): Promise<void> {
  for (const sql of STATEMENTS) {
    await client.execute(sql);
  }
  // F186 follow-up — bearer column on tenant_engines. We can't use
  // IF NOT EXISTS on ALTER TABLE in SQLite, so probe pragma first.
  const cols = await client.execute("PRAGMA table_info('tenant_engines')");
  const hasBearer = cols.rows.some((r) => (r as { name?: string }).name === 'bearer');
  if (!hasBearer) {
    await client.execute('ALTER TABLE tenant_engines ADD COLUMN bearer TEXT');
  }

  // One-shot env-var backfill — old prod used TRAIL_ADMIN_PROXY_BEARER_<SLUG>
  // env-vars on the trail-admin Fly app. Migrate every set value into the
  // DB row so the env-var dance goes away. Idempotent: only writes when
  // the row's bearer column is null AND the env-var is set.
  const rows = await client.execute(
    'SELECT te.tenant_id, ct.slug FROM tenant_engines te ' +
      'JOIN control_tenants ct ON ct.id = te.tenant_id ' +
      'WHERE te.bearer IS NULL AND te.retired_at IS NULL',
  );
  for (const row of rows.rows) {
    const slug = (row as { slug?: string }).slug;
    const tenantId = (row as { tenant_id?: string }).tenant_id;
    if (!slug || !tenantId) continue;
    const envKey = `TRAIL_ADMIN_PROXY_BEARER_${slug.toUpperCase().replace(/-/g, '_')}`;
    const value = process.env[envKey];
    if (!value) continue;
    await client.execute({
      sql: 'UPDATE tenant_engines SET bearer = ? WHERE tenant_id = ?',
      args: [value, tenantId],
    });
    console.log(`[migrations] backfilled bearer for tenant ${slug} from ${envKey}`);
  }

  // F187.4 — seed memberships. Additive + idempotent:
  //   1) every existing user × tenant-in-same-org pair gets a `member` row
  //      (so each user shows a real role on every tenant they can see). This
  //      matches today's pre-RBAC reality where org-membership = full access;
  //      `member` is honest (no false elevation) and never reduces access.
  //   2) cb@webhouse.dk is FORCED to `owner` on every membership row — the
  //      repo-owner is always owner (UFRAVIGELIG). Runs every boot, so a stray
  //      demotion self-heals. Never deletes/lowers cb; only raises to owner.
  const seeded = await client.execute(
    `INSERT INTO control_memberships (user_id, tenant_id, role)
     SELECT u.id, t.id, 'member'
       FROM control_users u
       JOIN control_tenants t ON t.organization_id = u.organization_id
      WHERE NOT EXISTS (
        SELECT 1 FROM control_memberships m
         WHERE m.user_id = u.id AND m.tenant_id = t.id
      )`,
  );
  if (seeded.rowsAffected > 0) {
    console.log(`[migrations] F187.4 seeded ${seeded.rowsAffected} membership row(s)`);
  }
  const promoted = await client.execute(
    `UPDATE control_memberships SET role = 'owner'
      WHERE role != 'owner'
        AND user_id IN (SELECT id FROM control_users WHERE email = 'cb@webhouse.dk')`,
  );
  if (promoted.rowsAffected > 0) {
    console.log(`[migrations] F187.4 enforced cb@webhouse.dk=owner on ${promoted.rowsAffected} tenant(s)`);
  }
}
