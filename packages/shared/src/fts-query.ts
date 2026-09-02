/**
 * F219.1 — ONE FTS5 query builder for every surface that searches a Trail.
 *
 * Before this file the same function was hand-copied into SEVEN places
 * (chat, search, retrieve, image-search, the chat MCP router, the standalone
 * MCP, and the ingest candidate API) and had drifted into FIVE distinct
 * behaviours. Measured 2026-09-02 on the question that started F219:
 *
 *   "Hvad koster en behandling"
 *     chat.ts            "koster"* OR "behandling"*                 ← stopwords dropped
 *     search/retrieve    "Hvad"* OR "koster"* OR "en"* OR "behandling"*
 *     mcp-router         hvad koster en behandling                  ← implicit AND, no prefix
 *
 *   "TV-lyd"
 *     search.ts          "TV"* OR "lyd"*        ← matches
 *     retrieve.ts        "TV-lyd"*
 *     apps/mcp           "TVlyd"*               ← matches NOTHING, ever
 *
 * The same words meant three different things depending on which box the user
 * typed them into. That is the bug this module exists to make impossible.
 *
 * Two invariants, both load-bearing, both with a test that goes red if broken:
 *
 *  1. **Split on punctuation, never strip inside a term.** The index is
 *     `tokenize='porter unicode61'`, which splits on every non-alphanumeric
 *     character — so the document "TV-lyd" is indexed as the two tokens
 *     `tv` + `lyd`. Stripping the hyphen instead produces the query token
 *     `tvlyd*`, which cannot match either of them. Splitting the same way the
 *     index does is not a style choice; it is the only way a hyphenated term
 *     can match at all.
 *
 *  2. **Never return an empty query for a non-empty question.** Dropping
 *     stopwords lifts recall, but a question made entirely of function words
 *     ("hvad er en") would drop to zero terms — turning a bad answer into no
 *     answer, which is worse. When the filter empties the query we fall back
 *     to the unfiltered terms.
 */

/**
 * Danish + English function words, kept as ONE union rather than split per
 * language. A Danish Trail routinely holds English Neurons (commit messages,
 * library docs) and the reverse, so picking a list from the KB's `language`
 * column would drop the wrong half on exactly the mixed content where recall
 * matters most. The union is also what chat.ts has shipped since 2026-06-25 —
 * the one surface that was already correct — so consolidating on it changes
 * that surface's behaviour by exactly nothing.
 */
import { expandTerms } from './fts-synonyms.js';

export const FTS_STOPWORDS: ReadonlySet<string> = new Set([
  // Danish
  'og', 'i', 'på', 'til', 'er', 'en', 'et', 'den', 'det', 'de', 'at', 'som', 'med', 'for', 'af', 'der',
  'du', 'jeg', 'vi', 'han', 'hun', 'hvornår', 'hvad', 'hvem', 'hvilken', 'hvilke', 'hvor', 'hvorfor',
  'hvordan', 'kan', 'skal', 'vil', 'har', 'var', 'blev', 'over', 'under', 'ved', 'om', 'men', 'eller',
  'ikke', 'så', 'kort', 'svar', 'mig', 'os', 'din', 'dit', 'min', 'mit', 'denne', 'dette', 'disse',
  // English
  'the', 'a', 'an', 'to', 'of', 'is', 'are', 'was', 'were', 'and', 'or', 'in', 'on', 'with', 'what',
  'when', 'which', 'who', 'how', 'why', 'can', 'should', 'will', 'do', 'does', 'please', 'short',
  'answer', 'me', 'my', 'your', 'it', 'this', 'that',
]);

/**
 * Split a raw question into index-compatible tokens — the same split the FTS5
 * `unicode61` tokenizer performs on the documents themselves.
 */
export function ftsTerms(raw: string): string[] {
  return raw.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
}

/**
 * Build the FTS5 MATCH expression for a user's question.
 *
 * Returns an OR of prefix-terms (`"pris"* OR "behandling"*`), with function
 * words removed. Returns `''` — and only ever `''` — when the input contains
 * no alphanumeric characters at all; callers treat that as "don't search".
 */
export interface FtsQueryOptions {
  /** F219.2 — add the words a document is likely to use for the words the
   *  question asks with ("koster" → "pris"). On by default; pass false for a
   *  surface that must match literally. */
  expand?: boolean;
}

export function buildFtsQuery(raw: string, opts: FtsQueryOptions = {}): string {
  const all = ftsTerms(raw);
  if (all.length === 0) return '';
  const content = all.filter((t) => t.length >= 2 && !FTS_STOPWORDS.has(t.toLowerCase()));
  // Invariant 2: a question that is ALL function words still searches on
  // something. Never widen to an empty MATCH.
  const terms = content.length > 0 ? content : all;
  // Invariant 3 (F219.2): a pure-filler question is never expanded — widening a
  // vague question is how "I do not have that" becomes a confident wrong answer.
  //
  // There is deliberately NO `content.length === 0` branch here. It would be
  // unreachable: a pure-filler question consists only of stopwords, and no
  // stopword is an ask-word — so expandTerms returns nothing for it anyway. A
  // branch that cannot execute is untestable, and this file's mutation run
  // proved it: removing that guard reddened ZERO tests.
  //
  // The invariant is enforced where it is actually checkable instead — see
  // "no ask-word is also a stopword" in fts-query.test.ts. That test goes red
  // the day someone adds an entry like `hvor: ['adresse']`, which is the exact
  // change that would make expansion start firing on filler.
  const expanded = opts.expand === false ? terms : [...terms, ...expandTerms(terms)];
  return expanded.map((t) => `"${t}"*`).join(' OR ');
}
