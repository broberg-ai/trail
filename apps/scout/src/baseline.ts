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
 * Svarer modellen en etiket UDEN FOR listen, får kalderen `labels[0]` tilbage,
 * umuligt at skelne fra et ægte svar. I et produkt er det den rigtige afvejning:
 * du skal bruge en etiket. I en måling betyder det at hver gang `labels[0]`
 * tilfældigvis ER facit, tælles et ikke-svar som korrekt. Fejlen peger i den
 * GRØNNE retning, og det er den slags der ikke opdages.
 *
 * PRÆCISERING (F286.7, fra ai-sdk, efterprøvet i koden): redningen fyrer KUN på
 * et PARSELIGT svar. `parseJsonLoose` (dist:2611) kaster når svaret slet ikke
 * indeholder `{` eller `[`, så den halvdel ville have stoppet løkken højlydt
 * frem for at blive scoret lydløst. Min første udgave af dette afsnit skrev
 * «eller slet ikke» og regnede derfor skaden for højt. Den parselige halvdel er
 * til gengæld netop den farlige, fordi den ligner et rigtigt svar.
 *
 * RETTET I 0.42.0 (F052) og igen i 0.47.1 (F052.2). Afsnittet ovenfor beskriver
 * altså en pakke vi ikke længere kører.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VI BLIVER ALLIGEVEL PÅ DEN EGNE PARSER — OG HER ER MÅLINGEN DER AFGJORDE DET
 *
 * F287 landede 22. september 2026: pinnet er nu eksakt 0.48.0, så den tavse
 * `labels[0]`-redning ovenfor findes ikke mere. Den oplagte konklusion er at
 * migrere tilbage. Den holder ikke endnu, og grunden er en TYPE vi har læst,
 * ikke en fornemmelse.
 *
 * AFLÆST I `node_modules/.pnpm/@broberg+ai-sdk@0.48.0/.../dist/index.d.ts:717`:
 *
 *     interface ClassifyResult {
 *       label: string | null;      // out-of-set → null   (F052, godt)
 *       rawLabel?: string;         // modellens eget svar  (F052, godt)
 *       confidence: number | null;
 *       usage: Usage;
 *     }                            // ← INTET `outcome`-felt
 *
 * To ting mangler for en MÅLING, og begge er præcis dét dette script findes for:
 *
 * 1. `out-of-set` og `unparseable` kan ikke skelnes. Begge ender som
 *    `label: null`. De er to forskellige fejl i en modelvurdering — «svarede
 *    forkert» og «svarede ikke på formen» — og et tal der blander dem er ikke
 *    en måling af nogen af dem.
 * 2. Et ULÆSELIGT svar KASTER stadig (`parseJsonLoose`). I et produkt er det
 *    rigtigt. I en baseline-kørsel dræber det løkken på svar nr. 3 af 400, og
 *    de resterende 397 bliver aldrig målt — altså den værste udgave af at
 *    mangle et tal: man opdager ikke at det mangler.
 *
 * AI-SDK HAR BYGGET BEGGE DELE, OG DE ER IKKE UDGIVET ENDNU. Deres F059 (meldt
 * til os 22/9) tilføjer `outcome: "answered" | "out-of-set" | "unparseable"` og
 * `onUnparseable: "throw" | "value"` — vores egen skærpelse, med `throw` som
 * uændret standard. Den ligger på deres `main`, ikke på npm; 0.48.0 har den
 * ikke, hvilket er dét typen ovenfor beviser.
 *
 * SÅ BETINGELSEN ER PRÆCIS OG EFTERPRØVELIG, ikke «når det passer»: den dag
 * `ClassifyResult` bærer `outcome`, migrerer `readAnswer()` til
 * `contracts.classify({ onUnparseable: "value" })` og denne blok slettes. Indtil
 * da er den egne parser ikke en dublet af pakken — den gør noget pakkens
 * udgivne udgave ikke kan.
 *
 * Vi kalder derfor `ai.chat` og tæller TRE udfald, ikke to: korrekt, forkert,
 * og INTET SVAR — sidstnævnte delt i `out-of-set` og `unparseable`.
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

/**
 * HVORFOR «INTET SVAR» IKKE ER ÉN TING (F286.7).
 *
 * F286.3 talte 39 ikke-svar som ét tal, og jeg skrev derefter at de alle ville
 * være blevet scoret som `labels[0]` af ai-sdk's classify(). Det var for højt
 * sat, og ai-sdk fangede det. Målt i den installerede 0.38, dist/index.js:2611:
 *
 *     const start = fenced.search(/[[{]/);
 *     if (start === -1) throw new Error("no JSON found in model output");
 *
 * Den KASTER når svaret ikke indeholder `{` eller `[`. labels[0]-redningen fyrer
 * altså KUN på et PARSELIGT svar der navngiver en etiket uden for listen.
 *
 * De to fejl er også forskellige for SCOUT, og det er den varige grund til at
 * skelne: `out-of-set` betyder at modellen forstod opgaven og valgte forkert
 * uden for menuen — `unparseable` betyder at den slet ikke svarede på formen.
 * Det første retter man med et bedre etiket-rum, det andet med et bedre format.
 */
type NoAnswerKind = 'out-of-set' | 'unparseable';

interface Answer {
  label: string | null;
  /** Kun sat når label er null — så fejlen kan LÆSES, ikke bare tælles. */
  raw?: string;
  kind?: NoAnswerKind;
}

interface Prediction {
  task: TaskId;
  id: string;
  truth: string;
  predicted: string | null;
  outcome: Outcome;
  noAnswerKind?: NoAnswerKind;
  raw?: string;
}

/**
 * Læs modellens rå svar som ét af tre udfald. Ren funktion, så den kan
 * modprøves uden et netværkskald — en tæller der altid svarer det samme
 * består ellers «vi tæller to slags» ved et uheld.
 */
