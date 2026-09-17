/**
 * F275.1 AC#6 — INTEGRATION. The field must not exist only in its own unit test.
 *
 * `identityFromMetadata` can be perfect and have zero call sites. This guard
 * reads the SOURCE of the routes that actually receive a source, and requires
 * that every place writing `metadata: … sourceUrl …` also sets `sourceIdentity`.
 *
 * Three write sites in uploads.ts construct the same metadata shape. That is the
 * house's duplicate trap: they agree today, and they disagree the day one of them
 * is edited. This guard makes the disagreement red.
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = () => readFileSync(new URL('./uploads.ts', import.meta.url), 'utf8');

test('AC#6 every metadata write site ALSO sets sourceIdentity', () => {
  const s = source();

  // POSITIVE CONTROL FIRST: can the guard find a write site at all? Without it a
  // renamed file would yield zero matches, and the claim would pass on nothing.
  // MEASURED: a single-line pattern (/metadata:[^\n]*sourceUrl/) found only 2 of
  // 3. The third write site spans several lines (a ternary). A guard that counts
  // too low reports green about a place it never looked at.
  const sites = [...s.matchAll(/metadata:[\s\S]{0,220}?sourceUrl/g)];
  expect(sites.length).toBeGreaterThanOrEqual(3);

  for (const m of sites) {
    const fields = objectAround(s, m.index!);
    expect(fields, `metadata write site without sourceIdentity:\n${fields.slice(0, 220)}`)
      .toContain('sourceIdentity');
  }
});

/**
 * Cuts out the whole object literal the position sits in — from its `{` to the
 * matching `}`, counting braces.
 *
 * THE FIRST VERSION MEASURED DISTANCE IN CHARACTERS (`slice(i, i + 400)`), and
 * that did not hold. On 17 Sept 2026 a four-line comment was inserted between
 * `metadata` and `sourceIdentity` in the chunked upload — the field was still
 * there, ten lines down, but outside the window. The guard went red on a file
 * that was correct. A guard that fails on formatting teaches the reader to raise
 * the number, and the next time they raise it past a real defect.
 */
function objectAround(s: string, pos: number): string {
  let start = pos;
  let depth = 0;
  while (start > 0) {
    const c = s[start];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) break; depth--; }
    start--;
  }
  let inner = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') inner++;
    else if (s[i] === '}') { inner--; if (inner === 0) return s.slice(start, i + 1); }
  }
  return s.slice(start);   // unterminated — let the assertion fail on the content
}

test('AC#6 the identity has call sites OUTSIDE its own tests', () => {
  // A helper nobody calls is not an integration.
  const s = source();
  expect(s).toContain("sourceIdentity('url'");
  expect((s.match(/sourceIdentity\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
});

test('NEGATIVE CONTROL: the guard can actually say no', () => {
  expect(source()).not.toContain('a-string-that-is-certainly-not-in-the-file');
});
