/**
 * F286.3 — BASELINE: hvad præsterer den model vi betaler for i dag?
 *
 * Kør:
 *   bun run apps/scout/src/baseline.ts                 # 2 kørsler, hele golden-sættet
 *   bun run apps/scout/src/baseline.ts --runs 1        # én kørsel
 *   bun run apps/scout/src/baseline.ts --limit 12      # røgprøve, 12 eksempler pr. opgave
 *
 * Skriver data/baseline.json og printer tabellen. Resultatet er det tal Trail
 * Scout skal matche — uden det kan «den er lige så god» ikke afgøres, kun påstås.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HVORFOR DET HER SCRIPT FINDES, NÅR KORTET SAGDE «BRUG apps/model-lab»
 *
 * model-lab måler COMPILE. Dens eneste kvalitetsmål, `scoreRecall()`, er en
 * substring-match af kilde-fakta inde i den færdige Neuron-tekst, og
 * `runIngestComparison()` tager et helt dokument og kører hele compile-løkken.
 * Der er intet sted i den der forudsiger en ETIKET og sammenligner. Golden-
 * sættet fra F286.2 er 444 mærkede KLASSIFIKATIONS-eksempler. De to flader
 * mødes ikke, og det er målt, ikke antaget.
 *
 * Epicens constraint — «byg ikke en ny målestok, en ny harness kunne drive fra
 * produktionen» — er stadig rigtig i sin BEKYMRING, men den kan ikke bide her:
 * der findes ingen selvstændig klassifikator i produktionen at drive fra. De
 * seks valg træffes i dag INDE i compile-prompten mens den store model skriver.
 *
 * SÅ VÆR ÆRLIG OM HVAD TALLET ER: det er ikke «produktionens klassifikator målt».
 * Det er «den model produktionen betaler for, stillet de seks spørgsmål direkte».
 * Det er den rigtige sammenligning for Scout, fordi Scout kommer til at blive
 * stillet præcis de spørgsmål — men det er en KONSTRUERET klassifikator, og den
 * sætning hører med hver gang tallet citeres.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HVORFOR IKKE `ai.contracts.classify()`, SOM ELLERS ER DEN GENBRUGTE VEJ
 *
 * Fordi den har en tavs redning der er rigtig i et produkt og forkert i en
 * måling. @broberg/ai-sdk 0.38, dist/index.js:2680:
 *
 *     const label = input.labels.includes(parsed.label ?? "")
 *       ? parsed.label
 *       : input.labels[0] ?? "";
 *
 * Svarer modellen noget uden for listen — eller slet ikke — får kalderen
 * `labels[0]` tilbage, umuligt at skelne fra et ægte svar. I et produkt er det
 * den rigtige afvejning: du skal bruge en etiket. I en baseline betyder det at
 * hver gang `labels[0]` tilfældigvis ER facit, tælles et ikke-svar som korrekt.
 * Fejlen peger i den GRØNNE retning, og det er den slags der ikke opdages.
 *
 * Derfor kalder vi `ai.chat` og tæller TRE udfald, ikke to: korrekt, forkert,
 * og INTET SVAR. Et tal der ikke kan se forskel på «modellen tog fejl» og
 * «modellen svarede ikke» er ikke en baseline.
 */
import { createAI } from '@broberg/ai-sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASKS, type TaskId } from './labels.js';

const DATA = join(import.meta.dir, '..', 'data');

/** Den model produktionen faktisk kører. Målt 22. september 2026:
 *  `flyctl ssh console -a trail-engine-001 -C "printenv INGEST_BACKEND"` → mistral,
 *  og resolveIngestChain() mapper det til DEFAULT_CHAIN_MISTRAL, hvis første
 *  trin er mistral-small-latest (apps/server/src/services/ingest/chain.ts:66).
 *  mistral-large er KUN provider-resiliens — F199.10 målte at large konsekvent
 *  underpræsterer small på netop denne ingest-løkke. */
