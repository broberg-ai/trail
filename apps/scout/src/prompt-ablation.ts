/**
 * F286.8 — PRESSER EN PROMPT DER FORBYDER AFSLAG FEJLENE IND I MENUEN?
 *
 * Kør:
 *   bun run apps/scout/src/prompt-ablation.ts               # alle 444 × 3 varianter
 *   bun run apps/scout/src/prompt-ablation.ts --limit 12    # røgprøve, 12 pr. opgave
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SPØRGSMÅLET, OG HVORFOR DET ER VORES AT SVARE PÅ
 *
 * ai-sdk-sessionen rejste det 22. september 2026 om deres egen classify():
 *
 *   «med vores prompt vil en model der ikke kan svare formentlig VÆLGE noget
 *   frem for at afvise. Det svar lander så INDE i menuen, og label: null kan
 *   ikke fange det. Vi har altså gjort "uden for menuen" synligt og ikke rørt
 *   "gættede inden for menuen", som er den større og stillere kategori.»
 *
 * De kan se HVAD deres pakke returnerer, men ikke om det var rigtigt. Vi har
 * facit for alle 444 eksempler, så vi er det eneste sted spørgsmålet kan måles.
 *
 * Og det er ikke kun en tjeneste til en peer. F286.3 målte at routing og
 * edge-type er de to svageste opgaver — og det er de SAMME to hvor modellen
 * afviser mest. Er afvisningen ægte, er et presset gæt ren støj, og Scout må
 * ikke trænes til at producere den. Er den dovenskab, er presset den billigste
 * forbedring vi har.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HVORFOR TRE VARIANTER OG IKKE TO
 *
 * Kortet forudsatte at vores prompt og ai-sdk's adskilte sig på TO akser —
 * invitationen til at afvise OG længden — og bad om en tredje kørsel hvis de
 * kunne isoleres. De kan. AFLÆST i den installerede pakke,
 * `node_modules/.pnpm/@broberg+ai-sdk@0.48.0/node_modules/@broberg/ai-sdk/dist/index.js:2949`:
 *
 *     system: 'You are a zero-shot classifier. Choose exactly one label from the
 *              provided list. Return ONLY JSON: {"label": "<one of the labels>",
 *              "confidence": <0..1>}.'
 *
 * Det er ORDRET vores to første sætninger. Forskellen er derfor ikke længde i
 * almindelighed — den er præcis to ting: vores ekstra afvisnings-sætning, og
 * deres ekstra `confidence`-felt. Så:
 *
 *     A  ours              de tre sætninger vi målte baseline med
 *     B  ai-sdk            deres prompt, verbatim fra dist
 *     C  ours-no-refusal   A minus sidste sætning — INTET andet ændret
 *
 *   C mod A isolerer invitationen alene (identiske bortset fra den ene sætning).
 *   B mod C isolerer confidence-feltet alene.
 *
 * Havde vi kun kørt A mod B, ville et hvilket som helst udslag være tvetydigt
 * mellem de to, og den tvetydighed ville have stået i tallet for altid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HVORFOR A KØRES OM, SELV OM BASELINE ALLEREDE HAR MÅLT DEN
 *
 * data/baseline.json gemmer AGGREGATER, ikke de enkelte forudsigelser. Det
 * bærende tal her er et JOIN pr. eksempel — «af de eksempler A afviste, hvad
 * blev de til under C» — og det kan ikke udledes af to procenttal lagt ved
 * siden af hinanden. To kørsler med samme samlede træfsikkerhed kan have byttet
 * rundt på hvert eneste eksempel.
 *
 * Så A køres om her, i samme kørsel som B og C, og de tre joines på id.
 * data/baseline.json røres ikke.
 */
import { createAI } from '@broberg/ai-sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASKS, type TaskId } from './labels.js';
import { readAnswer, readGolden, labelSpace, type GoldenRow } from './baseline.js';

const DATA = join(import.meta.dir, '..', 'data');

/** Samme model og temperatur som F286.3. Ændres andet end prompten, måler vi
 *  ikke prompten. */
