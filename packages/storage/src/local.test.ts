/**
 * F230.1 — list() must answer the same thing for "a/b" and "a/b/".
 *
 * That single claim is the whole bug: it could not be true before, and 212 of
 * Sanne's images were unreachable because of it. Everything else here guards
 * the ways a fix could be wrong in the other direction — stripping too much,
 * or breaking the ordinary no-trailing-slash caller that always worked.
 */
import { expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { LocalStorage } from './local.js';

const ROOT = '/tmp/f230-storage-test';

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(`${ROOT}/t1/kb1/doc1/images`, { recursive: true });
  writeFileSync(`${ROOT}/t1/kb1/doc1/images/page-1-img-1.png`, 'x');
  writeFileSync(`${ROOT}/t1/kb1/doc1/images/page-2-img-1.png`, 'y');
});
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const s = () => new LocalStorage(ROOT);

test('THE BUG — a trailing slash gives the SAME keys as none', async () => {
  const withSlash = await s().list('t1/kb1/doc1/images/');
  const without = await s().list('t1/kb1/doc1/images');
  expect(withSlash.sort()).toEqual(without.sort());
});

test('no key contains a double slash, whatever the caller passes', async () => {
  for (const p of ['t1/kb1/doc1/images', 't1/kb1/doc1/images/', 't1/kb1/doc1/images///']) {
    const keys = await s().list(p);
    expect(keys.length).toBe(2);
    for (const k of keys) expect(k.includes('//')).toBe(false);
  }
});

test('the derived filename has no leading slash — the exact symptom', async () => {
  // This is what the F161 backfill does: slice the prefix off the key. With a
  // trailing-slash prefix it used to leave "/page-1-img-1.png".
  const prefix = 't1/kb1/doc1/images/';
  const keys = await s().list(prefix);
  for (const k of keys) {
    const filename = k.slice(prefix.length);
    expect(filename.startsWith('/')).toBe(false);
    expect(filename).toMatch(/^page-\d+-img-\d+\.png$/);
  }
});

test('NEGATIVE CONTROL — the keys are still fully qualified, not truncated', async () => {
  // A fix that stripped too much would also make every test above pass while
  // returning bare filenames that no longer address the file.
  const keys = await s().list('t1/kb1/doc1/images');
  expect(keys.sort()).toEqual([
    't1/kb1/doc1/images/page-1-img-1.png',
    't1/kb1/doc1/images/page-2-img-1.png',
  ]);
});

test('and the keys still RESOLVE — get() returns the bytes', async () => {
  // The claim that matters to a reader: the key can be used, not merely that
  // it looks tidy.
  for (const k of await s().list('t1/kb1/doc1/images/')) {
    expect(await s().get(k)).not.toBeNull();
  }
});

test('nested directories keep their path', async () => {
  mkdirSync(`${ROOT}/t1/kb1/doc1/images/sub`, { recursive: true });
  writeFileSync(`${ROOT}/t1/kb1/doc1/images/sub/deep.png`, 'z');
  const keys = await s().list('t1/kb1/doc1/images/');
  expect(keys).toContain('t1/kb1/doc1/images/sub/deep.png');
  rmSync(`${ROOT}/t1/kb1/doc1/images/sub`, { recursive: true });
});
