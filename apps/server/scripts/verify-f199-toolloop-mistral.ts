/**
 * F199.1 — tool-loop test: can mistral-small drive Trail's MCP tool-loop?
 *
 * The real chat backend (ai-sdk-backend.ts) does: ai.chat({tools}) → if the
 * model emits toolCalls, execute them via the Trail router, push the results
 * back as role:'tool' messages, and loop until a final answer. This script
 * reproduces that EXACT loop with ONE mock retrieval tool, for haiku (current)
 * vs mistral (candidate).
 *
 * Proof trick: the answer ("PELICAN-42") exists ONLY inside the tool result —
 * the model cannot know it without (a) emitting a well-formed tool call and
 * (b) reading the returned result. So a final answer containing PELICAN-42
 * proves the FULL loop worked end-to-end through that provider's adapter.
 *
 * Run:
 *   set -a; source /Users/cb/Apps/broberg/trail/.env; set +a
 *   cd apps/server && bun run scripts/verify-f199-toolloop-mistral.ts
 */
import { ai } from '../src/lib/ai.js';
import type { Tool, ChatResult } from '@broberg/ai-sdk';

type ChatMessages = NonNullable<Parameters<typeof ai.chat>[0]['messages']>;

const SECRET = 'PELICAN-42';

const TOOLS: Tool[] = [
  {
    name: 'search_trail_kb',
    description:
      'Search the Trail knowledge base for relevant Neurons. You have NO built-in knowledge of Trail internals, so you MUST call this to retrieve facts before answering any question about Trail.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'keyword search query, e.g. "engine fleet topology"' },
      },
      required: ['query'],
    },
  },
];

/** Mock retrieval: returns a Neuron whose body contains the SECRET, so a correct
 *  final answer can only come from having read this tool result. */
function runSearch(rawArgs: unknown): string {
  let query = '';
  try {
    const a = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
    query = (a as { query?: string })?.query ?? '';
  } catch {
    /* ignore */
  }
  return JSON.stringify([
    {
      title: 'Engine fleet topology',
      content: `Trail runs a stateless engine fleet; tenants are popped/migrated between engines by the F170 orchestrator. The verification secret code for this Neuron is ${SECRET}. (matched query: "${query}")`,
    },
  ]);
}

const SYSTEM =
  "You are Trail's assistant. You have no built-in knowledge of Trail's internals. " +
  'To answer any question you MUST first call the search_trail_kb tool, then answer ONLY from the tool result.';
const USER =
  'What is the verification secret code in the "Engine fleet topology" Neuron? Reply with ONLY the code.';

interface ModelCfg {
  label: string;
  override: { provider: string; model: string; transport: 'http' };
}
const MODELS: ModelCfg[] = [
  { label: 'haiku-4.5 (current prod)', override: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', transport: 'http' } },
  { label: 'mistral-small (F199 candidate)', override: { provider: 'mistral', model: 'mistral-small-latest', transport: 'http' } },
];

async function runLoop(m: ModelCfg): Promise<{ ok: boolean; turns: number; toolCalled: boolean; answer: string; trace: string[] }> {
  const messages: ChatMessages = [{ role: 'user', content: USER }];
  const trace: string[] = [];
  let toolCalled = false;
  for (let turn = 0; turn < 5; turn++) {
    const res: ChatResult = await ai.chat({
      system: SYSTEM,
      messages,
      tools: TOOLS,
      override: m.override,
      maxTokens: 500,
      purpose: 'f199-toolloop',
    });
    if (res.toolCalls && res.toolCalls.length > 0) {
      toolCalled = true;
      for (const tc of res.toolCalls) {
        trace.push(`turn ${turn}: → tool ${tc.name}(${JSON.stringify(tc.arguments)})`);
      }
      messages.push({ role: 'assistant', content: res.text ?? '', toolCalls: res.toolCalls });
      for (const tc of res.toolCalls) {
        messages.push({ role: 'tool', toolCallId: tc.id, content: runSearch(tc.arguments) });
      }
      continue;
    }
    const answer = (res.text ?? '').trim();
    trace.push(`turn ${turn}: ← final "${answer}"  [${res.usage.provider}/${res.usage.model}]`);
    return { ok: answer.includes(SECRET), turns: turn + 1, toolCalled, answer, trace };
  }
  return { ok: false, turns: 5, toolCalled, answer: '(no final answer in 5 turns)', trace };
}

if (!process.env.ANTHROPIC_API_KEY) console.warn('⚠ no ANTHROPIC_API_KEY');
if (!process.env.MISTRAL_API_KEY) console.warn('⚠ no MISTRAL_API_KEY');

console.log('\n=== F199.1 tool-loop test — can the model drive Trail retrieval? ===');
console.log(`(secret "${SECRET}" is ONLY in the tool result → correct answer proves the loop)\n`);

let allPass = true;
for (const m of MODELS) {
  console.log(`──────── ${m.label} ────────`);
  try {
    const r = await runLoop(m);
    for (const t of r.trace) console.log(`   ${t}`);
    console.log(`   tool-called: ${r.toolCalled ? 'YES' : 'NO'} · turns: ${r.turns} · secret-in-answer: ${r.ok ? 'YES' : 'NO'}`);
    console.log(`   → ${r.ok ? '✅ PASS (drove the full tool-loop)' : '✗ FAIL'}\n`);
    if (!r.ok) allPass = false;
  } catch (e) {
    console.log(`   ✗ ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
    allPass = false;
  }
}
console.log(allPass ? '=== ALL PASS — both providers drive the tool-loop ===\n' : '=== SOME FAIL — see above ===\n');
process.exit(allPass ? 0 : 1);
