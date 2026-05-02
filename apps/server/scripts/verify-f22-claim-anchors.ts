/**
 * F22 + F101 — verify claim-anchor injection + type-frontmatter
 * end-to-end through the candidate-api `write()` create branch.
 *
 * What this proves:
 *   1. generateClaimAnchor is deterministic for same content.
 *   2. generateClaimAnchor is stable for cosmetic edits within
 *      the first-50-chars window.
 *   3. injectClaimAnchors annotates headings + list items + paragraph-
 *      leader lines with `{#claim-xxx}` markers.
 *   4. injectClaimAnchors is idempotent — re-running on already-
 *      anchored markdown leaves it byte-identical.
 *   5. injectClaimAnchors skips frontmatter and code blocks.
 *   6. ensureTypeFrontmatter inserts `type:` derived from path.
 *   7. ensureTypeFrontmatter is idempotent on re-run.
 *   8. extractClaimAnchors round-trips the anchor set from injected output.
 *   9. prepareCompiledMarkdown combines both transforms in order.
 *
 * Pure-function probe — no DB, no engine spin-up. Run:
 *   `cd apps/server && bun run scripts/verify-f22-claim-anchors.ts`
 */

import {
  generateClaimAnchor,
  injectClaimAnchors,
  extractClaimAnchors,
  ensureTypeFrontmatter,
  prepareCompiledMarkdown,
} from '@trail/core';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log('\n=== F22 + F101 claim-anchors probe ===\n');

// 1. Determinism
const a1 = generateClaimAnchor('Sympatikus regulerer det sympatiske nervesystem');
const a2 = generateClaimAnchor('Sympatikus regulerer det sympatiske nervesystem');
assert(a1 === a2, 'same input → same anchor');
assert(/^claim-[a-f0-9]{8}$/.test(a1), 'anchor matches claim-<8 hex> format');

// 2. Cosmetic stability
const aBase = generateClaimAnchor('Sympatikus regulerer det sympatiske nervesystem');
const aTrailing = generateClaimAnchor('Sympatikus regulerer det sympatiske nervesystem  '); // trailing ws
const aMixedCase = generateClaimAnchor('SYMPATIKUS regulerer det sympatiske nervesystem');
assert(aBase === aTrailing, 'cosmetic whitespace doesnt change anchor');
assert(aBase === aMixedCase, 'case-difference doesnt change anchor (lowercase normalised)');
const aDifferent = generateClaimAnchor('Et helt andet claim om noget andet');
assert(aBase !== aDifferent, 'genuinely different content → different anchor');

// 3. injection on headings + list items
const md = `# Title One
Some paragraph content under the heading.

## Subheading
- First item
- Second item

\`\`\`
const x = 1; // code-block content should NOT get an anchor
\`\`\`

Final paragraph.
`;
const injected = injectClaimAnchors(md);
const headingAnchored = /^# Title One \{#claim-[a-f0-9]{8}\}$/m.test(injected);
const listAnchored = injected.split('\n').filter((l) => /^- (First|Second) item \{#claim-[a-f0-9]{8}\}$/.test(l)).length === 2;
const paragraphAnchored = /\{#claim-[a-f0-9]{8}\}\nSome paragraph content/.test(injected);
const finalParagraphAnchored = /\{#claim-[a-f0-9]{8}\}\nFinal paragraph\.$/m.test(injected);
const codeBlockUntouched = /const x = 1;/.test(injected) && !/const x.*\{#claim/.test(injected);
assert(headingAnchored, 'heading gets `{#claim-xxx}` appended');
assert(listAnchored, 'both list items get anchors');
assert(paragraphAnchored, 'paragraph gets anchor on preceding line');
assert(finalParagraphAnchored, 'final paragraph also anchored');
assert(codeBlockUntouched, 'code-block content is not anchored');

// 4. Idempotency
const reinjected = injectClaimAnchors(injected);
assert(injected === reinjected, 'injectClaimAnchors is idempotent on already-anchored input');

// 5. Frontmatter skipped
const mdWithFm = `---
title: Test
tags: [a, b]
---

# Heading
Body line.
`;
const injectedWithFm = injectClaimAnchors(mdWithFm);
const fmIntact = injectedWithFm.startsWith('---\ntitle: Test\ntags: [a, b]\n---');
assert(fmIntact, 'frontmatter is preserved unchanged');
assert(/# Heading \{#claim-[a-f0-9]{8}\}/.test(injectedWithFm), 'heading after frontmatter still gets anchor');

// 6. ensureTypeFrontmatter inserts type
const mdMissingType = `---
title: Sympatikus
tags: [nada]
---

Body content.
`;
const withType = ensureTypeFrontmatter(mdMissingType, '/neurons/concepts/sympatikus.md');
assert(/^---\ntitle: Sympatikus\ntags: \[nada\]\ntype: concept\n---/m.test(withType), 'type: concept inserted into frontmatter');

// 7. Idempotency for ensureTypeFrontmatter
const withTypeRepeat = ensureTypeFrontmatter(withType, '/neurons/concepts/sympatikus.md');
assert(withType === withTypeRepeat, 'ensureTypeFrontmatter is idempotent');

// Type-replacement when path-derivation differs from existing
const mdWithStaleType = `---
title: Foo
type: note
---

Body.
`;
const replaced = ensureTypeFrontmatter(mdWithStaleType, '/neurons/concepts/foo.md');
assert(/type: concept/.test(replaced) && !/type: note/.test(replaced), 'stale type is replaced when path-derived differs');

// 8. extractClaimAnchors round-trip
const anchored = injectClaimAnchors('# A heading\n- A list item\n\nA paragraph.\n');
const extracted = extractClaimAnchors(anchored);
assert(extracted.size === 3, `extractClaimAnchors finds 3 anchors (got ${extracted.size})`);
const headingAnchor = generateClaimAnchor('A heading');
const listAnchor = generateClaimAnchor('A list item');
const paragraphAnchor = generateClaimAnchor('A paragraph.');
assert(extracted.has(headingAnchor), 'heading anchor present in extracted set');
assert(extracted.has(listAnchor), 'list-item anchor present in extracted set');
assert(extracted.has(paragraphAnchor), 'paragraph anchor present in extracted set');

// 9. prepareCompiledMarkdown combines both
const combined = prepareCompiledMarkdown(
  `---
title: Sympatikus
tags: []
---

# Sympatikus
Et NADA-punkt.
`,
  '/neurons/concepts/sympatikus.md',
);
assert(/type: concept/.test(combined), 'prepareCompiledMarkdown adds type frontmatter');
assert(/# Sympatikus \{#claim-[a-f0-9]{8}\}/.test(combined), 'prepareCompiledMarkdown anchors heading');

if (failures > 0) {
  console.log(`\n✗ ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ all assertions passed');
