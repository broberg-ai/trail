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
];

export async function runMigrations(): Promise<void> {
  for (const sql of STATEMENTS) {
    await client.execute(sql);
  }
}
