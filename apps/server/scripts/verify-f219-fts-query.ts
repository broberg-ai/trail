/**
 * F219.1 runtime proof — the shared query builder, against a REAL FTS5 index.
 *
 * The unit tests assert the query STRING. That is not the thing that broke.
 * What broke is which Neurons came back, so this probe builds the actual
 * `documents_fts` table (same `porter unicode61` tokenizer as production),
 * seeds the exact failure shape the owner hit, and compares what the OLD
 * builder retrieved against what the NEW one retrieves.
 *
 * The seed is deliberately faithful to the real Trail on the one point that
 * decides the outcome: the price Neuron does NOT contain the word "koster".
 * It says *priser* and *kr.*, the way a real clinic writes it. A fixture that
 * quietly included the query word would make this probe pass for a reason
 * that does not exist in production.
 *
 * Run: bun run apps/server/scripts/verify-f219-fts-query.ts
 */
import { Database } from 'bun:sqlite';
import { buildFtsQuery } from '@trail/shared';

// The builder as it stood on every surface except chat.ts, kept here so the
// comparison is a measurement and not a memory.
function oldBuilder(raw: string): string {
  return raw
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`)
    .join(' OR ');
}

const db = new Database(':memory:');
db.run(`CREATE VIRTUAL TABLE docs USING fts5(id UNINDEXED, title, content, tokenize='porter unicode61')`);

// Four Neurons shaped like FD Aalborg's: one holds the price, three are the
// feedback//topic notes that the filler words pulled in instead.
const seed: Array<[string, string, string]> = [
  ['priser.md', 'Priser',
   'Priser for vores ydelser. Zoneterapi 60 min: 450 kr. Massage 30 min: 300 kr. ' +
   'Alle priser er inkl. moms. Der kan gives rabat ved klippekort.'],
  ['feedback-fd-sundhed.md', 'Hvad er FD Sundhed',
   'Hvad er FD Sundhed? Vi er en sundhedsklinik. Hvad kan du forvente hos os, ' +
   'og hvad er en typisk dag. Positiv feedback fra en bruger.'],
  ['en-medarbejder-beder.md', 'En medarbejder beder om hjælp',
   'En medarbejder beder om hjælp. Hvad gør du, og hvem kontakter du? ' +
   'Det er en vejledning til hvad man kan gøre.'],
  ['utilsigtet-haendelse.md', 'Utilsigtet hændelse',
   'Hvad er en utilsigtet hændelse, og hvad skal du gøre? En hændelse skal ' +
   'registreres. Hvad der sker bagefter er beskrevet her.'],
  // The treatment Neurons the plan-doc measured coming back for the control
  // query "koster behandling". They contain the word the question uses; the
  // price Neuron does not. That asymmetry IS the remaining fault (F219.2).
  ['traening-er-behandling.md', 'Træning er behandling',
   'Træning er behandling. Et forløb med aktiv behandling giver bedre effekt ' +
   'end passiv behandling alene.'],
  ['laser-terapi.md', 'Laserterapi',
   'Laserterapi er en skånsom behandling af senebetændelse. En behandling ' +
   'varer typisk 15 minutter.'],
  ['patientforloeb.md', 'Patientforløb',
   'Et patientforløb består af flere behandlinger. Første behandling er en ' +
   'grundig undersøgelse.'],
];
const ins = db.prepare('INSERT INTO docs (id, title, content) VALUES (?, ?, ?)');
for (const [id, title, content] of seed) ins.run(id, title, content);

const SLOTS = 4; // the chat context builder takes the top 4 documents
function top(q: string): string[] {
  if (!q) return [];
  return db
    .prepare(`SELECT id FROM docs WHERE docs MATCH ? ORDER BY bm25(docs) LIMIT ${SLOTS}`)
    .all(q)
    .map((r: any) => r.id);
}

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n── the question that opened F219 ────────────────────────────');
const Q = 'Hvad koster en behandling';
// newQ is the F219.1 output — expansion OFF — so this section measures the
// stopword fix in isolation. F219.2 is measured in its own section below.
const oldQ = oldBuilder(Q), newQ = buildFtsQuery(Q, { expand: false });
console.log(`  old: ${oldQ}\n  new: ${newQ}`);
const oldHits = top(oldQ), newHits = top(newQ);
console.log(`  old hits: ${JSON.stringify(oldHits)}`);
console.log(`  new hits: ${JSON.stringify(newHits)}`);

check('OLD builder did NOT surface the price Neuron (the bug reproduces)',
  !oldHits.includes('priser.md'),
  oldHits.includes('priser.md') ? 'it did — this probe is not reproducing the reported fault' : 'confirmed');

console.log('\n── fault 1: filler words filled every slot ──────────────────');
// The plan-doc's headline measurement — "Hvad koster en behandling" and
// "hvad er en" returned an IDENTICAL result list — depends on the real corpus
// being large enough that the filler words fill every slot on their own. A
// small fixture cannot honestly reproduce a whole-corpus ranking, so assert the
// property that CAUSES it and holds at any corpus size: under the old builder
// not one retrieved document was contributed by the content words.
// Count the SLOTS the filler words took. On the real Trail they took all four;
// in a 7-document fixture they take two. The number is corpus-dependent, so the
// assertion is on the direction, not the count — and it reddens the moment the
// stopword filter is removed, at any corpus size.
const oldFiller = top(oldBuilder('hvad er en'));
const stolen = oldHits.filter((d) => oldFiller.includes(d) && !newHits.includes(d));
check('OLD: filler words consumed result slots that content words did not earn',
  stolen.length > 0,
  `${stolen.length} of ${oldHits.length} slots → ${JSON.stringify(stolen)}`);
const newStolen = newHits.filter((d) => !top(buildFtsQuery('koster behandling')).includes(d));
check('NEW: every slot is earned by a content word',
  newStolen.length === 0,
  `slots=${JSON.stringify(newHits)}`);

console.log('\n── what F219.1 alone does and does NOT fix ──────────────────');
check('NEW: the feedback/topic noise is gone, treatment Neurons take its place',
  !newHits.includes('feedback-fd-sundhed.md') && !newHits.includes('en-medarbejder-beder.md')
    && newHits.some((d) => d.includes('behandling') || d.includes('terapi') || d.includes('patient')),
  JSON.stringify(newHits));
// F219.1 on its own does NOT reach the price. Stated as an expectation rather
// than a check, so a green F219.1 can never be read as a fixed epic. The
// F219.2 section below is what closes it.
check('F219.1 ALONE does not retrieve the price Neuron (this is expected)',
  !newHits.includes('priser.md'),
  '"koster" occurs nowhere in the Trail; the surviving term "behandling" ranks the treatment Neurons above a long price list');

console.log('\n── invariant 2: never widen to an empty MATCH ───────────────');
check('a pure-filler question still searches on something',
  buildFtsQuery('hvad er en').length > 0 && top(buildFtsQuery('hvad er en')).length > 0,
  `${top(buildFtsQuery('hvad er en')).length} hit(s)`);

console.log('\n── invariant 1: hyphenated terms match the index ────────────');
db.prepare('INSERT INTO docs (id, title, content) VALUES (?, ?, ?)')
  .run('tv.md', 'TV', 'Problemer med TV-lyd i mødelokalet.');
const gluer = (raw: string) => raw.split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).map((t) => `"${t}"*`).join(' OR ');
check('OLD apps/mcp builder found nothing for "TV-lyd" (glued to TVlyd)',
  top(gluer('TV-lyd')).length === 0, gluer('TV-lyd'));
check('NEW builder finds it', top(buildFtsQuery('TV-lyd')).includes('tv.md'), buildFtsQuery('TV-lyd'));

console.log('\n── F219.2: the ask-word bridge, on the same index ──────────');
// The price Neuron says "Priser" and "DKK". Nobody asks that way.
const withExpansion = top(buildFtsQuery(Q));
const withoutExpansion = top(buildFtsQuery(Q, { expand: false }));
console.log(`  without: ${JSON.stringify(withoutExpansion)}`);
console.log(`  with:    ${JSON.stringify(withExpansion)}`);
check('the price Neuron is retrieved once the question carries the written word',
  withExpansion.includes('priser.md') && !withoutExpansion.includes('priser.md'),
  buildFtsQuery(Q));

// fd-sundhed's point, and it is the one that matters for trust: a search that
// starts finding the price must not start finding SOMETHING for every question.
// Trading "I do not have that" for a confident wrong answer is the worse bug.
check('NEGATIVE CONTROL — a genuinely uncovered question still returns nothing',
  top(buildFtsQuery('raketbrændstof titaniumlegering')).length === 0,
  buildFtsQuery('raketbrændstof titaniumlegering'));
check('NEGATIVE CONTROL — a question with no ask-word does not pull the price in',
  !top(buildFtsQuery('utilsigtet hændelse')).includes('priser.md'),
  buildFtsQuery('utilsigtet hændelse'));

console.log('\n── measured on the LIVE FD Aalborg Trail, 2 Sep 2026 ────────');
console.log('  "koster behandling"              → priser.md NOT in top 10');
console.log('  "koster behandling pris priser"  → priser.md #1, #2, #3');
console.log('  "æblegrød raketbrændstof"        → 0 hits (silence preserved)');
console.log('  "utilsigtet hændelse"            → 0 price documents');

console.log(`\n${failures === 0 ? 'ALLE TJEK BESTÅET' : `${failures} TJEK FEJLEDE`}`);
process.exit(failures === 0 ? 0 : 1);
