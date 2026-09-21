import type { Client as LibSqlClient, InStatement, ResultSet } from '@libsql/client';

/**
 * F222.8 — measure what a query ACTUALLY returns, at the one place every
 * query passes.
 *
 * WHY THIS EXISTS RATHER THAN A SOURCE LINT. The card's plan proposed proving
 * the property by reading the source: no call site may select a whole KB's
 * text. Three attempts at that predicate were measured wrong (20 → 12 → 9
 * call sites), and each correction failed in BOTH directions — it counted
 * innocent queries and would have cleared a real one written with a variable
 * instead of a column name.
 *
 * The reason is not that the regex was sloppy. It is that **how many rows a
 * query returns is a property of the DATA, not of how the query is written.**
 * A source lint cannot answer it, and a lint that looks like it can is worse
 * than none.
 *
 * So this measures the response. It cannot be fooled by phrasing, it covers
 * raw SQL and Drizzle identically (both go through the same `client`), and it
 * catches the tenth call site nobody thought of.
 *
 * THE ASYMMETRY IS THE DESIGN, and it is deliberate:
 *
 *   in tests       THROW — a test that fetches a whole KB must go red.
 *   in production  REPORT — never throw.
 *
 * sqld already fails the request itself at its 10MB limit (measured on
 * trail-db-001, sqld 0.24.33: `--max-response-size [default: 10MB]`). A guard
 * that threw as well would turn a slow query into a second outage while
 * adding nothing. What production is missing is not another failure — it is
 * the ANSWER TO "WHICH CALL SITE". The RESPONSE_TOO_LARGE reports on the
 * error board carry only library frames (`@libsql/client/lib-esm/hrana.js`),
 * so F222.8 has "IKKE FASTSLÅET: hvilket af de kaldesteder der fyrede"
 * written on it. That is what this closes.
 */

/** Bytes. Matches sqld's own `--max-response-size` default on trail-db-001. */
export const SQLD_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Warn well before the wall. A response at 60% is not a fault today and is a
 * fault the week a customer's KB grows — which is exactly the failure mode
 * F222.8 describes: it arrives on a data volume, not on a commit.
 */
export const DEFAULT_WARN_BYTES = Math.floor(SQLD_MAX_RESPONSE_BYTES * 0.6);

/**
 * Counting rows is free; measuring bytes is not. Below this many rows a
 * response cannot plausibly approach 10MB, so we never pay for the estimate.
 * Above it, the query is already unusual enough to be worth measuring.
 */
const ROWS_BEFORE_MEASURING = 200;

export interface OversizedResponse {
  sql: string;
  rows: number;
  bytes: number;
  limitBytes: number;
  /** Where in OUR code the query was issued — the thing the error board lacks. */
  callSite: string;
}

export interface ResponseSizeGuardOptions {
  /** Report at this size. Default: 60% of sqld's limit. */
  warnBytes?: number;
  /** Called for every response at or above `warnBytes`. Must not throw in prod. */
  onOversized: (info: OversizedResponse) => void;
  /** true in tests: throw instead of reporting. Default false. */
  throwOnOversized?: boolean;
}

/**
 * Estimate a result set's serialized size.
 *
 * `JSON.stringify` on the whole thing would be exact and would also double the
 * memory of the very response we are worried about — on a 1GB machine, the
 * measurement would be the outage. So: measure a SAMPLE of rows and scale.
 *
 * The number is therefore an ESTIMATE and is named one everywhere it travels.
 * It is used to decide whether to speak, never to decide whether to fail, and
 * the exact limit is enforced by sqld regardless of what this returns.
 */
function estimateBytes(rows: readonly unknown[]): number {
  if (rows.length === 0) return 0;
  const sampleSize = Math.min(rows.length, 20);
  let sampled = 0;
  const step = Math.max(1, Math.floor(rows.length / sampleSize));
  let taken = 0;
  for (let i = 0; i < rows.length && taken < sampleSize; i += step) {
    try {
      sampled += JSON.stringify(rows[i] ?? null)?.length ?? 0;
    } catch {
      // A value that will not serialize still occupied bytes on the wire;
      // skipping it silently would bias the estimate DOWNWARD, which is the
      // direction that hides a problem. Charge a nominal cost instead.
      sampled += 64;
    }
    taken++;
  }
  return taken === 0 ? 0 : Math.round((sampled / taken) * rows.length);
}

