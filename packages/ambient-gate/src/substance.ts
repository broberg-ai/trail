/**
 * F201.22 — what Ambient may send to Trail at all.
 *
 * Owner-reported the hour F201.21 restored the write path: "det vælter ind".
 * Measured on the real data: 48 auto-approved candidates covering 19 distinct
 * topics — one window label became TWELVE Neurons — and this passed as
 * knowledge:
 *
 *     "Jeg har 6 noter relateret til FDAA-projektet"
 *     "Jeg arbejder på projektet fd-sundhed (muligvis relateret til sundhedsdata)"
 *
 * The first restates a sidebar in Notes. The second is the distiller GUESSING
 * from a label — and the hedge is sitting in text that got stored as fact.
 *
 * These auto-approve with no human gate (F201.12), so they land straight in the
 * knowledge base the owner searches. Twelve near-identical Neurons about one
 * window degrade retrieval exactly where he has been working hardest.
 *
 * BOTH FILTERS RUN HERE, ON THE AMBIENT SIDE, BEFORE THE POST — the owner's
 * instruction: "det er jo ambient der samler op og den må gerne filtrere INDEN
 * den sender til trail for compilation." That makes "this must not change Trail
 * generically" structural rather than promised: the engine sees nothing to
 * judge differently, because the window never arrives. It is also cheaper — a
 * window dropped here costs no cloud distill call.
 */
import { createHash } from 'node:crypto';

/** A window summary is a title + the `Fokusforløb …` body from summarizeWindow. */
export interface SummaryLike {
  title: string;
  content: string;
}

/**
 * Content with the parts that are only NAMES stripped out: the timestamp header,
 * the `- App: "Window title"` run heads, and the OCR prefix. What survives is
 * what was actually on screen.
 */
function substantiveText(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^Fokusforløb /.test(line) && !/^- /.test(line))
    .map((line) => line.replace(/^\s*Skærm:\s*/, ''))
    .join(' ')
    .trim();
}

/** Distinct word-ish tokens of 3+ chars — a crude but honest content measure. */
function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3),
  );
}

/**
 * Minimum distinct on-screen words before a window is worth compiling.
 *
 * Not tuned to make a number look good: a window whose ONLY content is its own
 * app name and title carries zero here, and today's real captures that produced
 * useful Neurons carried hundreds. The gap is wide, so the threshold sits low
 * on purpose — this rejects emptiness, it does not rank quality.
 */
export const MIN_CONTENT_WORDS = 12;

export interface SubstanceVerdict {
  keep: boolean;
  reason?: 'no-screen-text' | 'only-names';
  words?: number;
}

/**
 * Does this window carry anything beyond the names of the things it looked at?
 *
 * The failure this prevents is NOT a window with bad text — it is a window with
 * no text at all, which the distiller then fills in from the title, hedging as
 * it goes ("muligvis relateret til"). Stopping it here is why the hedge never
 * has to be detected downstream: it is never written.
 */
export function hasSubstance(summary: SummaryLike): SubstanceVerdict {
  const body = substantiveText(summary.content);
  if (body.length === 0) return { keep: false, reason: 'no-screen-text', words: 0 };

  // Words that appear ONLY in the title/run-heads are names, not knowledge.
  const nameWords = contentWords(
    summary.title + ' ' + summary.content.split('\n').filter((l) => /^- /.test(l)).join(' '),
  );
  const own = [...contentWords(body)].filter((w) => !nameWords.has(w));
  if (own.length < MIN_CONTENT_WORDS) return { keep: false, reason: 'only-names', words: own.length };
  return { keep: true, words: own.length };
}

/**
 * Rolling memory of what has recently been sent, so the same window seen again
 * is not compiled again.
 *
 * Keyed on the SUBSTANTIVE text, never the whole summary: two captures of one
 * unchanged window differ by their timestamp range and by nothing else, so a
 * hash of the full content would call them distinct — which is precisely how
 * twelve of them got through.
 */
export class RecentWindows {
  private readonly seen = new Map<string, number>();

  constructor(
    /** How long a window stays "already sent". */
    private readonly ttlMs = 6 * 60 * 60_000,
    /** Cap so a long-running relay cannot grow without bound. */
    private readonly maxEntries = 500,
  ) {}

  private static key(summary: SummaryLike): string {
    const words = [...contentWords(substantiveText(summary.content))].sort().join(' ');
    return createHash('sha256').update(words).digest('hex');
  }

  /** True when an equivalent window was sent inside the TTL. Records it either way. */
  isDuplicate(summary: SummaryLike, now = Date.now()): boolean {
    for (const [k, t] of this.seen) if (now - t > this.ttlMs) this.seen.delete(k);
    const key = RecentWindows.key(summary);
    const prev = this.seen.get(key);
    this.seen.set(key, now);
    if (this.seen.size > this.maxEntries) {
      const oldest = [...this.seen.entries()].sort((a, b) => a[1] - b[1])[0];
      if (oldest) this.seen.delete(oldest[0]);
    }
    return prev !== undefined && now - prev <= this.ttlMs;
  }
}
