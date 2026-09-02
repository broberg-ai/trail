/**
 * F219.2 regression sweep — does the expansion hurt anything ELSE?
 *
 * Raised by fd-sundhed (intercom #24987) and it is the right question: every
 * negative control in F219.2 was built around the ONE document already known to
 * be the problem. The four added terms change ranking for every query that
 * happens to contain an ask-word, not just the price question. A guard tested
 * only on the case it was born from is green there and blind everywhere else.
 *
 * So this runs a set of realistic customer questions against a LIVE Trail and
 * compares the top 4 with expansion on and off. It asserts one invariant that
 * generalises past the price case:
 *
 *   If expansion changes the #1 result, the new #1 must itself match one of the
 *   ADDED terms.
 *
 * That is what separates "the synonym found a better answer" from "the query
 * got reshuffled for reasons nobody intended". A reshuffle is the failure mode
 * an expansion list grows into as it gets longer, and it is invisible without
 * this comparison — both lists look plausible on their own.
 *
 * RE-RUN THIS WHENEVER fts-synonyms.ts GROWS. That is the whole point: the list
 * is meant to stay short, and this is how you find out that it did not.
 *
 * Usage:
 *   set -a; source .env.local-ingest; set +a
 *   bun run apps/server/scripts/verify-f219-2-expansion-sweep.ts [tenant] [kb]
 */
import { buildFtsQuery, ftsTerms } from '@trail/shared';

const API = process.env.TRAIL_CLOUD_API;
const KEY = process.env.TRAIL_API_KEY;
const TENANT = process.argv[2] ?? 'fd-aalborg';
const KB = process.argv[3] ?? 'admin-chat';
if (!API || !KEY) {
  console.error('TRAIL_CLOUD_API and TRAIL_API_KEY required — source .env.local-ingest first.');
  process.exit(1);
}
const H = { Authorization: `Bearer ${KEY}`, 'X-Trail-Tenant': TENANT };

/** The deployed search ORs each word it is given, so handing it the builder's
 *  bare terms reproduces the builder's query exactly. */
const bare = (fts: string) => fts.split(' OR ').map((t) => t.replace(/^"|"\*$/g, '')).join(' ');

async function top(fts: string): Promise<string[]> {
  const url = `${API}/api/v1/knowledge-bases/${KB}/search?q=${encodeURIComponent(bare(fts))}&limit=4`;
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const d = (await r.json()) as { documents?: Array<{ path?: string; filename?: string }> };
  return (d.documents ?? []).map((x) => (x.path ?? '') + (x.filename ?? ''));
}

// Half contain an ask-word, half deliberately do not. The untouched half is the
// control: it proves the sweep can tell "changed" from "unchanged" at all.
const QUESTIONS = [
  'Hvad koster en behandling',
  'Hvad koster en ultralydsscanning',
  'Hvor meget betaler sygesikringen',
  'Hvornår har I åbent i Hasseris',
  'Hvem skal jeg ringe til ved afbud',
  'Hvor ligger klinikken i Nørresundby',
  'Hvad koster det at afbestille en tid',
  'Hvem ringer til patienten efter et forløb',
  'Hvad betaler man for holdtræning',
  'Hvad er en utilsigtet hændelse',
  'Hvad er overenskomst fysioterapi',
  'Hvordan foregår et patientforløb',
  'Hvem er fysioterapeuterne i Kennedy Arkaden',
];

let expanded = 0, untouched = 0, violations = 0, improved = 0;
for (const q of QUESTIONS) {
  const off = buildFtsQuery(q, { expand: false });
  const on = buildFtsQuery(q);
  if (off === on) { untouched++; continue; }
  expanded++;
  const added = bare(on).split(' ').slice(ftsTerms(bare(off)).length);
  const [before, after] = await Promise.all([top(off), top(on)]);
  const changedTop = before[0] !== after[0];
  if (changedTop) improved++;
  // THE INVARIANT: a changed #1 must be explained by an added term.
  const explained = !changedTop || added.some((t) => (after[0] ?? '').toLowerCase().includes(t.slice(0, 4)));
  if (!explained) violations++;
  console.log(`${explained ? '·' : '✗'} ${q}`);
  console.log(`   + ${JSON.stringify(added)}`);
  if (changedTop) console.log(`   #1  ${before[0]?.slice(0, 52) ?? '(intet)'}\n    →  ${after[0]?.slice(0, 52) ?? '(intet)'}`);
}

console.log(`\n${expanded} udvidet · ${untouched} urørt · ${improved} fik nyt #1 · ${violations} uforklarede`);
if (untouched === 0) {
  console.error('✗ INTET spørgsmål stod urørt — sweepet kan ikke skelne, og et grønt resultat betyder intet.');
  process.exit(1);
}
console.log(violations === 0 ? 'ALLE TJEK BESTÅET' : `${violations} TJEK FEJLEDE`);
process.exit(violations === 0 ? 0 : 1);
