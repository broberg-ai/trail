/**
 * F222.8 — the runtime guard measures the response, not the source text.
 *
 * The assertion that matters most is the SECOND DOOR one: Drizzle must be
 * covered by the same measurement as a raw `execute`. Both go through the same
 * `client`, so wrapping the client covers both — but "I reasoned that it does"
 * and "I watched it fire" are different claims, and only the second one
 * survives someone rearranging the adapter later.
 */
import { test, expect } from 'bun:test';
import type { Client as LibSqlClient, ResultSet } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import {
  withResponseSizeGuard,
  SQLD_MAX_RESPONSE_BYTES,
  type OversizedResponse,
} from './response-size-guard.js';

/** A row heavy enough that 300 of them comfortably clear the warn threshold. */
const FAT = 'x'.repeat(40_000);

function fakeClient(rowCount: number, cell: string = FAT): LibSqlClient {
  const rows = Array.from({ length: rowCount }, (_, i) => ({ id: i, content: cell }));
  const result = { rows, columns: [], rowsAffected: 0, lastInsertRowid: undefined } as unknown as ResultSet;
  return {
    execute: async () => result,
    batch: async (stmts: unknown[]) => stmts.map(() => result),
    close: () => {},
  } as unknown as LibSqlClient;
}

function collect() {
  const seen: OversizedResponse[] = [];
  return { seen, onOversized: (i: OversizedResponse) => seen.push(i) };
}

test('en LILLE svarmængde udløser ingenting — ellers ville vagten larme på alt', async () => {
  const { seen, onOversized } = collect();
  const guarded = withResponseSizeGuard(fakeClient(10), { onOversized });
  await guarded.execute('SELECT 1');
  expect(seen.length).toBe(0);
});

test('et svar TÆT PÅ sqld-grænsen rapporteres — med SQL og kaldested', async () => {
  const { seen, onOversized } = collect();
  const guarded = withResponseSizeGuard(fakeClient(300), { onOversized });

  await guarded.execute('SELECT id, content FROM documents WHERE knowledge_base_id = ?');

  expect(seen.length).toBe(1);
  const hit = seen[0]!;
  expect(hit.rows).toBe(300);
  expect(hit.bytes).toBeGreaterThan(SQLD_MAX_RESPONSE_BYTES * 0.6);
  expect(hit.sql).toContain('FROM documents');
  // The call site is the entire reason this exists in production: the error
  // board shows only `mapHranaError` in @libsql/client, which is true of every
  // such failure and so identifies none of them.
  expect(hit.callSite).toContain('response-size-guard.test');
  expect(hit.callSite).not.toContain('node_modules');
});

test('ANDEN DØR: drizzle er dækket af samme måling som rå execute', async () => {
  const { seen, onOversized } = collect();
  const guarded = withResponseSizeGuard(fakeClient(300), { onOversized });

  // Drizzle is constructed OVER the wrapper, exactly as LibsqlTrailDatabase
  // does it. If wrapping the client missed this path, every `db.select(...)`
  // in the codebase would be unmeasured while the guard still looked present.
  const db = drizzle(guarded);
  await db.run(sql`SELECT id, content FROM documents`);

  expect(seen.length).toBe(1);
  expect(seen[0]!.rows).toBe(300);
});

test('I PRØVER kaster den; I DRIFT gør den ikke — og det er designet', async () => {
  const guardedThrows = withResponseSizeGuard(fakeClient(300), {
    onOversized: () => {},
    throwOnOversized: true,
  });
  expect(guardedThrows.execute('SELECT id, content FROM documents')).rejects.toThrow(/F222\.8/);

  // sqld already fails the request at its own 10MB limit. A guard that threw
  // in production too would turn a slow query into a second outage while
  // adding nothing — what production lacks is the call site, not a failure.
  const { seen, onOversized } = collect();
  const guardedReports = withResponseSizeGuard(fakeClient(300), { onOversized });
  await guardedReports.execute('SELECT id, content FROM documents');
  expect(seen.length).toBe(1);
});

test('batch måles pr. sætning, ikke kun den første', async () => {
  const { seen, onOversized } = collect();
  const guarded = withResponseSizeGuard(fakeClient(300), { onOversized });
  await guarded.batch(['SELECT a', 'SELECT b']);
  expect(seen.length).toBe(2);
  expect(seen.map((s) => s.sql)).toEqual(['SELECT a', 'SELECT b']);
});

test('estimatet må ikke skride NEDAD på en værdi der ikke kan serialiseres', async () => {
  // Downward bias is the dangerous direction: it hides a real oversized
  // response. A circular value must still be charged for the bytes it
  // occupied on the wire.
  const circular: Record<string, unknown> = { id: 1 };
  circular.self = circular;
  const rows = Array.from({ length: 300 }, () => circular);
  const client = {
    execute: async () => ({ rows, columns: [], rowsAffected: 0 }) as unknown as ResultSet,
    close: () => {},
  } as unknown as LibSqlClient;

  const { seen, onOversized } = collect();
  // A tiny threshold, because the nominal charge per unserializable row is
  // deliberately small — the assertion is that it is NOT ZERO.
  await withResponseSizeGuard(client, { onOversized, warnBytes: 1 }).execute('SELECT *');
  expect(seen.length).toBe(1);
  expect(seen[0]!.bytes).toBeGreaterThan(0);
});

test('alt andet end forespørgsler går uændret igennem', async () => {
  let closed = false;
  const client = {
    execute: async () => ({ rows: [], columns: [], rowsAffected: 0 }) as unknown as ResultSet,
    close: () => {
      closed = true;
    },
  } as unknown as LibSqlClient;
  withResponseSizeGuard(client, { onOversized: () => {} }).close();
  expect(closed).toBe(true);
});
