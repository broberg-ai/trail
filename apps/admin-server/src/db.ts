import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

/**
 * F33 control.db connection. Single libsql client per process, WAL
 * journaling + foreign keys ON. Volume is mounted by Fly at /data;
 * locally the path falls back to ./data/control.db for dev.
 */
const dbPath =
  process.env.TRAIL_ADMIN_CONTROL_DB
  ?? `${process.env.TRAIL_DATA_DIR ?? './data'}/control.db`;

export const client = createClient({ url: `file:${dbPath}` });

// Apply WAL + FK pragmas. libsql client persists settings per-connection.
await client.execute('PRAGMA journal_mode = WAL');
await client.execute('PRAGMA foreign_keys = ON');
await client.execute('PRAGMA busy_timeout = 5000');

export const db = drizzle(client, { schema });
export { schema };
