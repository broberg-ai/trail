/**
 * F286.2 — the classifier's label space, and the rule that keeps a golden
 * example out of training.
 *
 * EVERY CATEGORY HERE IS A VALUE PRODUCTION ALREADY HOLDS. None was invented
 * because it sounded right: `source-type` asks the ingest registry itself which
 * pipeline would run, `neuron-type` reads the path convention the Neurons are
 * actually filed under, `edge-type` and `candidate-kind` are the DB's own
 * enums, and `admit` is the curator's own approved/rejected verdict. A category
 * the product does not know is a category nobody can use.
 *
 * The counts live in data/label-space.json, written by build-dataset.ts, so
 * they can be re-measured rather than remembered.
 */
import { createHash } from 'node:crypto';
import { pickPipeline } from '@trail/pipelines';

export const TASKS = [
  'source-type',
  'routing',
  'neuron-type',
  'edge-type',
  'admit',
  'candidate-kind',
] as const;
export type TaskId = (typeof TASKS)[number];

export type Language = 'da' | 'en' | 'unknown';
export type Split = 'train' | 'golden';

export interface Example {
  task: TaskId;
  /** Unique within a task. Production's own row id wherever one exists. */
  id: string;
  label: string;
  /** What the classifier reads. Short on purpose — see build-dataset.ts. */
  text: string;
  lang: Language;
  tenant: string;
  kb: string;
  split: Split;
}

// ── source-type ──────────────────────────────────────────────────────────────

/**
 * WHICH PIPELINE WOULD RUN — asked of the registry, not re-derived.
 *
 * `@trail/pipelines` exports `pickPipeline(filename, mime)`, which is the
 * function the upload route itself calls. Importing it means this label can
 * never drift from what the product does; mirroring its extension regexes here
 * would have been a second copy of a decision that already has one home.
 *
 * `text` is the answer when NO pipeline accepts the file — markdown, .txt and
 * (measured, and worth knowing) .doc, which the docx pipeline does not accept.
 * Those go through as raw text. It is a real category, not a fallback bucket.
 */
export function sourceType(filename: string): string {
  return pickPipeline(filename)?.name ?? 'text';
}

// ── neuron-type ──────────────────────────────────────────────────────────────

/**
 * The kind segment of `/neurons/<kind>/<source>/`, the path convention every
 * Neuron is filed under.
 *
 * `root` is a Neuron filed directly in `/neurons/` with no kind — 52 of them,
 * measured. It is reported as its own category rather than dropped, because
 * "no kind was chosen" is exactly what a classifier would have to predict for
 * the next one.
 */
export function neuronType(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'neurons') return 'other';
  return parts[1] ?? 'root';
}

// ── language ─────────────────────────────────────────────────────────────────

const DA = /\b(og|at|det|ikke|som|har|kan|skal|med|til|den|der|er|på|af|en|et|men|hvis|når|være|blev|jeg|vi|du|fra|om)\b/g;
const EN = /\b(the|and|of|to|in|is|that|with|this|are|was|not|it|be|have|has|from|they|you|we)\b/g;

/**
 * Danish or English — a HEURISTIC, and labelled as one everywhere it is used.
 *
 * Function-word counts plus æ/ø/å. It is not a language identifier and it will
 * be wrong on a three-word title; `unknown` is returned rather than guessed
 * when neither side has enough evidence. Its only job is to prove the golden
 * set is not single-language, which it can do honestly at this precision.
 */
export function detectLanguage(text: string): Language {
  const lower = text.toLowerCase();
  const da = (lower.match(DA) ?? []).length + (lower.match(/[æøå]/g) ?? []).length * 2;
  const en = (lower.match(EN) ?? []).length;
  if (da === 0 && en === 0) return 'unknown';
  if (da === en) return 'unknown';
  return da > en ? 'da' : 'en';
}

// ── the split ────────────────────────────────────────────────────────────────

/**
 * GOLDEN IS A PROPERTY OF THE TEXT, NOT OF THE ROW — and that is the whole
 * design.
 *
 * The same piece of writing appears under more than one task: a Neuron is a
 * `neuron-type` example AND a `routing` example, a queue candidate is an
 * `admit` example AND a `candidate-kind` example. Split them row by row and a
 * text ends up held out for one task while the shared encoder reads it during
 * training for another. The model would then be evaluated on text it has
 * already seen, which is the leak this card exists to make impossible — and it
 * would not show up as an error, only as a suspiciously good score.
 *
 * So a text is golden or it is not, everywhere at once. `train` is simply
 * "not golden", which makes the disjointness true by construction rather than
 * by a check that could be forgotten. verify-split.ts proves it anyway, because
 * a guarantee nobody measures is a guarantee nobody notices losing.
 */
