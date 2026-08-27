/**
 * F40.2a-C: tenant DB pool — discovers and opens every per-tenant
 * trail.db under /data, keyed by tenant slug.
 *
 * Boot flow (apps/server/src/index.ts):
 *   1. Open primary DB at DEFAULT_DB_PATH (= /data/<primary-slug>/trail.db)
 *      — runs migrations, initFTS, all the bootstrap one-shots. This
 *      is unchanged from F40.1.
 *   2. If TRAIL_MULTI_TENANT === '1': also open every OTHER tenant
 *      DB on disk, run their migrations + initFTS + bootstrap.
 *   3. Build the pool: Map<slug, TrailDatabase>, with `primary`
 *      always present, secondaries present when the flag is on.
 *
 * Reads through the pool happen in:
 *   - auth-middleware (F40.2a-D): bearer/session → key-index → slug
 *     → pool.get(slug). Missing slug ≡ 401, no fallback.
 *   - background services (F40.2a-E): iterate `for (const [slug, db]
 *     of pool)`.
 *
 * Hot-add: F210.2 added `provisionTenant()` below, so a tenant created
 * at runtime is live immediately. Before it, the pool was frozen at
 * boot — a tenant could be created in the control plane, appear in the
 * admin, and answer 401 to every request until someone restarted the
 * engine, with nothing on screen explaining why.
 */
import { readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { createLibsqlDatabase, type TrailDatabase } from '@trail/db';

export type TenantPool = Map<string, TrailDatabase>;

const DATA_DIR = process.env.TRAIL_DATA_DIR ?? '/data';

// Directory entries under /data that are NOT tenant DBs. Mirrors
// build-key-index.ts — keep in sync.
const NON_TENANT_DIRS = new Set([
  '_archive',
  '_incoming',
  'backups',
  'lost+found',
  'uploads',
]);

export function discoverTenantSlugs(): string[] {
  if (!existsSync(DATA_DIR)) return [];
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

/**
 * Derive the primary tenant's slug from TRAIL_DB_PATH. e.g.
 * `/data/sanne-andersen/trail.db` → `sanne-andersen`.
 *
 * Falls back to `'default'` when the path isn't shaped like
 * `<dir>/<slug>/trail.db` — that's the single-tenant local-dev case
 * where TRAIL_DB_PATH points somewhere arbitrary like
 * `/Users/cb/Apps/broberg/trail/data/trail.db`.
 */
export function inferPrimarySlug(dbPath: string): string {
  const filename = basename(dbPath);
  if (filename !== 'trail.db') return 'default';
  const parentDir = basename(dirname(dbPath));
  if (!parentDir || parentDir === 'data') return 'default';
  return parentDir;
}

export interface OpenTenantPoolArgs {
  primarySlug: string;
  primaryDb: TrailDatabase;
  /** Hook for per-tenant boot work (migrations, initFTS, ensureIngestUser…)
   * applied to each NEWLY-opened secondary tenant DB. The primary is
   * already booted by the caller — we only run this for secondaries. */
  bootSecondary: (slug: string, db: TrailDatabase) => Promise<void>;
}

/**
 * Build the tenant pool. Always includes the primary; includes
 * secondaries only when TRAIL_MULTI_TENANT === '1'.
 *
 * With the flag OFF the engine behaves identically to F40.1: one DB
 * in the pool, all bootstrap on the primary. Sanne's API output is
 * byte-for-byte unchanged.
 */
export async function openTenantPool(args: OpenTenantPoolArgs): Promise<TenantPool> {
  const pool: TenantPool = new Map();
  pool.set(args.primarySlug, args.primaryDb);

  const multiTenant = process.env.TRAIL_MULTI_TENANT === '1';
  if (!multiTenant) {
    return pool;
  }

  const slugs = discoverTenantSlugs();
  for (const slug of slugs) {
    if (pool.has(slug)) continue; // primary already opened
    const path = join(DATA_DIR, slug, 'trail.db');
    if (!existsSync(path)) continue;
    console.log(`[multi-tenant] opening secondary tenant DB: ${slug}`);
    const db = await createLibsqlDatabase({ path });
    await args.bootSecondary(slug, db);
    pool.set(slug, db);
  }

  console.log(
    `[multi-tenant] pool ready with ${pool.size} tenants: ${[...pool.keys()].join(', ')}`,
  );
  return pool;
}


/**
 * F210.2 — create a brand-new tenant on disk and add it to the LIVE pool.
 *
 * Creates `/data/<slug>/`, opens `trail.db`, runs the caller's boot sequence
 * against it (migrations + FTS + the one-shots a tenant gets at startup), and
 * only then publishes it into the pool.
 *
 * `pool.set` happens LAST on purpose: a request that arrives mid-provision
 * must not find a half-migrated database. Until the last line, the slug simply
 * does not resolve, which the auth middleware already treats as 401 — the same
 * answer it gave before this function existed.
 *
 * Refuses an existing directory rather than adopting it. Adopting would mean a
 * typo'd slug could silently attach a customer to another customer's data.
 */
export async function provisionTenant(args: {
  pool: TenantPool;
  slug: string;
  boot: (db: TrailDatabase) => Promise<void>;
  /**
   * F210.5 — seed the new database so the tenant is USABLE, not merely
   * present.
   *
   * Without this the engine created a fully-migrated 44-table database with
   * an empty `tenants` table and an empty `api_keys` table, and the control
   * plane minted a bearer the engine had never heard of. Every request then
   * answered "Invalid or revoked API key" — measured on prod 2026-08-28,
   * reported by the owner the moment he opened the customer he had just
   * created. A tenant that exists and cannot be reached is worse than one
   * that failed to create, because the failure surfaces later and somewhere
   * else.
   *
   * Runs AFTER boot (which migrates) and BEFORE the pool insert, so the
   * tenant only goes live once it can actually answer.
   */
  seed?: (db: TrailDatabase) => Promise<void>;
}): Promise<{ slug: string; path: string }> {
  const { pool, slug, boot } = args;

  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`invalid tenant slug: ${slug}`);
  }
  if (pool.has(slug)) {
    throw new Error(`tenant already live: ${slug}`);
  }

  const dir = join(DATA_DIR, slug);
  if (existsSync(dir)) {
    throw new Error(`data directory already exists: ${dir}`);
  }

  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'trail.db');

  const db = await createLibsqlDatabase({ path });
  await boot(db);
  if (args.seed) await args.seed(db);

  pool.set(slug, db);
  console.log(`[multi-tenant] provisioned ${slug} → live in pool (${pool.size} tenants)`);

  return { slug, path };
}
