/**
 * F219.1 — the two invariants, plus the regressions that motivated them.
 *
 * These are RED tests in the F205 sense: each one fails if the specific
 * behaviour it names is removed. Mutation-checked 2026-09-02 — see the commit
 * body for which mutation reddens which test.
 */
import { expect, test } from 'bun:test';
import { buildFtsQuery, ftsTerms, FTS_STOPWORDS } from './fts-query.js';
import { expandTerms, expandableWords, expansionEntries, MAX_EXPANSIONS } from './fts-synonyms.js';

// ── Invariant 1: split like the index, never strip inside a term ────────────

test('hyphenated term splits into the tokens the index actually holds', () => {
  // The index (porter unicode61) stores "TV-lyd" as tv + lyd. Stripping the
  // hyphen would yield "TVlyd"* — a token that exists nowhere.
  expect(buildFtsQuery('TV-lyd')).toBe('"TV"* OR "lyd"*');
});

test('never emits a glued token', () => {
  for (const q of ['TV-lyd', 'e-mail', 'F219.1', 'far/mor', 'a_b']) {
    const built = buildFtsQuery(q);
    expect(built).not.toContain('TVlyd');
    // Every emitted term is a quoted run of letters/digits and nothing else —
    // so no punctuation was ever glued into the middle of a token.
    for (const term of built.split(' OR ')) {
      expect(term).toMatch(/^"[\p{L}\p{N}]+"\*$/u);
    }
  }
});

test('FTS5 operator characters can never reach the parser', () => {
  // A raw `-` is NOT in FTS5, `*` is a prefix operator, `"` ends a phrase.
  const q = buildFtsQuery('pris - "behandling" * OR NEAR(x)');
  for (const term of q.split(' OR ')) {
    expect(term).toMatch(/^"[\p{L}\p{N}]+"\*$/u);
  }
});

// ── Invariant 2: never widen to an empty MATCH ─────────────────────────────

test('a question of nothing but function words still searches on something', () => {
  // The negative control that is load-bearing in the OTHER direction: turning
  // a bad answer into no answer is not a fix.
  expect(buildFtsQuery('hvad er en')).toBe('"hvad"* OR "er"* OR "en"*');
  expect(buildFtsQuery('what is the')).toBe('"what"* OR "is"* OR "the"*');
});

test('only a question with no letters or digits yields an empty query', () => {
  expect(buildFtsQuery('   ')).toBe('');
  expect(buildFtsQuery('?!—')).toBe('');
  expect(buildFtsQuery('a')).toBe('"a"*'); // single stopword, still searched
});

// ── The regression that opened F219 ────────────────────────────────────────

test("the owner's question keeps only the words that carry meaning", () => {
  // "Hvad koster en behandling" filled all four result slots with hvad + en.
  // expand:false so this test measures the STOPWORD rule alone. F219.2's
  // expansion has its own test; a single assertion covering both would go red
  // for two unrelated reasons and tell you neither.
  expect(buildFtsQuery('Hvad koster en behandling', { expand: false })).toBe('"koster"* OR "behandling"*');
});

test('no function word survives as a term while content terms exist', () => {
  // The measurement that proved fault 1: "Hvad koster en behandling" and
  // "hvad er en" returned IDENTICAL results, because hvad + en filled all four
  // slots. Asserting the two query STRINGS merely differ is too weak to see
  // that — they differ even with the filter removed. Assert instead that no
  // stopword is left to consume a slot.
  for (const q of ['Hvad koster en behandling', 'Hvornår skiftede Trail over til Mistral', 'What is the price of a treatment']) {
    const terms = buildFtsQuery(q).split(' OR ').map((t) => t.replace(/^"|"\*$/g, '').toLowerCase());
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.filter((t) => FTS_STOPWORDS.has(t))).toEqual([]);
  }
});

test('a long natural-language question drops to its content terms', () => {
  expect(buildFtsQuery('Hvornår skiftede Trail chat over til Mistral, og hvilken commit?'))
    .toBe('"skiftede"* OR "Trail"* OR "chat"* OR "Mistral"* OR "commit"*');  // no ask-words → unexpanded
});

// ── Shape ──────────────────────────────────────────────────────────────────

test('terms are OR-joined, not AND-joined', () => {
  // mcp-router and candidate-api joined on a space, which FTS5 reads as AND —
  // a strictly narrower query than every other surface produced.
  expect(buildFtsQuery('pris behandling')).toContain(' OR ');
});

test('Danish letters survive intact', () => {
  expect(buildFtsQuery('æblegrød Ærø småkage')).toBe('"æblegrød"* OR "Ærø"* OR "småkage"*');
});

test('ftsTerms splits exactly like the unicode61 tokenizer', () => {
  expect(ftsTerms('TV-lyd, e-mail_adresse (2026)')).toEqual(['TV', 'lyd', 'e', 'mail', 'adresse', '2026']);
});

test('stopword matching is case-insensitive', () => {
  expect(buildFtsQuery('HVAD koster', { expand: false })).toBe('"koster"*');
  expect(FTS_STOPWORDS.has('hvad')).toBe(true);
});

// ── F219.2: the ask-word → written-word bridge ─────────────────────────────

test("the owner's question now carries the word the price Neuron is written with", () => {
  // Measured on FD Aalborg's live Trail: with only koster+behandling the price
  // Neuron ranks below 10th; with "pris" added it is #1.
  expect(buildFtsQuery('Hvad koster en behandling'))
    .toBe('"koster"* OR "behandling"* OR "pris"* OR "priser"*');
});