export function textKey(text: string): string {
  // sha256, NOT Bun.hash. Bun's default hash is wyhash and is explicitly not
  // promised to be stable across Bun versions — so a routine runtime upgrade
  // would silently re-cut the golden set, and a model trained last month would
  // be evaluated on rows this month's export trains on. Exactly the leak two
  // paragraphs up, arriving through the tool meant to prevent it.
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/**
 * Deterministic, content-derived ordering. Two runs over unchanged data pick
 * the SAME golden texts — otherwise every re-export silently moves the held-out
 * set, and a model trained last week is evaluated on data this week's export is
 * training on.
 */
export function splitRank(text: string, id: string): string {
  return `${textKey(text)}:${id}`;
}

/**
 * How many of a label's examples are held out.
 *
 * STRATIFIED, not a percentage of the whole. A flat 5% would give the 5.925
 * `cites` edges hundreds of golden examples and the 3 `contradicts` edges none
 * — and a classifier that is never evaluated on a class cannot be shown to have
 * learned it. So every label that CAN spare an example gets some.
 *
 * `available - 1` is the ceiling on purpose: a label must keep at least one
 * training example. And a label with exactly ONE example gets ZERO golden
 * examples — held out it would have nothing to train on, trained on it cannot
 * be evaluated. That is not a gap in this function, it is what one example
 * means, and build-dataset.ts names those labels rather than letting them pass
 * as covered.
 */
export function goldenQuota(available: number, perLabelBudget: number): number {
  if (available <= 1) return 0;
  return Math.min(available - 1, Math.max(1, perLabelBudget));
}

/**
 * Choose the golden texts across every task, then stamp `split` on every row.
 *
 * Rarest label first, deliberately: a scarce class (`contradicts`, 3 edges)
 * must claim its held-out example before a class with thousands has spent the
 * shared text budget.
 */
export function assignSplits(rows: Example[], taskBudget: number): Example[] {
  const golden = new Set<string>();

  // SORTED, not insertion order. The first version walked tasks in whatever
  // order the input happened to present them, so re-ordering the same rows
  // moved the golden set — the determinism test caught it. Task order decides
  // who claims a shared text first, so it has to be a property of the data,
  // never of the caller.
  const tasks = [...new Set(rows.map((r) => r.task))].sort();
  for (const task of tasks) {
    const mine = rows.filter((r) => r.task === task);
    const byLabel = new Map<string, Example[]>();
    for (const r of mine) {
      const list = byLabel.get(r.label) ?? [];
      list.push(r);
      byLabel.set(r.label, list);
    }
    const perLabelBudget = Math.max(1, Math.ceil(taskBudget / Math.max(1, byLabel.size)));

    // Rarest first; ties broken by label name so two equally-sized categories
    // cannot swap places between runs.
    const ordered = [...byLabel.entries()].sort(
      (a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]),
    );
    for (const [, list] of ordered) {
      const already = list.filter((r) => golden.has(textKey(r.text))).length;
      const quota = goldenQuota(list.length, perLabelBudget);
      // Never take a label's last training row — not even when another task
      // has already claimed some of its texts.
      const room = Math.max(0, list.length - 1 - already);
      const take = Math.min(Math.max(0, quota - already), room);
      const candidates = list
        .filter((r) => !golden.has(textKey(r.text)))
        .sort((a, b) => splitRank(a.text, a.id).localeCompare(splitRank(b.text, b.id)));
      for (const r of candidates.slice(0, take)) golden.add(textKey(r.text));
    }
  }

  // REPAIR PASS — and it is not belt-and-braces, it fixes a measured failure.
  //
  // The greedy pass above protects a label's last training row against its OWN
  // task. It cannot protect it against a LATER task claiming the same text:
  // `neuron-type/test` had 3 rows, kept 1 back, and then `routing` took that
  // text for its own quota. The category came out 3 golden / 0 train —
  // something the model would be asked to recognise and never shown.
  //
  // Un-goldening is always safe: golden is defined as a set of texts and train
  // as its complement, so moving a text out of the set cannot create an
  // overlap. The most-recently-ranked text is released first, so the scarce
  // categories that claimed earliest keep what they took.
  for (const task of tasks) {
    const mine = rows.filter((r) => r.task === task);
    const labels = new Set(mine.map((r) => r.label));
    for (const label of [...labels].sort()) {
      const list = mine.filter((r) => r.label === label);
      if (list.length === 0) continue;
      const ranked = [...list].sort((a, b) =>
        splitRank(b.text, b.id).localeCompare(splitRank(a.text, a.id)),
      );
      // A label with a single row was never held out, so it needs no repair.
      for (const r of ranked) {
        if (list.some((x) => !golden.has(textKey(x.text)))) break;
        golden.delete(textKey(r.text));
      }
    }
  }

  return rows
    .map((r) => ({ ...r, split: golden.has(textKey(r.text)) ? ('golden' as const) : ('train' as const) }))
    .sort((a, b) => `${a.task}:${a.id}`.localeCompare(`${b.task}:${b.id}`));
}
