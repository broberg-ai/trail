/**
 * F286.1 — measure and export the training material, on command.
 *
 * WHY THIS EXISTS. The numbers that decided the whole epic's order — ~282
 * sources, ~737 Neurons — were counted by hand once, in a conversation. A
 * measurement that lives in a conversation does not live anywhere: it cannot
 * be re-run, it cannot be diffed, and the next session has to take it on
 * trust. F6's continuous training needs the same numbers every week.
 *
 * THE DISTINCTION THIS TOOL EXISTS TO MAKE. A knowledge base can hold
 * thousands of Neurons and still contain ZERO training pairs for the compile
 * model. `buddy-sessions` has 5.679 Neurons and 2 sources: its Neurons were
 * written directly by agents through `trail_save`, not compiled from a
 * document. They are excellent CLASSIFIER data and useless as COMPILE data.
 *
 * Count them together and the training set looks eight times larger than it
 * is — and the epic's entire sequencing (classifier first, because the compile
 * model is starving) would be built on a number that is wrong.
 *
 * So this tool reports THREE numbers per brain, not one, and the difference
 * between them is the whole point.
 *
 * HOW THE LINK IS ESTABLISHED, measured in the engine's own routes rather than
 * assumed: a source document's derived Neurons are found through
 * `GET /documents/:id/derived`, which walks
 *
 *     source document → queue candidate (metadata points back at the source)
 *                     → wiki_event (sourceCandidateId)
 *                     → the Neuron it created
 *
 * That chain is what makes a pair a pair. A Neuron with no such chain was
 * written, not compiled.
 *
 * WHY THE HTTP API AND NOT THE DATABASE. The dataset is meant to live on
 * cb-ubuntu (112 GB free, runs 24/7), and only the API is reachable from
 * there — the sqld tokens are Fly secrets on the engine. A direct-DB export
 * would work from exactly one machine, which is the one place it must not be
 * tied to.
 *
 * READ-ONLY. Every call is a GET. This tool measures; it never writes.
 *
 *   bun run apps/scout/src/export-dataset.ts            # count only
 *   bun run apps/scout/src/export-dataset.ts --export   # + write pairs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TENANTS,
  allDocuments,
  get,
  kbGraph,
  requireKey,
  rowsOf,
  type DocumentRow,
  type KnowledgeBase,
} from './api.js';

const OUT = join(import.meta.dir, '..', 'data');

interface DerivedNeuron {
  id: string;
  filename: string;
  path: string;
  title: string | null;
  archived: boolean;
}

/**
 * The source's own text. Without it a "pair" is two ids and teaches nothing —
 * the model has to learn `document text → Neurons`, so the left-hand side has
 * to BE the text.
 */
async function sourceText(tenant: string, id: string): Promise<string | null> {
  try {
    const r = await get<{ content?: string }>(tenant, `/api/v1/documents/${id}/content`);
    return r.content ?? null;
  } catch {
    // A source whose body cannot be read is reported as null rather than as an
    // empty string: "" would train the model that this document said nothing.
    return null;
  }
}

/**
 * F286.10 — the Neuron TEXT is the compile model's target. Fetched one at a
 * time: eight parallel calls on 22/9 slowed every call to 20 s and made the
 * engine time out another session's writes.
 */
async function withNeuronText(tenant: string, neurons: DerivedNeuron[], include: boolean) {
  const sorted = [...neurons].sort((a, b) => a.id.localeCompare(b.id));
  if (!include) return sorted;
  const out = [];
  for (const n of sorted) out.push({ ...n, content: await sourceText(tenant, n.id) });
  return out;
}

export interface BrainMeasurement {
  tenant: string;
  kb: string;
  name: string;
  /** Raw source documents (the uploaded PDF, the synced page, the pasted text). */
  sources: number;
  /** Curated Neurons, however they came to exist. */
  neurons: number;
  /** Neurons reachable from a source through the candidate→event chain. */
  compiledNeurons: number;
  /** Sources that produced at least one Neuron — the usable training pairs. */
  productiveSources: number;
  /**
   * True when this brain's Neurons are overwhelmingly written rather than
   * compiled. Reported EXPLICITLY rather than silently dropped: an omission
   * with no stated reason looks like a bug to the next reader.
   */
  directlyWritten: boolean;
  reason: string;
}

