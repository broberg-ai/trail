/**
 * F222.8 — the walk must see EVERY row, and must fail loudly rather than
 * quietly short.
 *
 * The assertion that carries the card is the first one: a paginated scan that
 * returns fewer rows than the `.all()` it replaced is not a fix, it is a
 * silent hole — and it would look exactly like success at every call site.
 */
import { test, expect } from 'bun:test';
import { scanPaged, collectPaged, isResponseTooLarge } from './paged-scan.js';

interface Row {
  id: string;
  content: string;
}

/** A fake table of `n` rows, ordered by id, served through a cursor. */
function table(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i).padStart(6, '0'),
    content: `row-${i}`,
  }));
}

function pageFetcher(rows: Row[], onFetch?: (limit: number) => void) {
  return async (cursor: string | null, limit: number): Promise<Row[]> => {
    onFetch?.(limit);
    const start = cursor === null ? 0 : rows.findIndex((r) => r.id === cursor) + 1;
    return rows.slice(start, start + limit);
  };
}

test('SER HVER ENESTE RÆKKE — en scanning der taber rækker er et tavst hul', async () => {
  const rows = table(1234);
  const got = await collectPaged(pageFetcher(rows), (r) => r.id, { pageSize: 100 });

  expect(got.length).toBe(1234);
  // Not just the count: the same rows, in the same order. A count match does
  // not prove the rows are the same rows.
  expect(got.map((r) => r.id)).toEqual(rows.map((r) => r.id));
});

test('en tom tabel giver nul sider og ingen fejl', async () => {
  const got = await collectPaged(pageFetcher([]), (r) => r.id);
  expect(got).toEqual([]);
});

test('en tabel mindre end én side hentes i ét hug', async () => {
  const limits: number[] = [];
  const got = await collectPaged(pageFetcher(table(7), (l) => limits.push(l)), (r) => r.id, {
    pageSize: 100,
  });
  expect(got.length).toBe(7);
  expect(limits.length).toBe(1); // no needless second round-trip
});

test('HALVERER siden når sqld afviser, og kommer igennem alligevel', async () => {
  const rows = table(300);
  const tried: number[] = [];
  const fetch = async (cursor: string | null, limit: number): Promise<Row[]> => {
    tried.push(limit);
    // The driver refuses anything above 50 rows, whatever we ask for.
    if (limit > 50) throw new Error('RESPONSE_TOO_LARGE: Response is too large');
    const start = cursor === null ? 0 : rows.findIndex((r) => r.id === cursor) + 1;
    return rows.slice(start, start + limit);
  };

  const got = await collectPaged(fetch, (r) => r.id, { pageSize: 400 });

  expect(got.length).toBe(300);
  // It walked DOWN to a size that fits rather than giving up or guessing.
  expect(tried.slice(0, 4)).toEqual([400, 200, 100, 50]);
});

test('EN ENKELT for stor række fejler MED en forklaring — den hænger ikke', async () => {
  // Halving cannot divide one row. Looping here would be a hang, and a hang
  // is worse than a failure that says why.
  const fetch = async (): Promise<Row[]> => {
    throw new Error('RESPONSE_TOO_LARGE: Response is too large');
  };
  expect(collectPaged(fetch, (r) => r.id, { pageSize: 1 })).rejects.toThrow(/SINGLE row/);
});

test('en anden slags fejl videresendes uændret — vagten sluger ingenting', async () => {
  const fetch = async (): Promise<Row[]> => {
    throw new Error('SQLITE_BUSY: database is locked');
  };
  expect(collectPaged(fetch, (r) => r.id)).rejects.toThrow(/SQLITE_BUSY/);
});

test('en markør der ikke rykker sig fejler HØJT i stedet for at køre evigt', async () => {
  const rows = table(10);
  // cursorOf returns a constant — the classic pagination bug.
  expect(collectPaged(pageFetcher(rows), () => 'stuck', { pageSize: 2 })).rejects.toThrow(
    /did not advance/,
  );
});

test('side-loftet fanger en markør-fejl frem for at løbe uendeligt', async () => {
  // Always returns a full page with an ever-advancing id, so the walk never
  // ends on its own.
  let n = 0;
  const fetch = async (_c: string | null, limit: number): Promise<Row[]> =>
    Array.from({ length: limit }, () => ({ id: String(n++), content: 'x' }));
  expect(collectPaged(fetch, (r) => r.id, { pageSize: 2, maxPages: 5 })).rejects.toThrow(
    /exceeded 5 pages/,
  );
});

test('scanPaged leverer SIDER, så en kalder kan smide dem væk undervejs', async () => {
  const sizes: number[] = [];
  for await (const page of scanPaged(pageFetcher(table(250)), (r) => r.id, { pageSize: 100 })) {
    sizes.push(page.length);
  }
  expect(sizes).toEqual([100, 100, 50]);
});

test('kun sqld-afvisningen genkendes som for-stor', () => {
  expect(isResponseTooLarge(new Error('RESPONSE_TOO_LARGE: Response is too large'))).toBe(true);
  expect(isResponseTooLarge(new Error('SQLITE_BUSY'))).toBe(false);
});
