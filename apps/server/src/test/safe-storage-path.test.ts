/**
 * F232.2 — the row says WHERE INSIDE the tenant, never whether it is inside.
 *
 * storage_path is a column, and a column is data. Trusting it verbatim would
 * turn any write reaching that column into a read of any file the process can
 * see. These tests are written against the two ways that goes wrong:
 * escaping the tenant, and degrading a working image into a 404 because the
 * column happened to be empty.
 */
import { expect, test } from 'bun:test';
import { safeStoragePath } from '../routes/images.js';

const T = 't-sanne';
const COMPUTED = 't-sanne/kb1/doc1/images/page-1.png';

test('a stored path inside the tenant is used', () => {
  const stored = 't-sanne/kb1/doc1/images-pending/page-1.png';
  expect(safeStoragePath(stored, T, COMPUTED)).toBe(stored);
});

test('NEGATIV KONTROL — no stored path falls back to the computed one', () => {
  // A legacy file with no row must keep working. Failing closed here would
  // turn a working image into a 404 for every pre-F161 upload.
  expect(safeStoragePath(null, T, COMPUTED)).toBe(COMPUTED);
  expect(safeStoragePath(undefined, T, COMPUTED)).toBe(COMPUTED);
  expect(safeStoragePath('', T, COMPUTED)).toBe(COMPUTED);
});

test('a path escaping the tenant is refused, not followed', () => {
  for (const evil of [
    '../../../etc/passwd',
    't-sanne/../t-other/kb1/doc1/images/secret.png',
    't-other/kb1/doc1/images/secret.png',
    '/etc/passwd',
    'kb1/doc1/images/page-1.png', // no tenant prefix at all
  ]) {
    expect(safeStoragePath(evil, T, COMPUTED)).toBe(COMPUTED);
  }
});

test('another tenant whose id STARTS WITH ours is not us', () => {
  // 't-sanne' vs 't-sanne-andersen': a prefix check without the slash would
  // hand one tenant the other's files, and both ids look plausible.
  expect(safeStoragePath('t-sanne-andersen/kb1/doc1/images/x.png', T, COMPUTED)).toBe(COMPUTED);
});

test('a doubled slash is normalised rather than refused — F230 rows still resolve', () => {
  // The 212 repaired rows are fine, but an unrepaired one must not 404 twice.
  expect(safeStoragePath('t-sanne/kb1/doc1/images//page-1.png', T, COMPUTED)).toBe(
    't-sanne/kb1/doc1/images/page-1.png',
  );
});