const PROVIDER = 'mistral';
const MODEL = process.env.SCOUT_BASELINE_MODEL ?? 'mistral-small-latest';
const CONCURRENCY = 8;

const SYSTEM =
  'You are a zero-shot classifier. Choose exactly one label from the provided list. ' +
  'Return ONLY JSON: {"label": "<one of the labels>"}. ' +
  'If none of the labels fit, return {"label": null} — do not invent a label.';

interface GoldenRow {
  task: TaskId;
  id: string;
  label: string;
  text: string;
  lang: string;
}

type Outcome = 'correct' | 'wrong' | 'no-answer';

interface Prediction {
  task: TaskId;
  id: string;
  truth: string;
  predicted: string | null;
  outcome: Outcome;
}

function readGolden(): GoldenRow[] {
  const raw = readFileSync(join(DATA, 'golden.jsonl'), 'utf8').trim();
  if (!raw) throw new Error('golden.jsonl er tom. Kør først: bun run apps/scout/src/build-dataset.ts');
  return raw.split('\n').map((l) => JSON.parse(l) as GoldenRow);
}

/**
 * Etiket-rummet modellen må vælge imellem.
 *
 * DEKLARERET UNION OBSERVERET, ikke det ene eller det andet. De deklarerede
 * etiketter er produktets eget skema (source-type, edge-type, admit,
 * candidate-kind har et); de observerede er hvad produktionen faktisk har
 * skrevet. En etiket der er deklareret men fraværende SKAL med — ellers
 * måler vi en model der ikke kunne tage fejl på den måde produktionen kan.
 * Og routing/neuron-type har intet skema, så dér ER de observerede etiketter
 * hele rummet.
 */
function labelSpace(): Record<TaskId, string[]> {
  const space = JSON.parse(readFileSync(join(DATA, 'label-space.json'), 'utf8')) as Record<
    string,
    { declared: string[] | null; labels?: Array<{ label: string }> }
  >;
  const out = {} as Record<TaskId, string[]>;
  for (const task of TASKS) {
    const entry = space[task];
    const observed = (entry?.labels ?? []).map((l) => l.label);
    out[task] = [...new Set([...(entry?.declared ?? []), ...observed])].sort();
  }
  return out;
}

async function classifyOne(
  ai: ReturnType<typeof createAI>,
  row: GoldenRow,
  labels: string[],
): Promise<{ predicted: string | null; model: string; provider: string }> {
  const res = await ai.chat({
    system: SYSTEM,
    prompt: `Labels: ${JSON.stringify(labels)}\n\nText:\n${row.text}`,
    // Pinnet eksplicit frem for via tier: en tier er et ALIAS der kan flyttes,
    // og et baseline-tal skal kunne læses om et halvt år uden at nogen skal
    // regne ud hvad 'cheap' pegede på dengang.
    override: { provider: PROVIDER, model: MODEL, transport: 'http' },
    maxTokens: 64,
    temperature: 0,
    responseFormat: 'json',
    purpose: 'scout-baseline',
  });

  let predicted: string | null = null;
  try {
    const parsed = JSON.parse(res.text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) as {
      label?: unknown;
    };
    // Et svar uden for etiket-rummet er INTET SVAR, ikke et forkert gæt på
    // labels[0]. Se filens hoved — det er hele grunden til at vi ikke kalder
    // contracts.classify().
    if (typeof parsed.label === 'string' && labels.includes(parsed.label)) predicted = parsed.label;
  } catch {
    predicted = null;
  }

  return { predicted, model: res.usage.model ?? '?', provider: res.usage.provider ?? '?' };
}

/** Kør `jobs` med højst `limit` i luften ad gangen. */
async function pool<T>(jobs: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const out = new Array<T>(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= jobs.length) return;
        out[i] = await jobs[i]!();
      }
    }),
  );
  return out;
}