const PROVIDER = 'mistral';
const MODEL = process.env.SCOUT_BASELINE_MODEL ?? 'mistral-small-latest';
const CONCURRENCY = 8;

/** Sætning 1+2 — fælles for alle tre varianter, og dét er hele pointen med
 *  ablationen: kun halen skifter. */
const HEAD =
  'You are a zero-shot classifier. Choose exactly one label from the provided list. ';

export interface Variant {
  id: 'ours' | 'ai-sdk' | 'ours-no-refusal';
  /** Hvad varianten ændrer i forhold til `ours`, i én linje — så tabellen kan
   *  læses uden at slå prompten op. */
  changes: string;
  system: string;
  /** Hvor teksten kommer fra. En prompt der PÅSTÅS at være en andens er
   *  værdiløs som sammenligning; denne kan efterprøves. */
  provenance: string;
}

export const VARIANTS: Variant[] = [
  {
    id: 'ours',
    changes: '(udgangspunkt) inviterer eksplicit til {"label": null}',
    system:
      `${HEAD}Return ONLY JSON: {"label": "<one of the labels>"}. ` +
      'If none of the labels fit, return {"label": null} — do not invent a label.',
    provenance: 'apps/scout/src/baseline.ts — SYSTEM, den prompt F286.3 målte med',
  },
  {
    id: 'ai-sdk',
    changes: 'ingen invitation til at afvise; beder desuden om et confidence-felt',
    system: `${HEAD}Return ONLY JSON: {"label": "<one of the labels>", "confidence": <0..1>}.`,
    provenance:
      'VERBATIM fra node_modules/.pnpm/@broberg+ai-sdk@0.48.0/node_modules/@broberg/ai-sdk/dist/index.js:2949',
  },
  {
    id: 'ours-no-refusal',
    changes: 'ours minus afvisnings-sætningen — intet andet ændret',
    system: `${HEAD}Return ONLY JSON: {"label": "<one of the labels>"}.`,
    provenance: 'ours med sidste sætning fjernet; isolerer invitationen fra confidence-feltet',
  },
];

type Outcome = 'correct' | 'wrong' | 'no-answer';

interface Prediction {
  task: TaskId;
  id: string;
  truth: string;
  predicted: string | null;
  outcome: Outcome;
  raw?: string;
  /** Kaldet lykkedes aldrig. Så findes der intet svar at bedømme — og især
   *  ingen AFVISNING. Uden flaget ville en ustabil forbindelse lande som
   *  `no-answer` og puste netop det tal op kortet findes for. */
  failed?: boolean;
}

/**
 * Hvad et eksempel BLEV til, fra én variant til en anden.
 *
 * `refusal→wrong` er tallet hele kortet handler om: modellen afviste før, og
 * presses den, gætter den forkert INDE i menuen — hvor `label: null` ikke kan
 * fange det. `refusal→correct` er den modsatte konklusion: afvisningen var
 * dovenskab, og presset er gratis kvalitet.
 */
type Transition =
  | 'refusal→correct'
  | 'refusal→wrong'
  | 'refusal→refusal'
  | 'correct→wrong'
  | 'correct→correct'
  | 'correct→refusal'
  | 'wrong→correct'
  | 'wrong→wrong'
  | 'wrong→refusal';

function outcomeOf(p: Prediction): 'refusal' | 'correct' | 'wrong' {
  if (p.outcome === 'no-answer') return 'refusal';
  return p.outcome === 'correct' ? 'correct' : 'wrong';
}

async function classifyOne(
  ai: ReturnType<typeof createAI>,
  variant: Variant,
  row: GoldenRow,
  labels: string[],
): Promise<{ label: string | null; raw?: string; model: string }> {
  const res = await ai.chat({
    system: variant.system,
    prompt: `Labels: ${JSON.stringify(labels)}\n\nText:\n${row.text}`,
    override: { provider: PROVIDER, model: MODEL, transport: 'http' },
    maxTokens: 64,
    temperature: 0,
    responseFormat: 'json',
    purpose: `scout-prompt-ablation:${variant.id}`,
  });
  // Samme læser som baseline: en etiket uden for menuen er INTET SVAR, ikke et
  // gæt på labels[0]. Den tolererer ai-sdk-variantens ekstra `confidence`-felt,
  // fordi den kun læser `.label`.
  const a = readAnswer(res.text, labels);
  return { label: a.label, raw: a.raw, model: res.usage.model ?? '?' };
}

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

