/**
 * F222.8 — walk a whole knowledge base without asking sqld for it in one go.
 *
 * WHY A CALLBACK RATHER THAN A QUERY BUILDER. The seven call sites select
 * different columns and filter differently; a generic builder would have to
 * guess both, and guessing is what this card has spent its time undoing. So
 * each call site keeps its own `select` and `where` verbatim and supplies one
 * page; this owns the loop, the page size, and the safety rails. The cursor
 * column is explicit at each site for the same reason — nothing here can know
 * which column gives a stable total order over someone else's query.
 *
 * WHY IT ADAPTS INSTEAD OF PICKING A NUMBER. sqld's limit is on BYTES
 * (measured on trail-db-001, sqld 0.24.33: `--max-response-size [default:
 * 10MB]`), and a page size is a ROW count. There is no row count that is
 * right for both a KB of one-line glossary entries and a KB of long Neurons,
 * so any fixed number is wrong for somebody — and wrong silently, on a data
 * volume, which is the exact failure mode F222.8 exists for. Instead the walk
 * starts optimistic and HALVES on a too-large response until the page fits.
 *
 * THE ONE CASE IT CANNOT SOLVE, said here rather than discovered later: a
 * SINGLE row larger than the limit. No page size divides that. It surfaces as
 * an error naming the row, because the alternative — halving to zero and
 * looping — is a hang, and a hang is worse than a failure that says why.
 */

/** sqld's default per-response cap on trail-db-001. */
export const SQLD_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Optimistic first page. Deliberately not tuned: the halving below is what
 * makes the walk correct, so this only decides how many round-trips a big-row
 * KB pays before it settles.
 */
export const DEFAULT_PAGE_SIZE = 500;

/** Below this a page is not worth halving again — see the single-row note. */
const MIN_PAGE_SIZE = 1;

export interface PagedScanOptions {
  /** Rows in the first page. Default 500; halves on a too-large response. */
  pageSize?: number;
  /**
   * Hard ceiling on pages, so a cursor bug is a loud failure rather than a
   * process that never returns. 10_000 pages × 500 rows is far beyond any
   * real KB; reaching it means the cursor stopped advancing.
   */
  maxPages?: number;
}

/** True when the driver refused because the response exceeded the cap. */
export function isResponseTooLarge(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /RESPONSE_TOO_LARGE|response is too large/i.test(msg);
}

/**
 * Fetch one page: the rows AFTER `cursor`, at most `limit` of them, in a
 * stable total order.
 *
 * Returning fewer than `limit` rows ENDS the walk, so the callback must not
 * apply its own extra filtering after the limit — that would truncate the
 * scan silently, which is precisely the "quiet hole" the card forbids. Filter
 * inside the query, or filter the assembled result afterwards.
 */
export type FetchPage<Row> = (cursor: string | null, limit: number) => Promise<Row[]>;

/**
 * Yield a knowledge base's rows page by page.
 *
 * The caller decides what to do with each page — accumulate it (same
 * behaviour as the `.all()` it replaces) or process and discard it (lower
 * peak memory). Both are correct; what changes is that no SINGLE request asks
 * sqld for more than one page.
 */
export async function* scanPaged<Row>(
  fetchPage: FetchPage<Row>,
  cursorOf: (row: Row) => string,
  opts: PagedScanOptions = {},
): AsyncGenerator<Row[], void, undefined> {
  let pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? 10_000;

  let cursor: string | null = null;
  let pages = 0;

  while (true) {
    if (++pages > maxPages) {
      throw new Error(
        `[F222.8] paged scan exceeded ${maxPages} pages — the cursor is not advancing. ` +
          `Last cursor: ${cursor ?? '<start>'}`,
      );
    }

    let rows: Row[];
    try {
      rows = await fetchPage(cursor, pageSize);
    } catch (err) {
      if (!isResponseTooLarge(err)) throw err;
      if (pageSize <= MIN_PAGE_SIZE) {
        // One row on its own is over the cap. Halving cannot help, and
        // looping here would hang instead of reporting.
        throw new Error(
          `[F222.8] a SINGLE row exceeds sqld's ${
            SQLD_MAX_RESPONSE_BYTES / 1024 / 1024
          }MB response limit — paging cannot fix this one. ` +
            `Cursor: ${cursor ?? '<start>'}. The row itself has to get smaller ` +
            `(or be fetched without its large column).`,
          { cause: err },
        );
      }
      pageSize = Math.max(MIN_PAGE_SIZE, Math.floor(pageSize / 2));
      pages--; // the failed attempt is a retry, not a page
      continue;
    }

    if (rows.length === 0) return;
    yield rows;
    if (rows.length < pageSize) return;

    const last = rows[rows.length - 1];
    const next = last === undefined ? null : cursorOf(last);
    if (next === null || next === cursor) {
      throw new Error(
        `[F222.8] paged scan cursor did not advance past ${cursor ?? '<start>'} — ` +
          `cursorOf must return a value that is unique and ordered.`,
      );
    }
    cursor = next;
  }
}

/**
 * The whole scan as one array — a drop-in for the `.all()` it replaces.
 *
 * Peak memory is unchanged; what changes is that no single REQUEST is
 * oversized, which is the thing sqld refuses. Prefer iterating `scanPaged`
 * where the caller can process a page and drop it.
 */
export async function collectPaged<Row>(
  fetchPage: FetchPage<Row>,
  cursorOf: (row: Row) => string,
  opts: PagedScanOptions = {},
): Promise<Row[]> {
  const out: Row[] = [];
  for await (const page of scanPaged(fetchPage, cursorOf, opts)) out.push(...page);
  return out;
}
