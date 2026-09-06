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
import { createClient } from '@libsql/client';
import { createLibsqlDatabase, LibsqlTrailDatabase, type TrailDatabase } from '@trail/db';

export type TenantPool = Map<string, TrailDatabase>;

const DATA_DIR = process.env.TRAIL_DATA_DIR ?? '/data';

/**
 * F222.3 — remote tenant DBs on the dedicated DB machine (sqld).
 *
 * TRAIL_DB_REMOTE is an EXPLICIT per-tenant flag, never inferred:
 * `{"fd-aalborg":"http://trail-db-001.internal:6001"}`. A slug listed
 * here is served from sqld at that URL; its auth token comes from
 * TRAIL_DB_TOKEN_<SLUG> (slug uppercased, `-` → `_`). The F222.1
 * lesson applies verbatim: secrets can land on a machine before the
 * data has moved, so presence of a token must never flip serving —
 * only this map does.
 */
export function remoteTenantConfig(): Record<string, string> {
  const raw = process.env.TRAIL_DB_REMOTE;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    // A malformed map must be LOUD, not an empty fallback: an engine that
    // silently opens the on-disk copy after the file was deleted would
    // recreate empty DBs and serve a blank tenant.
    throw new Error(`TRAIL_DB_REMOTE is not valid JSON: ${raw.slice(0, 80)}`);
  }
}

function remoteTokenFor(slug: string): string | undefined {
  return process.env[`TRAIL_DB_TOKEN_${slug.toUpperCase().replace(/-/g, '_')}`];
}

/**
 * Open a tenant DB on the remote sqld — and REFUSE to serve unless the
 * migration marker proves the copy is complete (card constraint: "the
 * engine must refuse to start against a tenant whose migration is
 * incomplete, rather than serving a partial database"). The marker row
 * is written by the migration script ONLY after per-table row counts
 * and FTS parity have been verified against the source.
 */
export async function openRemoteTenantDb(slug: string, url: string): Promise<TrailDatabase> {
  const client = createClient({ url, authToken: remoteTokenFor(slug) });
  const db = new LibsqlTrailDatabase({ path: url, tenantId: slug }, client);
  await assertMigrationComplete(db, slug);
  return db;
}

export async function assertMigrationComplete(db: TrailDatabase, slug: string): Promise<void> {
  let row: { completed_at?: unknown } | undefined;
  try {
    const res = await db.execute(
      `SELECT completed_at FROM trail_migration WHERE tenant_slug = ?`,
      [slug],
    );
    row = res.rows[0] as { completed_at?: unknown } | undefined;
  } catch {
    // Missing table counts as missing marker — fail closed below.
  }
  if (!row?.completed_at) {
    throw new Error(
      `[F222.3] tenant "${slug}" is configured remote but the sqld database carries no ` +
        `completed migration marker — refusing to serve a possibly-partial database. ` +
        `Run the migration to completion (it writes trail_migration) or remove the slug ` +
        `from TRAIL_DB_REMOTE to serve the on-disk copy again.`,
    );
  }
}

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
 * F259.4 — HVOR LÆNGE VI VENTER PÅ ÉN KUNDES BASE.
 *
 * Målt 6/9: broberg-ais sqld tog imod LÆSNINGER (0,2–8s) men svarede aldrig på
 * en SKRIVNING — heller ikke `CREATE TABLE IF NOT EXISTS` på en tom tabel.
 * Klientens egen frist er ~285s, og indtil den udløb ventede opstarten. Tre
 * kunder stod stille mens én base tav.
 *
 * 45 sekunder er rigeligt til en rask base (de to sunde brugte under ét
 * sekund) og kort nok til at en syg base ikke er en nedetid for de andre.
 */
const BOOT_FRIST_MS = 45_000;

/**
 * Vent højst `ms` på `fn`. Det underliggende kald ANNULLERES IKKE — libsql
 * giver os ingen måde at afbryde en igangværende forespørgsel — så det kører
 * videre og afvises senere. Det er netop dét F258's proces-vagt fanger; uden
 * den ville en forsinket afvisning her lukke motoren.
 */
export async function medFrist<T>(ms: number, navn: string, fn: () => Promise<T>): Promise<T> {
  let ur: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, afvis) => {
        ur = setTimeout(() => afvis(new Error(`frist på ${ms / 1000}s udløb — ${navn}`)), ms);
      }),
    ]);
  } finally {
    if (ur) clearTimeout(ur);
  }
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

  // F222.3 — remote-configured tenants open against sqld, and their slug
  // may have NO directory under /data at all (the file is deleted after a
  // proven migration), so they are opened from the map, not from disk
  // discovery. A remote open that fails (marker missing, sqld down) must
  // fail the BOOT, not fall back to a stale/absent file.
  const remote = remoteTenantConfig();
  for (const [slug, url] of Object.entries(remote)) {
    if (pool.has(slug)) continue; // primary handled by the caller
    console.log(`[multi-tenant] opening REMOTE tenant DB: ${slug} → ${url}`);
    try {
      const db = await medFrist(BOOT_FRIST_MS, `${slug}: åbn + klargør`, async () => {
        const d = await openRemoteTenantDb(slug, url);
        await args.bootSecondary(slug, d);
        return d;
      });
      pool.set(slug, db);
    } catch (err) {
      console.error(
        `[multi-tenant] KUNDE UDE AF DRIFT: ${slug} — ${err instanceof Error ? err.message : err}\n` +
          `  Motoren betjener de øvrige kunder videre. Kald til ${slug} svarer 401 ` +
          `(manglende slug i puljen), ALDRIG en anden kundes data.`,
      );
    }
  }

  const slugs = discoverTenantSlugs();
  for (const slug of slugs) {
    if (pool.has(slug)) continue; // primary already opened
    if (remote[slug]) continue; // remote wins over a lingering on-disk copy
    const path = join(DATA_DIR, slug, 'trail.db');
    if (!existsSync(path)) continue;
    console.log(`[multi-tenant] opening secondary tenant DB: ${slug}`);
    try {
      const db = await medFrist(BOOT_FRIST_MS, `${slug}: åbn + klargør`, async () => {
        const d = await createLibsqlDatabase({ path });
        await args.bootSecondary(slug, d);
        return d;
      });
      pool.set(slug, db);
    } catch (err) {
      console.error(
        `[multi-tenant] KUNDE UDE AF DRIFT: ${slug} — ${err instanceof Error ? err.message : err}`,
      );
    }
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
