/**
 * F22 leak-prevention probe.
 *
 * Christian's hard rule (2026-05-03): claim-anchor markers must
 * NEVER reach chat output. This script exercises stripClaimAnchors
 * across the inputs we know retrieveContext + retrieve.ts pass to
 * the LLM and asserts the output is clean. Pure-function probe;
 * no DB or HTTP needed.
 *
 * Run: `cd apps/server && bun run scripts/verify-f22-strip-leak.ts`
 */

import { stripClaimAnchors } from '@trail/core';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log('\n=== F22 strip-leak probe ===\n');

// 1. Position-zero marker (the failure mode in Christian's screenshot)
const para = '{#claim-0791f933} **Hjertechakraet** er placeret midt i brystet.';
assert(
  !stripClaimAnchors(para).includes('{#claim-'),
  'paragraph-leading marker is stripped',
);

// 2. Inline mid-sentence marker (defensive — F22 doesn't generate
// these but a model echoing one back from context might)
const inline = 'Hjertet sidder her {#claim-99de73b2} og slår.';
assert(
  !stripClaimAnchors(inline).includes('{#claim-'),
  'inline marker is stripped',
);

// 3. Multiple markers in one string (chunk-aggregation case)
const multi = `{#claim-aaaaaaaa} First claim.

{#claim-bbbbbbbb} Second claim.

{#claim-cccccccc} Third claim.`;
const multiClean = stripClaimAnchors(multi);
assert(!multiClean.includes('{#claim-'), 'multiple markers all stripped');
assert(multiClean.includes('First claim.'), 'first claim text preserved');
assert(multiClean.includes('Second claim.'), 'second claim text preserved');
assert(multiClean.includes('Third claim.'), 'third claim text preserved');

// 4. Heading-with-marker (from claim-anchors.ts injectClaimAnchors output)
const heading = '## Hjertechakra {#claim-12345678}';
assert(
  !stripClaimAnchors(heading).includes('{#claim-'),
  'heading-trailing marker is stripped',
);
assert(
  stripClaimAnchors(heading).includes('Hjertechakra'),
  'heading title preserved',
);

// 5. List item with marker
const listItem = '- Item one {#claim-deadbeef}';
assert(
  !stripClaimAnchors(listItem).includes('{#claim-'),
  'list-item marker is stripped',
);

// 6. Idempotent on already-clean text
const clean = 'A perfectly normal paragraph with no markers.';
assert(stripClaimAnchors(clean) === clean, 'idempotent on clean text');

// 7. Empty / undefined-ish input
assert(stripClaimAnchors('') === '', 'empty string passes through');

// 8. A model echoing the marker into chat output (the leak we're
// preventing). Even if the LLM emits this, the answer-strip pass
// in chat.ts catches it.
const llmEcho = 'Som beskrevet i {#claim-0791f933} sidder hjertet centralt.';
assert(
  !stripClaimAnchors(llmEcho).includes('{#claim-'),
  'LLM-echo case (defense in depth) is stripped',
);

// 9. Wrong-shape "marker"-looking text MUST NOT be stripped (only
// exact 8-hex-char ids match the regex, so a 7-char or 9-char id
// is not a marker we recognise — leave it alone).
const fakeShort = 'Reference {#claim-1234567} to nothing.';
const fakeStripped = stripClaimAnchors(fakeShort);
assert(
  fakeStripped === fakeShort,
  'malformed (7-char) marker is NOT stripped — preserves user text',
);

console.log(`\n${failures === 0 ? '✓ All assertions passed' : `✗ ${failures} assertion(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
