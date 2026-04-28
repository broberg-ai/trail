/**
 * F163.2 Phase 1+2 — verify parseQualitySignal extraction logic.
 *
 * Pure-function unit-test. No engine dependency, no Vision-API calls,
 * no DB. Asserts:
 *   1. [QUALITY: low] marker → autoFlag.signal=true, reason='vision-prompt-low'
 *   2. [QUALITY: normal] marker → autoFlag.signal=false (UNLESS regex still matches)
 *   3. No marker + regex hit → autoFlag.signal=true, reason='regex:<name>'
 *   4. No marker + clean text → autoFlag.signal=false
 *   5. Marker stripped from cleanText (no leak to UI)
 *   6. Decorative → returns null cleanText, no flag
 *   7. Several known false-positive guards (legitimate descriptions
 *      that should NOT trip any regex pattern)
 *
 * Run with: `cd apps/server && bun run scripts/verify-f163-2-parse.ts`
 */

import { parseQualitySignal } from '../src/services/vision.js';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log(`\n=== F163.2 parseQualitySignal verify ===\n`);

// ── 1. Vision-prompt marker: low ───────────────────────────────────────
console.log('[1] [QUALITY: low] marker');
{
  const raw = 'A diagram showing reflexology zones on the foot.\n[QUALITY: low]';
  const r = parseQualitySignal(raw);
  assert(r.autoFlag.signal === true, 'autoFlag.signal=true');
  assert(r.autoFlag.reason === 'vision-prompt-low', `reason='vision-prompt-low' (got ${r.autoFlag.reason})`);
  assert(r.cleanText === 'A diagram showing reflexology zones on the foot.', `marker stripped (got "${r.cleanText}")`);
}

// ── 2. Vision-prompt marker: normal ────────────────────────────────────
console.log('\n[2] [QUALITY: normal] marker — no flag');
{
  const raw = 'Anatomical diagram of the human foot.\n[QUALITY: normal]';
  const r = parseQualitySignal(raw);
  assert(r.autoFlag.signal === false, `autoFlag.signal=false (got ${r.autoFlag.signal})`);
  assert(r.autoFlag.reason === null, `reason=null (got ${r.autoFlag.reason})`);
  assert(r.cleanText === 'Anatomical diagram of the human foot.', 'marker stripped');
}

// ── 3. No marker + regex backstop ──────────────────────────────────────
console.log('\n[3] No marker + regex backstop fires');
const fixtures: Array<{ raw: string; expectReason: string; label: string }> = [
  {
    raw: 'I can see this appears to be a dark gray rectangular shape, but the image is too small and unclear to identify any specific content.',
    expectReason: 'regex:too-small-and-unclear',
    label: 'too small + unclear',
  },
  {
    raw: 'This appears to be a minimal graphic element on the page.',
    expectReason: 'regex:minimal-graphic',
    label: 'minimal graphic',
  },
  {
    raw: 'A small decorative mark with no informational content.',
    expectReason: 'regex:decorative-marker',
    label: 'decorative marker',
  },
  {
    raw: 'I can see this appears to be a very faint or low-contrast image.',
    expectReason: 'regex:low-contrast',
    label: 'low-contrast',
  },
  {
    raw: 'A very small dark square against a light background.',
    expectReason: 'regex:small-shape',
    label: 'small shape',
  },
  {
    raw: 'This appears to be a pixel-like shape against a white background.',
    expectReason: 'regex:pixel-like',
    label: 'pixel-like',
  },
  {
    raw: 'I am unable to make out specific content from this small image.',
    expectReason: 'regex:unable-to-identify',
    label: 'unable to identify',
  },
];
for (const f of fixtures) {
  const r = parseQualitySignal(f.raw);
  assert(r.autoFlag.signal === true && r.autoFlag.reason === f.expectReason,
    `"${f.label}" → ${f.expectReason} (got ${r.autoFlag.reason})`);
}

// ── 4. Clean descriptions — no false-positives ────────────────────────
console.log('\n[4] False-positive guards — legitimate descriptions stay un-flagged');
const cleanFixtures: string[] = [
  'Anatomical diagram of the human foot showing the bones, joints, and ligaments.',
  'A flowchart depicting the relationship between meridians and reflexology zones.',
  'Cross-sectional view of the spinal cord with labeled nerve roots.',
  'Diagram showing the blood supply network in the lower limb with arteries highlighted in red.',
  'A photograph of a hand demonstrating the correct grip for foot massage technique.',
];
for (const raw of cleanFixtures) {
  const r = parseQualitySignal(raw);
  assert(r.autoFlag.signal === false,
    `"${raw.slice(0, 40)}..." → no flag (got reason=${r.autoFlag.reason})`);
}

// ── 5. Null / empty handling ──────────────────────────────────────────
console.log('\n[5] Null / empty input handling');
{
  const r1 = parseQualitySignal(null);
  assert(r1.cleanText === null && r1.autoFlag.signal === false, 'null → null + no flag');
  const r2 = parseQualitySignal('');
  assert(r2.cleanText === null && r2.autoFlag.signal === false, 'empty → null + no flag');
  const r3 = parseQualitySignal('   ');
  assert(r3.cleanText === null && r3.autoFlag.signal === false, 'whitespace-only → null + no flag');
}

// ── 6. Marker case-insensitive + trailing whitespace tolerance ────────
console.log('\n[6] Marker tolerance');
{
  const r1 = parseQualitySignal('Description.\n[quality: LOW]');
  assert(r1.autoFlag.signal === true, 'lowercase + uppercase marker matches');
  const r2 = parseQualitySignal('Description.\n[QUALITY: low]   \n');
  assert(r2.autoFlag.signal === true, 'trailing whitespace tolerated');
  assert(r2.cleanText === 'Description.', 'trailing whitespace stripped');
}

// ── 7. Vision-prompt marker beats regex (no double-fire) ──────────────
console.log('\n[7] Marker takes precedence over regex');
{
  // Description contains "too small to identify" but marker says normal
  const raw = 'Image too small to identify content here.\n[QUALITY: normal]';
  const r = parseQualitySignal(raw);
  assert(r.autoFlag.signal === false, 'normal marker overrides regex match');
  assert(r.autoFlag.reason === null, 'no reason when marker says normal');
}

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