async function runVariant(
  variant: Variant,
  rows: GoldenRow[],
  labels: Record<TaskId, string[]>,
): Promise<{ predictions: Prediction[]; models: Set<string>; failures: number }> {
  const ai = createAI();
  const models = new Set<string>();
  let failures = 0;
  let done = 0;

  const jobs = rows.map((row) => async (): Promise<Prediction> => {
    let label: string | null = null;
    let raw: string | undefined = '(kaldet lykkedes aldrig)';
    let failed = false;
    try {
      const r = await classifyOne(ai, variant, row, labels[row.task]!);
      label = r.label;
      raw = r.raw;
      models.add(r.model);
    } catch (err) {
      failures += 1;
      failed = true;
      process.stderr.write(
        `  ! ${variant.id} ${row.task}/${row.id}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    done += 1;
    if (done % 100 === 0) process.stderr.write(`  ${variant.id}: ${done}/${rows.length}\n`);
    return {
      task: row.task,
      id: row.id,
      truth: row.label,
      predicted: label,
      outcome: label === null ? 'no-answer' : label === row.label ? 'correct' : 'wrong',
      raw,
      failed,
    };
  });

  return { predictions: await pool(jobs, CONCURRENCY), models, failures };
}

function accuracy(preds: Prediction[]): number {
  return preds.length === 0 ? 0 : preds.filter((p) => p.outcome === 'correct').length / preds.length;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1).padStart(5)}%`;
}

/** Join to varianters forudsigelser PR. EKSEMPEL og tæl overgangene. */
export function transitions(from: Prediction[], to: Prediction[]): Record<Transition, number> {
  const byId = new Map(to.map((p) => [`${p.task}/${p.id}`, p]));
  const counts = {} as Record<Transition, number>;
  for (const a of from) {
    const b = byId.get(`${a.task}/${a.id}`);
    // Et fejlet kald er ikke en afvisning og ikke et gæt — det er intet. Tælles
    // det med, bliver en netværksfejl til «refusal→…» i det bærende tal.
    if (!b || a.failed || b.failed) continue;
    const key = `${outcomeOf(a)}→${outcomeOf(b)}` as Transition;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function t(counts: Record<Transition, number>, k: Transition): number {
  return counts[k] ?? 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
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

  process.stderr.write(
    `Prompt-ablation mod ${PROVIDER}/${MODEL} — ${rows.length} eksempler × ${VARIANTS.length} varianter\n`,
  );

  const results = new Map<string, { predictions: Prediction[]; failures: number }>();
  const allModels = new Set<string>();
  for (const v of VARIANTS) {
    process.stderr.write(`\n${v.id} — ${v.changes}\n`);
    const r = await runVariant(v, rows, labels);
    results.set(v.id, { predictions: r.predictions, failures: r.failures });
    for (const m of r.models) allModels.add(m);
  }

  // Samme spærre som baseline: et fallback-spring gør sammenligningen
  // meningsløs, for så er det ikke prompten der skiftede.
  const models = [...allModels];
  if (models.length !== 1 || models[0] !== MODEL) {
    throw new Error(
      `Svarene kom fra ${JSON.stringify(models)} — forventede kun ${MODEL}. ` +
        `Et fallback-spring betyder at varianterne ikke blev målt mod samme model. Kørslen kasseres.`,
    );
  }

  const ours = results.get('ours')!.predictions;

  const report = {
    runAt: new Date().toISOString(),
    runAtCopenhagen: new Intl.DateTimeFormat('da-DK', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Copenhagen',
    }).format(new Date()),
    model: models[0],
    examples: rows.length,
    question:
      'Presser en prompt der forbyder afslag fejlene IND i menuen, hvor label:null ikke kan fange dem?',
    variants: VARIANTS.map((v) => ({ id: v.id, changes: v.changes, provenance: v.provenance, system: v.system })),
    perVariant: VARIANTS.map((v) => {
      const preds = results.get(v.id)!.predictions;
      return {
        id: v.id,
        accuracy: accuracy(preds),
        refusals: preds.filter((p) => p.outcome === 'no-answer' && !p.failed).length,
        wrong: preds.filter((p) => p.outcome === 'wrong').length,
        callFailures: results.get(v.id)!.failures,
        byTask: TASKS.map((task) => {
          const mine = preds.filter((p) => p.task === task);
          return {
            task,
            examples: mine.length,
            accuracy: accuracy(mine),
            refusals: mine.filter((p) => p.outcome === 'no-answer' && !p.failed).length,
          };
        }),
      };
    }),
    // DET BÆRENDE: hvad blev de afviste eksempler til, pr. eksempel-id.
    transitions: VARIANTS.filter((v) => v.id !== 'ours').map((v) => {
      const to = results.get(v.id)!.predictions;
      return {
        from: 'ours',
        to: v.id,
        overall: transitions(ours, to),
        byTask: TASKS.map((task) => ({
          task,
          counts: transitions(
            ours.filter((p) => p.task === task),
            to.filter((p) => p.task === task),
          ),
        })),
      };
    }),
  };

  writeFileSync(join(DATA, 'prompt-ablation.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nPROMPT-ABLATION — ${report.model} · ${report.runAtCopenhagen} dansk tid`);
  console.log(`${rows.length} eksempler, temperatur 0, kun prompten ændres\n`);
  console.log('variant            træfsikkerhed  afvisninger  forkerte  kaldfejl');
  console.log('─'.repeat(68));
  for (const v of report.perVariant) {
    console.log(
      `${v.id.padEnd(18)} ${pct(v.accuracy).padStart(12)}  ${String(v.refusals).padStart(11)}  ` +
        `${String(v.wrong).padStart(8)}  ${String(v.callFailures).padStart(8)}`,
    );
  }

  for (const tr of report.transitions) {
    const c = tr.overall;
    const refused = t(c, 'refusal→correct') + t(c, 'refusal→wrong') + t(c, 'refusal→refusal');
    console.log(`\n── ours → ${tr.to} ──`);
    console.log(`  af ${refused} afviste under ours:`);
    console.log(`    blev RIGTIGE            ${String(t(c, 'refusal→correct')).padStart(4)}`);
    console.log(`    blev FORKERTE i menuen  ${String(t(c, 'refusal→wrong')).padStart(4)}   ← det tal kortet findes for`);
    console.log(`    afviste stadig          ${String(t(c, 'refusal→refusal')).padStart(4)}`);
    console.log(`  prisen for at presse:`);
    console.log(`    korrekte der blev forkerte  ${String(t(c, 'correct→wrong')).padStart(4)}`);
    console.log(`    korrekte der blev afvist    ${String(t(c, 'correct→refusal')).padStart(4)}`);
    console.log(`    forkerte der blev rigtige   ${String(t(c, 'wrong→correct')).padStart(4)}`);
    console.log('  pr. opgave (afvist→rigtig / afvist→forkert / afvist→afvist):');
    for (const bt of tr.byTask) {
      const b = bt.counts;
      const n = t(b, 'refusal→correct') + t(b, 'refusal→wrong') + t(b, 'refusal→refusal');
      if (n === 0) continue;
      console.log(
        `    ${bt.task.padEnd(16)} ${String(t(b, 'refusal→correct')).padStart(3)} / ` +
          `${String(t(b, 'refusal→wrong')).padStart(3)} / ${String(t(b, 'refusal→refusal')).padStart(3)}`,
      );
    }
  }

  console.log(`\nSkrevet: apps/scout/data/prompt-ablation.json`);
}

/**
 * KUN når filen køres som program — aldrig ved import.
 *
 * Samme spærre som baseline.ts, og af samme målte grund: uden den kostede en
 * import fra en testfil en hel kørsel i stilhed. Her ville det være 1.332
 * meterede kald.
 */
if (import.meta.main) await main();
