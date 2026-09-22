/**
 * F286.2 — measure the label space, then cut a golden set that is never trained on.
 *
 * WHAT IT WRITES, all into the gitignored data/ folder:
 *
 *   label-space.json   every task, every category, counted in production
 *   train.jsonl        the examples the classifier may learn from
 *   golden.jsonl       the examples it may NEVER learn from
 *
 * TWO FILES, NOT ONE FILE WITH A FLAG. A single file with `split: "golden"` on
 * some rows puts the whole guarantee on the training loader remembering to
 * filter — and a loader that forgets produces a model that looks excellent and
 * is worthless, which is the one failure mode that does not announce itself.
 * Two files means the trainer is pointed at train.jsonl and physically cannot
 * read the answers. verify-split.ts then proves the two are disjoint.
 *
 * THE ROWS ARE A MANIFEST, NOT A CORPUS. `text` is short (title plus a lead
 * excerpt) because this card is about WHICH examples exist and which are held
 * out — F286.4 fetches whatever body length training needs, keyed on the ids
 * here. Carrying full bodies for ~38.000 rows would make every re-measure a
 * multi-minute download of text nothing reads yet.
 *
 * READ-ONLY against production. Every call is a GET.
 *
 *   set -a; . ./.env.local-ingest; set +a
 *   bun run apps/scout/src/build-dataset.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listPipelines } from '@trail/pipelines';
import { QueueCandidateKindEnum, VALID_EDGE_TYPES } from '@trail/shared';
import {
  TENANTS,
  allDocuments,
  allQueueItems,
  get,
  kbGraph,
  requireKey,
  rowsOf,
  type KnowledgeBase,
} from './api.js';
import {
  TASKS,
  assignSplits,
  detectLanguage,
  neuronType,
  sourceType,
  type Example,
  type TaskId,
} from './labels.js';

const OUT = join(import.meta.dir, '..', 'data');

/**
 * Held-out examples per task. 55 lands inside the 300–500 the plan
 * asks for, and the stratified allocation in assignSplits spends it on covering
 * categories rather than on the biggest one.
 *
 * Three tasks share their texts with another task, so the golden sets overlap
 * and the total lands well under 6 x 75 — the printed count is the real one.
 */
const TASK_BUDGET = 55;

/** Keep `text` comparable across tasks — the hash-disjointness check in
 *  verify-split.ts compares these strings, so they must be cut the same way. */