interface RunResult {
  predictions: Prediction[];
  models: Set<string>;
  providers: Set<string>;
  failures: number;
}

async function runOnce(rows: GoldenRow[], labels: Record<TaskId, string[]>): Promise<RunResult> {
  const ai = createAI();
  const models = new Set<string>();
  const providers = new Set<string>();
  let failures = 0;
  let done = 0;

  const jobs = rows.map((row) => async (): Promise<Prediction> => {
    let predicted: string | null = null;
    try {
      const r = await classifyOne(ai, row, labels[row.task]!);
      predicted = r.predicted;
      models.add(r.model);
      providers.add(r.provider);
    } catch (err) {
      // Et kald der aldrig lykkedes er heller ikke et svar. Det tælles som
      // no-answer og rapporteres separat, så en dårlig forbindelse ikke kan
      // ligne en dårlig model.
      failures += 1;
      process.stderr.write(`  ! ${row.task}/${row.id}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    done += 1;
    if (done % 50 === 0) process.stderr.write(`  ${done}/${rows.length}\n`);
    const outcome: Outcome = predicted === null ? 'no-answer' : predicted === row.label ? 'correct' : 'wrong';
    return { task: row.task, id: row.id, truth: row.label, predicted, outcome };
  });

  const predictions = await pool(jobs, CONCURRENCY);
  return { predictions, models, providers, failures };
}

interface LabelScore {
  label: string;
  support: number;
  predicted: number;
  truePositives: number;
  precision: number | null;
  recall: number;
}

function scoreByLabel(preds: Prediction[]): LabelScore[] {
  const labels = [...new Set([...preds.map((p) => p.truth), ...preds.map((p) => p.predicted ?? '')])]
    .filter(Boolean)
    .sort();
  return labels.map((label) => {
    const support = preds.filter((p) => p.truth === label).length;
    const predicted = preds.filter((p) => p.predicted === label).length;
    const truePositives = preds.filter((p) => p.predicted === label && p.truth === label).length;
    return {
      label,
      support,
      predicted,
      truePositives,
      // null, ikke 0: modellen gættede ALDRIG på etiketten, så der er ingen
      // præcision at måle. Et 0 ville læses som «den tog altid fejl».
      precision: predicted === 0 ? null : truePositives / predicted,
      recall: support === 0 ? 0 : truePositives / support,
    };
  });
}

function accuracy(preds: Prediction[]): number {
  return preds.length === 0 ? 0 : preds.filter((p) => p.outcome === 'correct').length / preds.length;
}

function pct(n: number | null): string {
  return n === null ? '   —' : `${(n * 100).toFixed(1).padStart(5)}%`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf('--runs') + 1]) || (args.includes('--runs') ? 1 : 2);
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 0;

  if (!process.env.MISTRAL_API_KEY) {
    throw new Error('MISTRAL_API_KEY mangler. Den ligger i repoets .env — kør fra repo-roden.');
  }

  const labels = labelSpace();
  let rows = readGolden();
  if (limit > 0) {
    const perTask = new Map<string, number>();
    rows = rows.filter((r) => {
      const n = perTask.get(r.task) ?? 0;
      if (n >= limit) return false;
      perTask.set(r.task, n + 1);
      return true;
    });
  }

  process.stderr.write(`Baseline mod ${PROVIDER}/${MODEL} — ${rows.length} eksempler × ${runs} kørsler\n`);
  for (const task of TASKS) {
    const n = rows.filter((r) => r.task === task).length;
    process.stderr.write(`  ${task.padEnd(16)} ${String(n).padStart(4)} eksempler, ${labels[task]!.length} etiketter\n`);
  }

  const all: RunResult[] = [];
  for (let i = 0; i < runs; i += 1) {
    process.stderr.write(`\nKørsel ${i + 1}/${runs}…\n`);
    all.push(await runOnce(rows, labels));
  }

  const models = [...new Set(all.flatMap((r) => [...r.models]))];
  const providers = [...new Set(all.flatMap((r) => [...r.providers]))];

  // BEVIS AT DET VAR DEN MODEL VI TROEDE. `usage` kommer fra den rute der
  // FAKTISK svarede, så et fallback-spring ville stå her — og et baseline-tal
  // målt på en anden model end den produktionen kører er værre end intet tal,
  // fordi det ser rigtigt ud.
  if (models.length !== 1 || models[0] !== MODEL) {
    throw new Error(
      `Svarene kom fra ${JSON.stringify(models)} — forventede kun ${MODEL}. ` +
        `Et fallback-spring gør tallet ubrugeligt som baseline. Kørslen kasseres.`,
    );
  }

  const first = all[0]!.predictions;
  const report = {
    runAt: new Date().toISOString(),
    runAtCopenhagen: new Intl.DateTimeFormat('da-DK', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Copenhagen',
    }).format(new Date()),
    provider: providers,
    model: models[0],
    runs,
    examples: rows.length,
    // Hvad tallet ER, gemt SAMMEN med tallet. En advarsel i en README læses
    // ikke af den der om et halvt år citerer baseline.json.
    caveat:
      'Konstrueret klassifikator: produktionen har ingen selvstændig klassifikator — ' +
      'de seks valg træffes inde i compile-prompten. Dette er den model produktionen ' +
      'betaler for, stillet de seks spørgsmål direkte.',
    tasks: TASKS.map((task) => {
      const perRun = all.map((r) => accuracy(r.predictions.filter((p) => p.task === task)));
      const mine = first.filter((p) => p.task === task);
      return {
        task,
        examples: mine.length,
        labels: labels[task]!.length,
        accuracy: perRun[0]!,
        accuracyPerRun: perRun,
        spread: Math.max(...perRun) - Math.min(...perRun),
        noAnswer: mine.filter((p) => p.outcome === 'no-answer').length,
        byLabel: scoreByLabel(mine),
      };
    }),
    overall: {
      accuracyPerRun: all.map((r) => accuracy(r.predictions)),
      noAnswer: first.filter((p) => p.outcome === 'no-answer').length,
      callFailures: all.map((r) => r.failures),
    },
  };

  writeFileSync(join(DATA, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nBASELINE — ${report.model} (${report.provider.join(', ')}) · ${report.runAtCopenhagen} dansk tid`);
  console.log(`${rows.length} eksempler × ${runs} kørsler\n`);
  console.log('opgave           eks.  etik.  træfsikkerhed   spredning  intet svar');
  console.log('─'.repeat(72));
  for (const t of report.tasks) {
    console.log(
      `${t.task.padEnd(16)} ${String(t.examples).padStart(4)}  ${String(t.labels).padStart(5)}  ` +
        `${pct(t.accuracy).padStart(13)}  ${pct(t.spread).padStart(9)}  ${String(t.noAnswer).padStart(10)}`,
    );
  }
  console.log('─'.repeat(72));
  console.log(
    `${'I ALT'.padEnd(16)} ${String(rows.length).padStart(4)}         ` +
      `${pct(report.overall.accuracyPerRun[0]!).padStart(13)}             ${String(report.overall.noAnswer).padStart(10)}`,
  );

  // PR. KATEGORI, og det er ikke pynt: `cites` er 98 % af alle kanter, så et
  // samlet tal kan være højt alene fordi modellen altid svarer `cites`.
  for (const t of report.tasks) {
    console.log(`\n── ${t.task} ──`);
    console.log('  etiket                  facit  gættet  præcision  genkald');
    for (const l of t.byLabel) {
      console.log(
        `  ${l.label.padEnd(22)} ${String(l.support).padStart(5)}  ${String(l.predicted).padStart(6)}  ` +
          `${pct(l.precision).padStart(9)}  ${pct(l.recall).padStart(7)}`,
      );
    }
  }

  console.log(`\nSkrevet: apps/scout/data/baseline.json`);
}

await main();
