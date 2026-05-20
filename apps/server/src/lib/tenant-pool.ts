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
 * Hot-add (a new tenant directory appearing at runtime) is OUT OF
 * SCOPE for F40.2a. F40.2b adds provisioning endpoints that mutate
 * the pool. For now the pool is frozen at boot.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
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