export function readAnswer(rawText: string, labels: string[]): Answer {
  const cleaned = rawText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed: { label?: unknown };
  try {
    parsed = JSON.parse(cleaned) as { label?: unknown };
  } catch {
    return { label: null, kind: 'unparseable', raw: cleaned.slice(0, 200) };
  }
  if (typeof parsed.label === 'string' && labels.includes(parsed.label)) {
    return { label: parsed.label };
  }
  // Parselig JSON, men etiketten er ikke på menuen — eller `label` var null,
  // hvilket vores systemprompt udtrykkeligt beder om når ingen passer.
  return { label: null, kind: 'out-of-set', raw: JSON.stringify(parsed.label ?? null).slice(0, 200) };
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
): Promise<{ answer: Answer; model: string; provider: string }> {
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

  // Et svar uden for etiket-rummet er INTET SVAR, ikke et forkert gæt på
  // labels[0]. Se filens hoved — det er hele grunden til at vi ikke kalder
  // contracts.classify() på 0.38.
  const answer = readAnswer(res.text, labels);
  return { answer, model: res.usage.model ?? '?', provider: res.usage.provider ?? '?' };
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
    let answer: Answer = { label: null, kind: 'unparseable', raw: '(kaldet lykkedes aldrig)' };
    try {
      const r = await classifyOne(ai, row, labels[row.task]!);
      answer = r.answer;
      models.add(r.model);
      providers.add(r.provider);
    } catch (err) {
      // Et kald der aldrig lykkedes er heller ikke et svar. Det tælles separat
      // som callFailures, så en dårlig forbindelse ikke kan ligne en dårlig
      // model — og kørslen med nul fejl er den eneste man kan citere.
      failures += 1;
      process.stderr.write(`  ! ${row.task}/${row.id}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    done += 1;
    if (done % 50 === 0) process.stderr.write(`  ${done}/${rows.length}\n`);
    const outcome: Outcome =
      answer.label === null ? 'no-answer' : answer.label === row.label ? 'correct' : 'wrong';
    return {
      task: row.task,
      id: row.id,
      truth: row.label,
      predicted: answer.label,
      outcome,
      noAnswerKind: answer.kind,
      raw: answer.raw,
    };
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
        // DELT, fordi de to fejl retter man forskelligt: out-of-set er et
        // etiket-rums-problem, unparseable er et format-problem.
        outOfSet: mine.filter((p) => p.noAnswerKind === 'out-of-set').length,
        unparseable: mine.filter((p) => p.noAnswerKind === 'unparseable').length,
        // Hvad modellen FAKTISK svarede, når den svarede uden for menuen.
        // En optælling siger hvor mange; disse siger hvad man skal gøre ved det.
        outOfSetExamples: [
          ...new Set(mine.filter((p) => p.noAnswerKind === 'out-of-set').map((p) => p.raw ?? '')),
        ]
          .filter(Boolean)
          .slice(0, 8),
        byLabel: scoreByLabel(mine),
      };
    }),
    overall: {
      accuracyPerRun: all.map((r) => accuracy(r.predictions)),
      noAnswer: first.filter((p) => p.outcome === 'no-answer').length,
      outOfSet: first.filter((p) => p.noAnswerKind === 'out-of-set').length,
      unparseable: first.filter((p) => p.noAnswerKind === 'unparseable').length,
      callFailures: all.map((r) => r.failures),
    },
  };

  writeFileSync(join(DATA, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nBASELINE — ${report.model} (${report.provider.join(', ')}) · ${report.runAtCopenhagen} dansk tid`);
  console.log(`${rows.length} eksempler × ${runs} kørsler\n`);
  console.log('opgave           eks.  etik.  træfsikkerhed  spredning   udenfor  uparselig');
  console.log('─'.repeat(76));
  for (const t of report.tasks) {
    console.log(
      `${t.task.padEnd(16)} ${String(t.examples).padStart(4)}  ${String(t.labels).padStart(5)}  ` +
        `${pct(t.accuracy).padStart(12)}  ${pct(t.spread).padStart(9)}  ${String(t.outOfSet).padStart(8)}  ${String(t.unparseable).padStart(9)}`,
    );
  }
  console.log('─'.repeat(76));
  console.log(
    `${'I ALT'.padEnd(16)} ${String(rows.length).padStart(4)}         ` +
      `${pct(report.overall.accuracyPerRun[0]!).padStart(12)}             ` +
      `${String(report.overall.outOfSet).padStart(8)}  ${String(report.overall.unparseable).padStart(9)}`,
  );
  console.log(
    `\n  «udenfor» = modellen svarede en etiket der ikke står på menuen (parseligt svar).` +
      `\n  «uparselig» = svaret kunne ikke læses som JSON overhovedet.` +
      `\n  De rettes forskelligt, og derfor tælles de hver for sig.`,
  );
  for (const t of report.tasks) {
    if (t.outOfSetExamples.length > 0) {
      console.log(`\n  ${t.task} svarede uden for menuen: ${t.outOfSetExamples.join(', ')}`);
    }
  }

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

/**
 * KUN når filen køres som program — aldrig ved import.
 *
 * Uden denne linje kostede `bun test apps/scout/src/baseline.test.ts` en HEL
 * baseline-kørsel: 444 meterede kald, 45 sekunder, og data/baseline.json
 * overskrevet af en testkørsel. Målt første gang prøverne blev kørt.
 *
 * En test der i stilhed bruger penge og overskriver sit eget målegrundlag er
 * værre end ingen test — og den så GRØN ud, fordi de ni prøver består
 * uanset hvad der ellers skete under importen.
 */
if (import.meta.main) await main();
