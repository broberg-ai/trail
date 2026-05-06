import { createClient, type Client as LibSqlClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { mkdirSync } from 'node:fs';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrationsByHash } from './migrate-runner.js';
import * as schema from './schema.js';
import type {
  TrailDatabase,
  DatabaseConfig,
  ExecuteResult,
  DocumentSearchHit,
  ChunkSearchHit,
  SqlArg,
} from './interface.js';
import { initFTS as installFts } from './fts.js';
import {
  searchDocuments as searchDocs,
  searchChunks as searchChks,
  searchUserNotes as searchUsrNotes,
} from './search.js';

/**
 * libSQL-backed TrailDatabase — default implementation for F40.1.
 *
 * Opens a local `.db` file via the libSQL embedded client. Sets standard
 * pragmas (WAL + foreign keys + busy timeout) on open. Idempotent
 * migration + FTS initialisation. No module-level side effects — the
 * adapter is only created when a caller invokes `createLibsqlDatabase`.
 */
export class LibsqlTrailDatabase implements TrailDatabase {
  readonly db: ReturnType<typeof drizzle<typeof schema>>;
  readonly tenantId: string;
  readonly path: string;
  private readonly client: LibSqlClient;
  private closed = false;

  constructor(private readonly config: DatabaseConfig, client: LibSqlClient) {
    this.client = client;
    this.db = drizzle(client, { schema });
    this.tenantId = config.tenantId ?? 'default';
    this.path = config.path;
  }

  /**
   * F153 — escape hatch for the backup primitive (`snapshotDb`) and any
   * other code that legitimately needs the underlying libSQL client
   * (e.g. `VACUUM INTO`, which has no Drizzle equivalent). Callers must
   * narrow to `LibsqlTrailDatabase` explicitly so the interface contract
   * stays clean — generic `TrailDatabase` consumers still cannot reach
   * the driver through the interface.
   */
  get sqliteClient(): LibSqlClient {
    this.assertOpen();
    return this.client;
  }

  async execute(sql: string, args: ReadonlyArray<SqlArg> = []): Promise<ExecuteResult> {
    this.assertOpen();
    const result = await this.client.execute({ sql, args: args as SqlArg[] });
    return {
      rows: result.rows.map((r) => ({ ...r })),
      rowsAffected: result.rowsAffected,
    };
  }

  async runMigrations(): Promise<void> {
    this.assertOpen();
    const here = dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = join(here, '..', 'drizzle');
    // Hash-based runner — see migrate-runner.ts for why drizzle's stock
    // libsql migrator was replaced (timestamp-ordering bug + whole-file
    // execute bug both bit us in April 2026).
    await runMigrationsByHash(this.client, migrationsFolder);
  }

  async initFTS(): Promise<void> {
    this.assertOpen();
    await installFts(this.client);
  }

  async searchDocuments(
    query: string,
    kbId: string,
    tenantId: string,
    limit = 10,
  ): Promise<DocumentSearchHit[]> {
    this.assertOpen();
    return searchDocs(this.client, query, kbId, tenantId, limit);
  }

  async searchChunks(
    query: string,
    kbId: string,
    tenantId: string,
    limit = 10,
  ): Promise<ChunkSearchHit[]> {
    this.assertOpen();
    return searchChks(this.client, query, kbId, tenantId, limit);
  }

  async searchUserNotes(
    query: string,
    kbId: string,
    tenantId: string,
    limit = 10,
  ): Promise<Array<DocumentSearchHit & { userNote: string }>> {
    this.assertOpen();
    return searchUsrNotes(this.client, query, kbId, tenantId, limit);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.client.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error(`TrailDatabase(${this.tenantId}) has been closed`);
    }
  }
}

/**
 * Create and prepare a libSQL-backed TrailDatabase.
 *
 * Side effects:
 *   - Ensures the parent directory exists (mkdirSync -p semantics).
 *   - Sets WAL journal mode, foreign keys, and a 5s busy timeout.
 *
 * Does NOT run migrations or install FTS — callers do that explicitly
 * via `runMigrations()` + `initFTS()` so the order is visible and the
 * shutdown path is symmetrical.
 */
export async function createLibsqlDatabase(config: DatabaseConfig): Promise<TrailDatabase> {
  const absPath = isAbsolute(config.path) ? config.path : resolve(config.path);
  mkdirSync(dirname(absPath), { recursive: true });

  const client = createClient({
    url: `file:${absPath}`,
    authToken: config.authToken,
  });

  // Standard production pragmas. Run them serially and await each so a
  // failure on the first (e.g. locked DB) surfaces cleanly instead of
  // being buried behind a later statement.
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA foreign_keys = ON');
  // 2026-05-06: bumped 5s → 15s after F164 jobs runner tick was
  // hitting SQLITE_BUSY under load + crashing the engine. The chat
  // path also reads document tables that the lint/access trackers
  // write to; 15s gives slow writers room to commit before BUSY
  // bubbles. Combined with the runner's catch-and-log retry, this
  // turns transient contention into noise rather than 500s.
  await client.execute('PRAGMA busy_timeout = 15000');

  return new LibsqlTrailDatabase({ ...config, path: absPath }, client);
}
