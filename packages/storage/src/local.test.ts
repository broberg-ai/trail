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

// F222.1 — statMany is the single sweep the KB-size panel rides on, and
// list() derives from it. The two must agree, and sizes must be the FILE's
// bytes, not a claim.
import { describe as d2, expect as e2, it as i2, beforeEach as b2 } from 'bun:test';
import { LocalStorage as LS2 } from './local.js';
import { mkdtempSync as mkd2 } from 'node:fs';
import { tmpdir as tmp2 } from 'node:os';
import { join as j2 } from 'node:path';

d2('LocalStorage.statMany (F222.1)', () => {
  let s: LS2;
  b2(() => {
    s = new LS2(mkd2(j2(tmp2(), 'trail-statmany-')));
  });

  i2('returns path → byte-size for every file under the prefix', async () => {
    await s.put('t1/kb/a.png', new Uint8Array(7));
    await s.put('t1/kb/deep/b.jpg', new Uint8Array(13));
    await s.put('t2/other.png', new Uint8Array(3));
    const m = await s.statMany('t1');
    e2([...m.entries()].sort()).toEqual([
      ['t1/kb/a.png', 7],
      ['t1/kb/deep/b.jpg', 13],
    ]);
  });

  i2('list() derives from statMany — same keys, trailing slash stripped (F230.1)', async () => {
    await s.put('t1/kb/a.png', new Uint8Array(1));
    const viaList = await s.list('t1/');
    const viaStat = [...(await s.statMany('t1/')).keys()];
    e2(viaList).toEqual(viaStat);
    e2(viaList).toEqual(['t1/kb/a.png']);
  });

  i2('missing prefix → empty map, never a throw', async () => {
    e2((await s.statMany('findes-ikke')).size).toBe(0);
  });
});
