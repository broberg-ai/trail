/**
 * F40.2a-B: key-index.db helper — dual-write companion for bearer
 * and session creation.
 *
 * The index lives at /data/key-index.db (or $TRAIL_DATA_DIR/key-index.db
 * locally). It maps key_hash → tenant_slug and session_id → tenant_slug
 * so the auth-middleware can resolve "which tenant DB do I open?"
 * before opening any DB at all.
 *
 * Bearer/session create routes call addBearer/addSession after their
 * per-tenant INSERT — the per-tenant table remains source-of-truth.
 *
 * Design notes:
 * - Independent of the flag (TRAIL_MULTI_TENANT). We always keep the
 *   index in sync when the file exists, so flipping the flag doesn't
 *   require a backfill. When the file is missing (e.g. local dev) the
 *   helper is a silent no-op.
 * - Synchronous via bun:sqlite. The writes are tiny (one row), and
 *   we're already async at the call-sites — wrapping a sync call is
 *   fine and avoids racing with WAL checkpoints.
 * - Idempotent. Uses INSERT ... ON CONFLICT DO UPDATE so repeated
 *   calls (e.g. dev-login UPSERTing the same session id) keep the
 *   index aligned without throwing.
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.TRAIL_DATA_DIR ?? '/data';
const INDEX_PATH = join(DATA_DIR, 'key-index.db');

let cachedDb: Database | null = null;

function openIndex(): Database | null {
  if (cachedDb) return cachedDb;
  if (!existsSync(INDEX_PATH)) return null;
  const db = new Database(INDEX_PATH);
  db.run('PRAGMA journal_mode=WAL');
  cachedDb = db;
  return db;
}

export function addBearer(args: {
  keyHash: string;
  tenantSlug: string;
  userId: string;
  createdAt: string;
}): void {
  const db = openIndex();
  if (!db) return; // no index on this host → silent no-op
  db.run(
    `INSERT INTO api_key_index (key_hash, tenant_slug, user_id, created_at, revoked_at)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(key_hash) DO UPDATE SET
       tenant_slug = excluded.tenant_slug,
       user_id     = excluded.user_id,
       created_at  = excluded.created_at,
       revoked_at  = NULL`,
    [args.keyHash, args.tenantSlug, args.userId, args.createdAt],
  );
}

/**
 * F210.5 — read a bearer back OUT of the index.
 *
 * `addBearer` is a silent no-op when the index file is absent (legitimate in
 * single-tenant local dev). That is fine for a key minted into an already-
 * reachable tenant, and NOT fine at provisioning time, where the index row is
 * the only thing that tells auth which database to open. So the provisioning
 * path writes and then asks — rather than trusting a call that cannot fail.
 *
 * Returns null when there is no index at all (so a caller can tell "no index
 * on this host" from "the write did not land").
 */
export function lookupBearer(keyHash: string): { tenantSlug: string } | null | undefined {
  const db = openIndex();
  if (!db) return undefined; // no index on this host
  const row = db
    .query('SELECT tenant_slug AS tenantSlug FROM api_key_index WHERE key_hash = ? AND revoked_at IS NULL')
    .get(keyHash) as { tenantSlug: string } | undefined;
  return row ?? null;
}

export function revokeBearer(keyHash: string): void {
  const db = openIndex();
  if (!db) return;
  db.run(
    `UPDATE api_key_index SET revoked_at = ? WHERE key_hash = ? AND revoked_at IS NULL`,
    [new Date().toISOString(), keyHash],
  );
}

export function addSession(args: {
  sessionId: string;
  tenantSlug: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}): void {
  const db = openIndex();
  if (!db) return;
  db.run(
    `INSERT INTO session_index (session_id, tenant_slug, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       tenant_slug = excluded.tenant_slug,
       user_id     = excluded.user_id,
       expires_at  = excluded.expires_at,
       created_at  = excluded.created_at`,
    [args.sessionId, args.tenantSlug, args.userId, args.expiresAt, args.createdAt],
  );
}

export function removeSession(sessionId: string): void {
  const db = openIndex();
  if (!db) return;
  db.run(`DELETE FROM session_index WHERE session_id = ?`, [sessionId]);
}

/** Returns `{ tenant_slug, user_id }` if the bearer hash maps to an
 * active (non-revoked) row, otherwise null. Used by the auth middleware
 * F40.2a-D when TRAIL_MULTI_TENANT=1. */
export function resolveBearer(keyHash: string): {
  tenantSlug: string;
  userId: string;
} | null {
  const db = openIndex();
  if (!db) return null;
  const row = db
    .query(
      `SELECT tenant_slug, user_id FROM api_key_index
       WHERE key_hash = ? AND revoked_at IS NULL`,
    )
    .get(keyHash) as { tenant_slug: string; user_id: string } | undefined;
  if (!row) return null;
  return { tenantSlug: row.tenant_slug, userId: row.user_id };
}

/** Same shape as resolveBearer but for cookie sessions. Honours
 * expires_at — expired sessions return null. */
export function resolveSession(sessionId: string): {
  tenantSlug: string;
  userId: string;
} | null {
  const db = openIndex();
  if (!db) return null;
  const row = db
    .query(
      `SELECT tenant_slug, user_id FROM session_index
       WHERE session_id = ? AND expires_at > ?`,
    )
    .get(sessionId, new Date().toISOString()) as
    | { tenant_slug: string; user_id: string }
    | undefined;
  if (!row) return null;
  return { tenantSlug: row.tenant_slug, userId: row.user_id };
}
