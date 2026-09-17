/**
 * F275.6 — a fingerprint that can say "97% the same document".
 *
 * ## Why a checksum cannot do this
 *
 * The owner's example: *"if only bytes changed in the PDF … except that a year or
 * a heading was edited."* Change one year and SHA-256 is completely different. An
 * exact hash can only answer one question — "are these byte-identical?" — and
 * that is precisely the question that does not help here.
 *
 * Hence MinHash: a similarity measure. We cut the text into overlapping shingles,
 * take the smallest hash in each of K independent families, and compare the two
 * signatures. The fraction of positions where they AGREE estimates the Jaccard
 * similarity between the two shingle sets. Change a year in a long document and
 * almost every shingle is untouched — the signature barely moves.
 *
 * ## What it must NEVER do: decide
 *
 * The owner's own example is the trap, and it has no technical solution: "only
 * the year changed" is either a FIXED TYPO or NEXT YEAR'S EDITION — and the two
 * are 98% alike either way. Any threshold gets one of them wrong, and that error
 * is SILENT: one becomes a new edition that erases its predecessor's knowledge,
 * the other becomes two competing works.
 *
 * So the threshold below does not decide what HAPPENS. It only decides whether we
 * ASK — and we ask the human who just dropped the file in, while they still know
 * the answer.
 */

/** Hash families in the signature. 64 gives ±6 percentage points on the estimate. */
export const MINHASH_K = 64;

/** Words per shingle. 5 is long enough that a single word edit touches only 5. */
const SHINGLE = 5;

/**
 * Below this the text is too short to measure. A signature over three words says
 * nothing — and an estimate you cannot trust is worse than none, because it looks
 * exactly like one you can.
 */
const MIN_WORDS = 20;

/** 32-bit FNV-1a, seeded per family. No dependencies, same answer everywhere. */
function fnv1a(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Normalise BEFORE shingling: lowercase, strip punctuation, fold whitespace.
 *
 * Deliberately aggressive. Two versions of the same PDF where one was re-exported
 * often differ in punctuation and line breaks without a single word changing —
 * and that must not count as a difference.
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Build the fingerprint. `null` when the text is too short to measure — "could
 * not be measured" is a THIRD state and must never degrade into "new source".
 */
export function fingerprint(text: string | null | undefined): string | null {
  const w = words(text ?? '');
  if (w.length < MIN_WORDS) return null;

  const shingles = new Set<string>();
  for (let i = 0; i + SHINGLE <= w.length; i++) {
    shingles.add(w.slice(i, i + SHINGLE).join(' '));
  }
  if (shingles.size === 0) return null;

  const sig = new Array<number>(MINHASH_K).fill(0xffffffff);
  for (const s of shingles) {
    for (let k = 0; k < MINHASH_K; k++) {
      const h = fnv1a(s, k);
      if (h < sig[k]!) sig[k] = h;
    }
  }
  // Fixed width per slot, so two signatures can always be compared slot by slot
  // without parsing. 8 hex chars × 64 = 512 characters.
  return sig.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/**
 * How alike are two fingerprints? `null` when at least one is missing.
 *
 * `null` means "we could not measure", NEVER "they differ". A scanned PDF with no
 * text layer has no fingerprint, and reading that as "new source" would turn the
 * very files we know least about into the ones we are most confident about.
 */
export function similarity(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  if (a.length !== MINHASH_K * 8 || b.length !== MINHASH_K * 8) return null;
  let agree = 0;
  for (let k = 0; k < MINHASH_K; k++) {
    if (a.slice(k * 8, k * 8 + 8) === b.slice(k * 8, k * 8 + 8)) agree++;
  }
  return agree / MINHASH_K;
}

/**
 * Above this similarity we ASK. It does not decide what happens — see the file
 * header.
 *
 * 0.85 is chosen so that a fixed typo, a new year or a rewritten heading lands
 * above it, while two independent documents on the same topic land below. The
 * number may be tuned; it only changes HOW OFTEN we ask, never what the answer
 * turns out to be.
 */
export const ASK_ABOVE = 0.85;

/** The four cases, kept apart because each needs its own message. */
export type NameVerdict =
  /** High similarity, same name — the ordinary "new edition". Ask. */
  | 'new-edition'
  /** High similarity, DIFFERENT name — same work under a new name. Ask. */
  | 'same-work-new-name'
  /** LOW similarity, SAME name — two works fighting over one name. Loudest alarm. */
  | 'name-collision'
  /** Low similarity, different name — a new source. Say nothing. */
  | 'new-source'
  /** We could not measure. Not the same as "new source". */
  | 'undecidable';

/**
 * Decide which of the four cases we are in.
 *
 * `sameName` is a WARNING LIGHT, not the identity. The most important of the four
 * is `name-collision`: two documents that do NOT resemble each other yet share a
 * name. Given the owner's choice that filename + Brain is the identity, that is
 * exactly where a silent overwrite would happen — and it is invisible afterwards.
 */
export function nameVerdict(
  similarityScore: number | null,
  sameName: boolean,
  threshold: number = ASK_ABOVE,
): NameVerdict {
  if (similarityScore === null) return 'undecidable';
  const alike = similarityScore >= threshold;
  if (alike) return sameName ? 'new-edition' : 'same-work-new-name';
  return sameName ? 'name-collision' : 'new-source';
}