test('expansion never fires on a question that is only function words', () => {
  // Widening a vague question is how "I do not have that" becomes a confident
  // wrong answer — the mirror of the bug being fixed.
  expect(buildFtsQuery('hvad er en')).toBe('"hvad"* OR "er"* OR "en"*');
});

test('PRECONDITION — no ask-word is also a stopword', () => {
  // This is what actually makes the test above true, and it is the one an
  // editor can break. Adding `hvor: ['adresse']` would let a pure-filler
  // question ("hvor er det?") expand, because "hvor" is stripped as filler and
  // would still carry a synonym. Red here, rather than a subtle recall change
  // nobody traces back to this file.
  const askWords = expandableWords();
  const clash = askWords.filter((w) => FTS_STOPWORDS.has(w));
  expect(clash).toEqual([]);
});

test('a question already using the written word is not widened', () => {
  expect(buildFtsQuery('behandling pris')).toBe('"behandling"* OR "pris"*');
});

test('NEGATIVE CONTROL — a question with no ask-word is left exactly as it was', () => {
  // The control that matters for precision: expansion must not quietly attach
  // itself to unrelated questions.
  expect(buildFtsQuery('utilsigtet hændelse')).toBe('"utilsigtet"* OR "hændelse"*');
  expect(buildFtsQuery('æblegrød raketbrændstof')).toBe('"æblegrød"* OR "raketbrændstof"*');
});

test('expansion is bounded', () => {
  const terms = buildFtsQuery('koster betaler dyrt billigt åbent ringe ligger').split(' OR ');
  const asked = ftsTerms('koster betaler dyrt billigt åbent ringe ligger').length;
  expect(terms.length - asked).toBeLessThanOrEqual(MAX_EXPANSIONS);
});

test('expansion can be switched off', () => {
  expect(buildFtsQuery('Hvad koster en behandling', { expand: false }))
    .toBe('"koster"* OR "behandling"*');
});

test('expandTerms adds nothing the query already has', () => {
  expect(expandTerms(['koster', 'pris', 'priser'])).toEqual([]);
});

test('SNAPSHOT — every question that expands, and exactly what it gains', () => {
  // The live sweep (verify-f219-2-expansion-sweep.ts) compares RANKINGS, and it
  // is blind to the failure that matters most here. Measured 2026-09-02: adding
  // the plainly wrong entry `hændelse: ['pris']` made "Hvad er en utilsigtet
  // hændelse" search for prices, and the sweep stayed GREEN because the #1
  // result did not move. A guard that cannot see a wrong synonym is not a guard
  // against wrong synonyms.
  //
  // So the list is pinned instead. Any edit to fts-synonyms.ts reddens this,
  // and the author has to state the new behaviour deliberately — which is the
  // review moment the card's "a new entry needs a measurement, not an
  // intuition" rule depends on. Widening this snapshot is cheap; widening it
  // WITHOUT noticing is what this prevents.
  const corpus = [
    'Hvad koster en behandling',
    'Hvor meget betaler sygesikringen',
    'Hvornår har I åbent i Hasseris',
    'Hvem skal jeg ringe til ved afbud',
    'Hvor ligger klinikken i Nørresundby',
    'Hvad er en utilsigtet hændelse',
    'Hvordan foregår et patientforløb',
    'Hvad er overenskomst fysioterapi',
    'Hvem er fysioterapeuterne i Kennedy Arkaden',
  ];
  const snapshot = corpus.map((q) => `${q} → ${expandTerms(ftsTerms(q)).join(',') || '(uændret)'}`);
  expect(snapshot).toEqual([
    'Hvad koster en behandling → pris,priser',
    'Hvor meget betaler sygesikringen → pris,betaling',
    'Hvornår har I åbent i Hasseris → åbningstid,åbningstider',
    'Hvem skal jeg ringe til ved afbud → telefon,kontakt',
    'Hvor ligger klinikken i Nørresundby → adresse',
    'Hvad er en utilsigtet hændelse → (uændret)',
    'Hvordan foregår et patientforløb → (uændret)',
    'Hvad er overenskomst fysioterapi → (uændret)',
    'Hvem er fysioterapeuterne i Kennedy Arkaden → (uændret)',
  ]);
});

test('PINNED — the expansion list itself, every entry', () => {
  // The complete guard. The corpus snapshot above shows what the list MEANS;
  // this catches every edit to it, including one no example happens to exercise.
  // Measured: `patient: ['pris']` slipped past the corpus snapshot AND past the
  // live ranking sweep, because no test question contains the bare token
  // "patient". It cannot slip past this.
  //
  // Changing this list is allowed and expected. Changing it WITHOUT saying so
  // is what is prevented — update the pin in the same commit, with the
  // measurement that justified the new entry in the commit body.
  expect(expansionEntries()).toEqual([
    'betale → pris,betaling',
    'betaler → pris,betaling',
    'billigt → pris,priser',
    'cost → price,prices',
    'costs → price,prices',
    'dyrt → pris,priser',
    'kontakte → kontakt,telefon',
    'koste → pris,priser',
    'kostede → pris,priser',
    'koster → pris,priser',
    'ligger → adresse',
    'lukker → åbningstid,åbningstider',
    'lukket → åbningstid,åbningstider',
    'price → pris,priser',
    'ring → telefon,kontakt',
    'ringe → telefon,kontakt',
    'skrive → mail,kontakt',
    'åben → åbningstid,åbningstider',
    'åbent → åbningstid,åbningstider',
    'åbner → åbningstid,åbningstider',
  ]);
});