export async function measureBrain(
  tenant: string,
  kb: KnowledgeBase,
  opts: { exportPairs: boolean; sourceFilter?: RegExp; withContent?: boolean },
): Promise<BrainMeasurement> {
  // F286.10 — Music's deterministic pages (musicbrainz, wikidata, discogs …) are
  // templates, and a compile model trained on them learns the template. The
  // filter runs BEFORE /derived, which costs 7-10 s per source on the engine.
  const sources = (await allDocuments(tenant, kb.slug, 'source')).filter(
    (s) => !opts.sourceFilter || opts.sourceFilter.test(s.filename ?? ''),
  );
  const neurons = await allDocuments(tenant, kb.slug, 'wiki');

  const pairs: Array<{ source: DocumentRow; neurons: DerivedNeuron[] }> = [];
  const compiled = new Set<string>();

  process.stderr.write(`  ${tenant}/${kb.slug}: ${sources.length} kilder, ${neurons.length} Neuroner — sporer…\n`);
  for (const source of sources) {
    const derived = await get<{ neurons?: DerivedNeuron[] }>(
      tenant,
      `/api/v1/documents/${source.id}/derived`,
    );
    const produced = derived.neurons ?? [];
    for (const n of produced) compiled.add(n.id);
    if (produced.length > 0) pairs.push({ source, neurons: produced });
  }

  // The discriminator. A brain whose Neurons almost never trace back to a
  // source is a WRITTEN brain — fine for the classifier, useless for compile.
  const ratio = neurons.length === 0 ? 0 : compiled.size / neurons.length;
  const directlyWritten = neurons.length > 50 && ratio < 0.2;

  if (opts.exportPairs && pairs.length > 0) {
    // Edges once per KB, not once per pair — the graph is the whole KB either
    // way, so N calls would fetch the same bytes N times.
    const { edges } = await kbGraph(tenant, kb.slug);
    const enriched = [];
    for (const p of pairs) {
      const ids = new Set(p.neurons.map((n) => n.id));
      enriched.push({
        sourceId: p.source.id,
        sourceFilename: p.source.filename ?? null,
        sourcePath: p.source.path ?? null,
        sourceText: await sourceText(tenant, p.source.id),
        neurons: await withNeuronText(tenant, p.neurons, !!opts.withContent),
        // Only edges BETWEEN this source's own Neurons. An edge pointing out
        // of the pair belongs to the wider graph, not to what this document
        // taught — including it would teach the model to invent links to
        // things it was never shown.
        edges: edges
          .filter((e) => ids.has(e.source) && ids.has(e.target))
          .sort((a, b) => `${a.source}>${a.target}`.localeCompare(`${b.source}>${b.target}`)),
      });
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, `pairs-${tenant}-${kb.slug}.json`),
      // Sorted so two runs over unchanged data produce byte-identical files —
      // otherwise the diff between two measurements is unreadable noise.
      JSON.stringify(
        [...enriched].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
        null,
        2,
      ) + '\n',
    );
  }

  return {
    tenant,
    kb: kb.slug,
    name: kb.name,
    sources: sources.length,
    neurons: neurons.length,
    compiledNeurons: compiled.size,
    productiveSources: pairs.length,
    directlyWritten,
    reason: directlyWritten
      ? `${compiled.size} af ${neurons.length} Neuroner kan spores til en kilde (${(ratio * 100).toFixed(0)} %) — skrevet direkte, ikke kompileret. Klassifikator-data, ikke compile-data.`
      : `${compiled.size} af ${neurons.length} Neuroner kan spores til en kilde (${(ratio * 100).toFixed(0)} %).`,
  };
}

async function main(): Promise<void> {
  const exportPairs = process.argv.includes('--export');
  const withContent = process.argv.includes('--with-content');
  // --only=<slug>:<filename regex>,… limits the run to those brains, and each
  // brain to the sources whose filename matches (empty regex = all sources).
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg
    ? new Map(onlyArg.slice(7).split(',').map((e) => {
        const [slug, rx] = e.split(':');
        return [slug!, rx ? new RegExp(rx) : undefined] as const;
      }))
    : null;
  const results: BrainMeasurement[] = [];

  for (const tenant of TENANTS) {
    const kbs = rowsOf<KnowledgeBase>(await get(tenant, '/api/v1/knowledge-bases'));
    for (const kb of kbs) {
      if (only && !only.has(kb.slug)) continue;
      results.push(await measureBrain(tenant, kb, { exportPairs, withContent, sourceFilter: only?.get(kb.slug) }));
    }
  }

  results.sort((a, b) => `${a.tenant}/${a.kb}`.localeCompare(`${b.tenant}/${b.kb}`));

  const w = (s: string, n: number) => s.padEnd(n).slice(0, n);
  console.log('');
  console.log(
    `${w('brain', 34)}${'kilder'.padStart(8)}${'neuroner'.padStart(10)}${'kompileret'.padStart(12)}${'brugbare par'.padStart(14)}`,
  );
  console.log('-'.repeat(78));

  const compile = results.filter((r) => !r.directlyWritten && r.productiveSources > 0);
  const written = results.filter((r) => r.directlyWritten);
  const empty = results.filter((r) => !r.directlyWritten && r.productiveSources === 0);

  for (const r of compile) {
    console.log(
      `${w(`${r.tenant}/${r.kb}`, 34)}${String(r.sources).padStart(8)}${String(r.neurons).padStart(10)}${String(r.compiledNeurons).padStart(12)}${String(r.productiveSources).padStart(14)}`,
    );
  }
  console.log('-'.repeat(78));
  const totals = compile.reduce(
    (a, r) => ({
      s: a.s + r.sources,
      n: a.n + r.neurons,
      c: a.c + r.compiledNeurons,
      p: a.p + r.productiveSources,
    }),
    { s: 0, n: 0, c: 0, p: 0 },
  );
  console.log(
    `${w('COMPILE-GRUNDLAG', 34)}${String(totals.s).padStart(8)}${String(totals.n).padStart(10)}${String(totals.c).padStart(12)}${String(totals.p).padStart(14)}`,
  );

  if (written.length > 0) {
    console.log('\nIKKE compile-materiale — Neuronerne er skrevet direkte, ikke kompileret:');
    for (const r of written) console.log(`  ${r.tenant}/${r.kb}: ${r.reason}`);
  }
  if (empty.length > 0) {
    console.log('\nIngen brugbare par (ingen kilde har produceret en Neuron):');
    for (const r of empty) console.log(`  ${r.tenant}/${r.kb} — ${r.neurons} Neuroner, ${r.sources} kilder`);
  }

  const classifierTotal = results.reduce((a, r) => a + r.neurons, 0);
  console.log(
    `\nKLASSIFIKATOR-GRUNDLAG: ${classifierTotal} Neuroner i alt (alle brains tæller, også de direkte skrevne).`,
  );

  if (exportPairs) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'measurement.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(`\nSkrevet til ${OUT}/ — measurement.json + pairs-*.json`);
  } else {
    console.log('\n(kun målt. Kør med --export for at skrive parrene til data/)');
  }
}

if (import.meta.main) {
  requireKey();
  await main();
}
