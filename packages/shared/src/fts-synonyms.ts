/**
 * F219.2 — the bridge between how a person ASKS and how a Neuron is WRITTEN.
 *
 * Measured on the owner's real question, against FD Aalborg's live Trail,
 * 2 September 2026:
 *
 *   "koster"            → 0 documents. The word occurs nowhere in the Trail.
 *   "behandling"        → 20 documents. priser.md is one of them (8 occurrences)
 *                         but ranks BELOW 10th, because it is a long price list
 *                         where the word is incidental, while the documents that
 *                         beat it are short and about exactly that word.
 *   "koster behandling" → identical list to "behandling" alone.
 *   "behandling pris"   → priser.md is #1.
 *
 * So the question "Hvad koster en behandling" contains no word that can tell the
 * price list apart from the treatment descriptions. The chat reads the top 4 and
 * answered, honestly, that it did not have the prices — while quoting four real
 * Neurons. Nothing in that answer hinted the prices were in the Trail.
 *
 * RANKING CANNOT FIX THIS. BM25 already weights rare terms above common ones,
 * but after the filler words are dropped there is only ONE term left. The
 * information needed to find the answer is not in the query at all. It has to be
 * added — by a synonym, or (much later, much more expensively) by embeddings.
 *
 * WHAT THIS IS AND IS NOT. These are not a thesaurus and not domain knowledge.
 * They are the handful of everyday VERBS people ask with, mapped to the NOUNS
 * documents are written with — a property of Danish and English, not of any one
 * customer. A physiotherapy clinic, a webshop and an HR handbook all write
 * "pris" and are all asked "hvad koster".
 *
 * DELIBERATELY NOT INCLUDED: anything domain-specific ("behandling" → "terapi"),
 * anything that widens a query which already works, and anything where the
 * mapping runs the other way. Expansion can only ADD documents, so every entry
 * is a chance to bury a good answer under a worse one. The list stays short on
 * purpose, and a new entry needs a measurement, not an intuition.
 */

/**
 * ask-word → the words a document is likely to use instead.
 * Keys are lower-case and matched against the query's tokens after the
 * stopword filter; values are added as extra OR-terms.
 */
const ASK_TO_WRITTEN: Record<string, readonly string[]> = {
  // ── price ────────────────────────────────────────────────────────────────
  // The case that opened F219. "koster" is how every Danish customer asks and
  // is almost never how a price list is written.
  koster: ['pris', 'priser'],
  koste: ['pris', 'priser'],
  kostede: ['pris', 'priser'],
  dyrt: ['pris', 'priser'],
  billigt: ['pris', 'priser'],
  betaler: ['pris', 'betaling'],
  betale: ['pris', 'betaling'],
  cost: ['price', 'prices'],
  costs: ['price', 'prices'],
  price: ['pris', 'priser'],
  // ── opening hours ────────────────────────────────────────────────────────
  // The second-most-asked question at any clinic or shop, and the same shape:
  // asked as a verb ("hvornår åbner I"), written as a noun ("åbningstider").
  åbner: ['åbningstid', 'åbningstider'],
  åbent: ['åbningstid', 'åbningstider'],
  åben: ['åbningstid', 'åbningstider'],
  lukker: ['åbningstid', 'åbningstider'],
  lukket: ['åbningstid', 'åbningstider'],
  // ── getting hold of someone ──────────────────────────────────────────────
  ringe: ['telefon', 'kontakt'],
  ring: ['telefon', 'kontakt'],
  kontakte: ['kontakt', 'telefon'],
  skrive: ['mail', 'kontakt'],
  ligger: ['adresse'],
};

/**
 * Extra OR-terms for a query's content words. Returns only terms that are NOT
 * already in the query, so a question that already says "pris" is unchanged.
 *
 * Capped at MAX_EXPANSIONS: an unbounded expansion is how a precise question
 * turns into a vague one, which is the mirror of the bug being fixed.
 */
export const MAX_EXPANSIONS = 4;

export function expandTerms(terms: readonly string[]): string[] {
  const have = new Set(terms.map((t) => t.toLowerCase()));
  const extra: string[] = [];
  for (const t of terms) {
    for (const syn of ASK_TO_WRITTEN[t.toLowerCase()] ?? []) {
      if (!have.has(syn) && !extra.includes(syn)) extra.push(syn);
      if (extra.length >= MAX_EXPANSIONS) return extra;
    }
  }
  return extra;
}

/** Every word that carries an expansion. Exported so a test can assert the
 *  precondition the expansion rule depends on: that none of them is a stopword.
 *  See "PRECONDITION — no ask-word is also a stopword" in fts-query.test.ts. */
export function expandableWords(): string[] {
  return Object.keys(ASK_TO_WRITTEN);
}

/** The whole map, sorted and flattened, for the test that pins it.
 *
 *  Pinning the LIST rather than its effect on a sample corpus is deliberate.
 *  Measured 2026-09-02: a corpus snapshot missed `patient: ['pris']` entirely,
 *  because the only question mentioning patients tokenises to "patientforløb"
 *  — one token, never "patient". A behavioural snapshot only ever sees what its
 *  examples happen to contain; this sees every edit. */
export function expansionEntries(): string[] {
  return Object.entries(ASK_TO_WRITTEN)
    .map(([k, v]) => `${k} → ${v.join(',')}`)
    .sort();
}
