/**
 * F207.3 — the secret scanner must not be able to report a clean bill for a
 * scan it never performed.
 *
 * `scripts/scan-secrets.ts` is the gate that keeps credentials out of git in a
 * PUBLIC repo where a full-access key was once readable by anyone for four
 * months. It carried a RAW 0x00 byte in `text.includes('<NUL>')`. Correct as
 * written — and one formatter away from `includes('')`, which is true for every
 * string, so every file would be skipped and the run would print
 * "clean — 412 file(s) scanned" and exit 0. A dead security control shaped
 * exactly like a passing one.
 *
 * The assertions read the file as a BUFFER, deliberately. grep cannot see a NUL
 * byte (ugrep -I silently skips such files), which is why the defect survived
 * every prior audit of this scanner — an empty grep result and a clean file are
 * indistinguishable from the caller.
 *
 * Lives in @trail/shared because that is the package that owns the secret-scan
 * re-export, and because `pnpm test` runs it here in CI.
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCANNER = join(import.meta.dir, '../../../scripts/scan-secrets.ts');
const NUL = String.fromCharCode(0);

test('the scanner source contains zero raw NUL bytes', () => {
  const buf = readFileSync(SCANNER); // Buffer, never a grep — grep cannot see this
  const offsets: number[] = [];
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0) offsets.push(i);
  expect(offsets).toEqual([]);
});

test('it uses the two-character escape, not a literal control character', () => {
  const src = readFileSync(SCANNER, 'utf8');
  const line = src.split('\n').find((l) => l.includes('// binary'));
  expect(line).toBeDefined();
  // The escape as it appears in source: backslash followed by zero.
  expect(line).toContain("'\\0'");
  expect(line!.includes(NUL)).toBe(false);
});

test('the binary check still recognises a real NUL byte', () => {
  // The behaviour the escape is there to produce, asserted against an actual
  // 0x00 rather than against the source text.
  const binary = Buffer.concat([Buffer.from('abc'), Buffer.from([0]), Buffer.from('def')]).toString('utf8');
  expect(binary.includes('\0')).toBe(true);
  expect('a perfectly ordinary line of source'.includes('\0')).toBe(false);
});

test('MUTATION CONTROL: the post-formatter state would skip everything', () => {
  // This is what the raw byte degrades INTO. Asserted explicitly so the reason
  // the escape matters is written down as an executable fact rather than a
  // comment: an empty needle matches every haystack, so every file would be
  // treated as binary and skipped, and the scan would find nothing.
  const EMPTY_NEEDLE = '';
  expect('any source file at all'.includes(EMPTY_NEEDLE)).toBe(true);
  expect(''.includes(EMPTY_NEEDLE)).toBe(true);
});

test('a clean run reports COVERAGE, so "found nothing" cannot read as "looked at nothing"', () => {
  const src = readFileSync(SCANNER, 'utf8');
  // Counters exist and are printed.
  expect(src).toContain('let scanned = 0;');
  expect(src).toContain('let skipped = 0;');
  expect(src).toContain('let unreadable = 0;');
  expect(src).toContain('${scanned} of ${files.length} file(s) scanned');
});

test('a run that matched files but read none refuses instead of reporting clean', () => {
  const src = readFileSync(SCANNER, 'utf8');
  expect(src).toContain('if (scanned === 0 && files.length > 0)');
  // It must EXIT NON-ZERO on that branch — a warning that still exits 0 is the
  // same silent pass in a politer wrapper.
  const branch = src.slice(src.indexOf('if (scanned === 0 && files.length > 0)'));
  expect(branch.slice(0, branch.indexOf('}\n\n'))).toContain('process.exit(1)');
});
