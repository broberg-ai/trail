/**
 * F190 follow-up — re-check contradiction-lint calibration now that the system
 * PROMPT actually reaches the model (ai-sdk 0.13 system-fix). Pre-0.13 the
 * PROMPT was silently dropped, so the model judged contradictions WITHOUT the
 * conservative guardrail ("differences in focus/phrasing/coverage are NOT
 * contradictions") — likely over-flagging. This runs the REAL production
 * checker (makeContradictionChecker) on a labeled ground-truth set and reports
 * whether detection is well-calibrated with the prompt now active.
 *
 * There is no numeric threshold to tune — the PROMPT's definition IS the knob.
 * Success = genuine contradictions flagged true, focus/coverage/paraphrase
 * differences flagged false.
 *
 * Run from apps/server:  set -a; source ../../.env; set +a; \
 *   bun run scripts/verify-contradiction-lint-calibration.ts
 */
import { makeContradictionChecker } from '../src/services/contradiction-lint.js';

if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY) {
  console.error('✗ no ANTHROPIC_API_KEY / OPENROUTER_API_KEY — cannot runtime-verify');
  process.exit(1);
}

interface Pair {
  name: string;
  a: string; // "new" passage
  b: string; // "existing" passage
  expect: boolean; // expected contradicts
  kind: string;
}

const PAIRS: Pair[] = [
  {
    name: 'direct-contradiction-retention',
    kind: 'TRUE contradiction',
    expect: true,
    a: 'The Trail engine retains deleted Neurons in a recoverable state for 30 days before they are permanently purged from the volume. An administrator can restore any Neuron within that window.',
    b: 'When a Neuron is deleted in Trail it is purged immediately and irreversibly; there is no recovery window and no administrator action can bring it back.',
  },
  {
    name: 'direct-contradiction-decay-default',
    kind: 'TRUE contradiction',
    expect: true,
    a: "Memory decay is enabled by default for every Trail tenant; a Neuron's confidence falls over time unless it is reinforced or pinned.",
    b: 'Memory decay is disabled by default in Trail. A tenant must explicitly opt in before any confidence decay is applied to its Neurons.',
  },
  {
    name: 'different-focus-not-contradiction',
    kind: 'FALSE (different focus)',
    expect: false,
    a: "The chat backend routes every turn through the shared @broberg/ai-sdk client, with an Anthropic-primary and OpenRouter-fallback chain.",
    b: 'The chat backend answers in the language configured on the knowledge base, falling back to the language of the question when none is set.',
  },
  {
    name: 'paraphrase-same-claim',
    kind: 'FALSE (paraphrase)',
    expect: false,
    a: 'A magic-link login token expires 15 minutes after it is issued; using it after that returns an error.',
    b: 'Login links in Trail are valid for a quarter of an hour — after fifteen minutes the link stops working and the user must request a new one.',
  },
  {
    name: 'coverage-difference-not-contradiction',
    kind: 'FALSE (coverage difference)',
    expect: false,
    a: 'Dropped sources are compiled into Neurons at ingest time by the engine.',
    b: 'Large sources (over a size threshold) are first chunked using one of three strategies before the compilation step runs.',
  },
];

const checker = makeContradictionChecker();
let correct = 0;
const rows: string[] = [];

for (const p of PAIRS) {
  let predicted = false;
  let raw = '';
  try {
    const res = await checker(p.a, p.b, undefined);
    predicted = res.contradicts === true;
    raw = JSON.stringify({ contradicts: res.contradicts, summary: res.summary });
  } catch (e) {
    raw = `ERROR ${e instanceof Error ? e.message : String(e)}`;
  }
  const ok = predicted === p.expect;
  if (ok) correct += 1;
  rows.push(
    `${ok ? '✓' : '✗'} [${p.kind}] ${p.name}\n    expect=${p.expect}  predicted=${predicted}  ${raw}`,
  );
}

console.log('\n=== contradiction-lint calibration (prompt now active, 0.13) ===\n');
console.log(rows.join('\n'));
console.log(`\nscore: ${correct}/${PAIRS.length} correct`);
process.exit(correct === PAIRS.length ? 0 : 1);