/** This module's own path, so its frames can be skipped without a name match. */
const SELF = new URL(import.meta.url).pathname;

/**
 * The first stack frame outside node_modules and outside this file.
 *
 * This is the whole point of the guard in production: the error board's
 * grouping shows `mapHranaError` in `@libsql/client`, which is true of every
 * such failure and therefore identifies none of them.
 *
 * CALLED SYNCHRONOUSLY, before the `await`. My first note here claimed the
 * caller's frames are GONE after an await. MEASURED in bun 1.3.14, and that
 * was wrong — the caller survives, as `at async theCaller`; only the
 * top-level frame drops. The mutation agreed: moving the capture after the
 * await left all seven tests green.
 *
 * It stays synchronous anyway, for the reason that IS true: it costs nothing,
 * it keeps the full frame list, and it does not depend on a runtime choosing
 * to preserve async stacks. But no test protects that ordering, and saying so
 * is the point — an unproven "MUST" in a comment is how the next person
 * inherits a rule nobody can justify.
 *
 * The exclusion matches this file's PATH, not the string
 * "response-size-guard". Matching by name also excluded the test file, and
 * the first version of this guard reported `unknown` for that reason alone —
 * a field that was present, looked answered, and said nothing.
 */
function callerFrame(): string {
  const stack = new Error().stack ?? '';
  for (const raw of stack.split('\n').slice(1)) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    if (line.includes('node_modules')) continue;
    if (line.includes('node:internal')) continue;
    if (line.includes(SELF)) continue;
    return line.slice(3);
  }
  return 'unknown';
}

function sqlOf(stmt: InStatement): string {
  return typeof stmt === 'string' ? stmt : stmt.sql;
}

/**
 * Wrap a libSQL client so every response is measured.
 *
 * Returns a NEW object delegating to the original. Drizzle is constructed over
 * the wrapper, so `db.select(...)` is covered by the same measurement as a raw
 * `execute` — there is no second door.
 */
export function withResponseSizeGuard(
  client: LibSqlClient,
  opts: ResponseSizeGuardOptions,
): LibSqlClient {
  const warnBytes = opts.warnBytes ?? DEFAULT_WARN_BYTES;

  const check = (stmt: InStatement, result: ResultSet, callSite: string): void => {
    if (result.rows.length < ROWS_BEFORE_MEASURING) return;
    const bytes = estimateBytes(result.rows);
    if (bytes < warnBytes) return;

    const info: OversizedResponse = {
      sql: sqlOf(stmt).replace(/\s+/g, ' ').slice(0, 400),
      rows: result.rows.length,
      bytes,
      limitBytes: SQLD_MAX_RESPONSE_BYTES,
      callSite,
    };

    if (opts.throwOnOversized) {
      throw new Error(
        `[F222.8] a single query returned ~${(bytes / 1024 / 1024).toFixed(1)}MB in ` +
          `${info.rows} rows (sqld refuses at ${SQLD_MAX_RESPONSE_BYTES / 1024 / 1024}MB). ` +
          `Page it instead.\n  at ${info.callSite}\n  ${info.sql}`,
      );
    }
    opts.onOversized(info);
  };

  // Only the query-returning members are wrapped. Everything else is passed
  // straight through, so the wrapper cannot change behaviour it is not for.
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'execute') {
        return async (stmt: InStatement): Promise<ResultSet> => {
          // Captured BEFORE the await — see callerFrame's note.
          const callSite = callerFrame();
          const result = await target.execute(stmt);
          check(stmt, result, callSite);
          return result;
        };
      }
      if (prop === 'batch') {
        return async (stmts: InStatement[], mode?: Parameters<LibSqlClient['batch']>[1]) => {
          const callSite = callerFrame();
          const results = await target.batch(stmts, mode);
          results.forEach((r, i) => {
            const s = stmts[i];
            if (s !== undefined) check(s, r, callSite);
          });
          return results;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