function excerpt(...parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .join(' — ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function example(
  task: TaskId,
  id: string,
  label: string,
  text: string,
  tenant: string,
  kb: string,
): Example {
  return { task, id, label, text, lang: detectLanguage(text), tenant, kb, split: 'train' };
}

/**
 * `emne` is the one task in the plan that this tool does NOT produce examples
 * for, so the reason is MEASURED rather than asserted: the tag histogram is
 * counted here and written into label-space.json beside the six real tasks.
 * A category dropped on a claim nobody can re-check is the habit F286.1 exists
 * to end.
 */
function countTags(into: Map<string, number>, tags: string | null | undefined): void {
  for (const raw of (tags ?? '').split(',')) {
    const t = raw.trim();
    if (t) into.set(t, (into.get(t) ?? 0) + 1);
  }
}

async function collect(): Promise<{ rows: Example[]; tags: Map<string, number> }> {
  const rows: Example[] = [];
  const tags = new Map<string, number>();

  for (const tenant of TENANTS) {
    const kbs = rowsOf<KnowledgeBase>(await get(tenant, '/api/v1/knowledge-bases'));
    const kbById = new Map<string, string>();

    for (const kb of kbs) {
      process.stderr.write(`  ${tenant}/${kb.slug}…\n`);
      const sources = await allDocuments(tenant, kb.slug, 'source');
      const neurons = await allDocuments(tenant, kb.slug, 'wiki');
      const { nodes, edges } = await kbGraph(tenant, kb.slug);
      const nodeLabel = new Map(nodes.map((n) => [n.id, n.label]));
      const nodeExcerpt = new Map(nodes.map((n) => [n.id, n.excerpt ?? null]));

      for (const s of sources) {
        countTags(tags, s.tags);
        // The filename is what the upload route hands the pipeline registry,
        // so it is also what the classifier would see at decision time.
        rows.push(
          example(
            'source-type',
            s.id,
            sourceType(s.filename),
            excerpt(s.title, s.filename, s.tags),
            tenant,
            kb.slug,
          ),
        );
        rows.push(
          example('routing', `src:${s.id}`, kb.slug, excerpt(s.title, s.filename, s.tags), tenant, kb.slug),
        );
      }

      for (const n of neurons) {
        countTags(tags, n.tags);
        const body = excerpt(n.title ?? n.filename, nodeExcerpt.get(n.id), n.tags);
        rows.push(example('neuron-type', n.id, neuronType(n.path), body, tenant, kb.slug));
        rows.push(example('routing', `wiki:${n.id}`, kb.slug, body, tenant, kb.slug));
      }

      for (const e of edges) {
        // An edge's readable form is the two Neurons it joins — that pair is
        // what a model would have to type. The graph route carries no link
        // text, so the titles are the whole of the available signal.
        rows.push(
          example(
            'edge-type',
            `${kb.slug}:${e.id}`,
            e.edgeType,
            excerpt(nodeLabel.get(e.source), nodeLabel.get(e.target)),
            tenant,
            kb.slug,
          ),
        );
      }

      kbById.set(kb.slug, kb.slug);
    }

    // The queue is tenant-wide, not per-KB, so it is fetched once per tenant.
    // `pending` is deliberately excluded: an unreviewed candidate has no
    // verdict, and counting it as either answer would teach the model a
    // decision no human has made.
    for (const status of ['approved', 'rejected'] as const) {
      const items = await allQueueItems(tenant, status);
      process.stderr.write(`  ${tenant} queue/${status}: ${items.length}\n`);
      for (const it of items) {
        const body = excerpt(it.title, it.content);
        rows.push(example('admit', `${it.id}`, status, body, tenant, '—'));
        rows.push(example('candidate-kind', `ck:${it.id}`, it.kind, body, tenant, '—'));
      }
    }
  }

  return { rows, tags };
}

interface LabelCount {
  label: string;
  total: number;
  golden: number;
  train: number;
}

function main(rows: Example[], tags: Map<string, number>): void {
  // ONE call across every task, not one per task: a text that is held out for
  // `neuron-type` must also be held out for `routing`, or the shared encoder
  // reads it while training and the evaluation stops meaning anything.
  const split = assignSplits(rows, TASK_BUDGET);

  // ── the label space, counted ───────────────────────────────────────────────
  const space: Record<string, { declared: string[] | null; labels: LabelCount[]; absent: string[] }> = {};
  const declaredBy: Partial<Record<TaskId, readonly string[]>> = {
    // The pipelines the product HAS, asked of the registry, plus `text` for
    // the files no pipeline accepts. Measured this way so a format we can
    // ingest but have never ingested shows up as a hole in the training data
    // rather than as a category nobody thought of.
    'source-type': [...listPipelines().map((p) => p.name), 'text'],
    'edge-type': VALID_EDGE_TYPES,
    'candidate-kind': QueueCandidateKindEnum.options,
    // ONLY the two RESOLVED verdicts — not the full status enum. `pending` is
    // missing from this dataset because collect() leaves it out on purpose (an
    // unreviewed candidate has no verdict), so listing it as "declared but no
    // data" would blame production for a choice this tool made. A tool that
    // misreports its own filtering as a finding is worse than one that reports
    // nothing.
    admit: ['approved', 'rejected', 'ingested'],
  };

  for (const task of TASKS) {
    const mine = split.filter((r) => r.task === task);
    const byLabel = new Map<string, LabelCount>();
    for (const r of mine) {
      const c = byLabel.get(r.label) ?? { label: r.label, total: 0, golden: 0, train: 0 };
      c.total++;
      if (r.split === 'golden') c.golden++;
      else c.train++;
      byLabel.set(r.label, c);
    }
    const labels = [...byLabel.values()].sort((a, b) => b.total - a.total);
    const declared = declaredBy[task] ?? null;
    // A DECLARED CATEGORY WITH NO ROWS is the finding, not an omission. An
    // enum value the product has never produced cannot be learned and cannot
    // be evaluated — naming it is the only honest thing to do with it.
    const absent = declared ? declared.filter((d) => !byLabel.has(d)) : [];
    space[task] = { declared: declared ? [...declared] : null, labels, absent };
  }

  // The seventh candidate task, and why it is not one. Free-text tags are not
  // a category set: a model choosing between hundreds of values with a handful
  // of examples each learns nothing. Counted here so the exclusion can be
  // re-checked instead of believed.
  const topic = [...tags.entries()].sort((a, b) => b[1] - a[1]);
  const singletons = topic.filter(([, n]) => n === 1).length;

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'label-space.json'),
    JSON.stringify(
      {
        ...space,
        topic: {
          excluded: true,
          reason:
            'Fritekst-tags, ikke et kontrolleret ordforråd. Kræver sit eget kort før det kan blive en klassifikations-opgave.',
          distinct: topic.length,
          singletons,
          top: topic.slice(0, 30).map(([label, total]) => ({ label, total })),
        },
      },
      null,
      2,
    ) + '\n',
  );

  const train = split.filter((r) => r.split === 'train');
  const golden = split.filter((r) => r.split === 'golden');
  const jsonl = (rs: Example[]) => rs.map((r) => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(join(OUT, 'train.jsonl'), jsonl(train));
  writeFileSync(join(OUT, 'golden.jsonl'), jsonl(golden));

  // ── report ─────────────────────────────────────────────────────────────────
  for (const task of TASKS) {
    const s = space[task]!;
    console.log(`\n${task}  (${s.labels.reduce((a, l) => a + l.total, 0)} eksempler, ${s.labels.length} kategorier)`);
    console.log('  ' + 'kategori'.padEnd(26) + 'i alt'.padStart(8) + 'træn'.padStart(8) + 'golden'.padStart(8));
    for (const l of s.labels) {
      console.log(
        '  ' + l.label.padEnd(26) + String(l.total).padStart(8) + String(l.train).padStart(8) + String(l.golden).padStart(8),
      );
    }
    if (s.absent.length > 0) {
      console.log(`  ERKLÆRET MEN UDEN DATA: ${s.absent.join(', ')} — kan hverken læres eller måles.`);
    }
    const unevaluable = s.labels.filter((l) => l.golden === 0).map((l) => `${l.label} (${l.total})`);
    if (unevaluable.length > 0) {
      console.log(`  INGEN GOLDEN-EKSEMPLER: ${unevaluable.join(', ')} — for få rækker til at holde en ude.`);
    }
  }

  const langs = new Map<string, number>();
  for (const r of golden) langs.set(r.lang, (langs.get(r.lang) ?? 0) + 1);
  const goldenSourceTypes = new Map<string, number>();
  for (const r of golden.filter((g) => g.task === 'source-type')) {
    goldenSourceTypes.set(r.label, (goldenSourceTypes.get(r.label) ?? 0) + 1);
  }

  console.log(`\nGOLDEN-SÆT: ${golden.length} eksempler (træn: ${train.length})`);
  console.log(`  sprog (heuristik): ${[...langs].map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`  kildetyper i golden: ${[...goldenSourceTypes].map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(
    `\nemne (IKKE en opgave): ${topic.length} forskellige tags, ${singletons} med én forekomst — ` +
      `hyppigste: ${topic.slice(0, 3).map(([l, n]) => `${l}=${n}`).join(', ')}`,
  );
  console.log(`\nSkrevet til ${OUT}/ — label-space.json, train.jsonl, golden.jsonl`);
  console.log('Bevis adskillelsen:  bun run apps/scout/src/verify-split.ts');
}

if (import.meta.main) {
  requireKey();
  const { rows, tags } = await collect();
  main(rows, tags);
}
