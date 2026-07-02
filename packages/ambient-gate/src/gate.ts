/**
 * F201.1 — on-device gate heuristics.
 *
 * Scores a captured text chunk for "is this worth remembering": does it
 * contain a commitment, a decision, or a customer/person fact? Pure and
 * deterministic (keyword/regex only, no I/O, no model) so the Swift agent
 * can call it hundreds of times per session at zero cost. A small local
 * MLX model may replace/augment this later (open question in the F201
 * plan) — the GateScore shape is the stable contract.
 *
 * The gate is deliberately STRICT: ambient capture can produce a flood of
 * chunks, and the F201 plan's top risk is drowning the curation queue.
 * When in doubt, score low — a missed chunk costs one fact; a leaky gate
 * costs the curator's trust in the whole queue (the F200 lesson).
 */

export interface GateSignal {
  /** stable id, e.g. 'commitment', 'decision', 'contact', 'money', 'date' */
  kind: string;
  /** the matched substring (for debugging/explainability, never persisted) */
  match: string;
}

export interface GateScore {
  /** 0..1 — normalised signal strength */
  score: number;
  signals: GateSignal[];
}

/** Keyword groups, Danish + English. Word-boundary matched, case-insensitive. */
const COMMITMENT_TERMS = [
  'aftalt', 'aftaler', 'lover', 'deadline', 'senest', 'følger op', 'vender tilbage',
  'sender', 'fremsender', 'bekræfter',
  'agreed', 'promised', 'commit', 'follow up', 'i will send', "i'll send",
  'we will', 'by friday', 'by monday', 'next week',
];

const DECISION_TERMS = [
  'besluttet', 'beslutter', 'vi vælger', 'valgte', 'dropper', 'droppet',
  'går videre med', 'i stedet for', 'fravalgt',
  'decided', 'decision', 'we chose', 'instead of', 'rejected', 'went with',
];

/** Contact-ish facts: email, phone (DK 8-digit + international). */
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const PHONE_RE = /(?:\+\d{1,3}[ .-]?)?(?:\d{2}[ .-]?){3,5}\d{2}/g;

/** Money amounts: "12.500 kr", "DKK 4.000", "€300", "$1,200/md". */
const MONEY_RE = /(?:kr\.?|dkk|eur|usd|€|\$)\s?\d[\d.,]*|\d[\d.,]*\s?(?:kr\.?|dkk|eur|usd|€|\$)/gi;

/** Concrete dates: "12/8", "3. maj", "May 3rd", ISO. */
const DATE_RE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\d{1,2}\.\s?(?:jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\w*)\b/gi;

function termHits(text: string, terms: string[], kind: string): GateSignal[] {
  const lower = text.toLowerCase();
  const out: GateSignal[] = [];
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1) out.push({ kind, match: text.slice(idx, idx + term.length) });
  }
  return out;
}

function regexHits(text: string, re: RegExp, kind: string, cap = 3): GateSignal[] {
  const out: GateSignal[] = [];
  for (const m of text.matchAll(re)) {
    out.push({ kind, match: m[0] });
    if (out.length >= cap) break;
  }
  return out;
}

/** Signal weights — commitments/decisions are the point of the product. */
const WEIGHTS: Record<string, number> = {
  commitment: 0.35,
  decision: 0.35,
  contact: 0.2,
  money: 0.15,
  date: 0.1,
};

/** Below this length a chunk can't carry a usable fact — hard zero. */
const MIN_CHUNK_LENGTH = 24;

export function scoreChunk(text: string): GateScore {
  if (text.trim().length < MIN_CHUNK_LENGTH) return { score: 0, signals: [] };

  const signals = [
    ...termHits(text, COMMITMENT_TERMS, 'commitment'),
    ...termHits(text, DECISION_TERMS, 'decision'),
    ...regexHits(text, EMAIL_RE, 'contact'),
    ...regexHits(text, PHONE_RE, 'contact', 1),
    ...regexHits(text, MONEY_RE, 'money'),
    ...regexHits(text, DATE_RE, 'date', 2),
  ];

  // Sum weights once per signal KIND plus a small bonus per extra hit of
  // the same kind — three emails shouldn't outrank one commitment.
  const kinds = new Map<string, number>();
  for (const s of signals) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
  let score = 0;
  for (const [kind, count] of kinds) {
    score += (WEIGHTS[kind] ?? 0.05) * (1 + Math.min(count - 1, 2) * 0.25);
  }

  return { score: Math.min(1, score), signals };
}

/** Default emission threshold — strict by design (see module doc). */
export const DEFAULT_GATE_THRESHOLD = 0.4;

export function shouldEmit(result: GateScore, threshold = DEFAULT_GATE_THRESHOLD): boolean {
  return result.score >= threshold;
}
