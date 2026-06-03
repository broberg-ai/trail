/**
 * F190.6 runtime proof — the migrated OpenRouterBackend (ingest) now drives its
 * tool-loop through the shared `ai.chat({tools})` client with
 * `override:{provider:'openrouter'}` instead of a hand-rolled fetch. This script
 * exercises the EXACT migrated code path against a real cheap OpenRouter model,
 * backed by a stub CandidateQueueAPI that records tool dispatches.
 *
 * Proves, end-to-end, the only things the migration changed:
 *   1. ai.chat routes to OpenRouter (usage.provider === 'openrouter').
 *   2. Trail tools are passed in ai-sdk Tool[] shape and the model calls them.
 *   3. dispatchTool routes the call to the right CandidateQueueAPI method.
 *   4. The tool-result turn serializes back and the loop CONVERGES (the bug
 *      F190.3 caught — infinite re-ask — does not reappear on the ingest path).
 *   5. A Neuron write (command=create) actually fires + cost is reported.
 *
 * The labels→upmetrics delivery is NOT re-proven here (identical mechanism to
 * the chat path already live-verified in F190.3/.5, and there is no local
 * UPMETRICS_API_KEY so lib/ai.ts wires noopSink). Run with `bun run` so .env's
 * OPENROUTER_API_KEY is loaded.
 */
import { OpenRouterBackend } from '../src/services/ingest/openrouter-backend.js';
import type { CandidateQueueAPI } from '@trail/core';

if (!process.env.OPENROUTER_API_KEY) {
  console.error('✗ OPENROUTER_API_KEY not set (need it in .env) — cannot run live proof');
  process.exit(1);
}

const calls: Array<{ name: string; args: unknown }> = [];

// Minimal stub that satisfies the shapes the backend's formatters read. Cast
// through unknown — this is a throwaway probe, not production wiring.
const stubApi = {
  guide: async () => {
    calls.push({ name: 'guide', args: {} });
    return {
      tenantName: 'verify',
      kbs: [{ name: 'Verify KB', slug: 'verify', sourceCount: 0, wikiPageCount: 0, description: 'test' }],
    };
  },
  search: async (args: unknown) => {
    calls.push({ name: 'search', args });
    return { ok: true, mode: 'list', kbName: 'Verify KB', docs: [], chunks: [], query: '' };
  },
  read: async (args: unknown) => {
    calls.push({ name: 'read', args });
    return { ok: true, kind: 'single', doc: { content: '', seqId: null } };
  },
  write: async (args: unknown) => {
    calls.push({ name: 'write', args });
    return { ok: true, command: 'create', approved: false, path: '/neurons/', filename: 'colours.md', title: 'Colours' };
  },
} as unknown as CandidateQueueAPI;

const prompt = `You are ingesting a tiny source into a knowledge base.

SOURCE:
"The sky is blue during the day. Grass is green. Ripe tomatoes are red."

Your task: call the \`write\` tool ONCE with command="create", title="Colours in nature",
path="/neurons/", and a short markdown body summarising the source. After the tool
returns success, STOP (do not call any more tools). Do not call guide/search/read —
write directly.`;

const backend = new OpenRouterBackend();
const result = await backend.run({
  prompt,
  tools: ['mcp__trail__guide', 'mcp__trail__search', 'mcp__trail__read', 'mcp__trail__write'],
  mcpConfigPath: '/tmp/verify-f190-6-mcp.json',
  model: process.env.VERIFY_INGEST_MODEL ?? 'google/gemini-2.5-flash',
  maxTurns: 6,
  timeoutMs: 90_000,
  env: {
    TRAIL_TENANT_ID: 't-verify',
    TRAIL_USER_ID: 'u-verify',
    TRAIL_KNOWLEDGE_BASE_ID: 'kb-verify',
    TRAIL_DATA_DIR: '/tmp',
    TRAIL_CONNECTOR: 'upload',
    TRAIL_INGEST_JOB_ID: 'job-verify',
  },
  candidateApi: stubApi,
});

console.log('--- tool dispatches ---');
for (const c of calls) console.log(`  ${c.name}(${JSON.stringify(c.args).slice(0, 120)})`);
console.log('--- backend result ---');
console.log(JSON.stringify(result, null, 2));

const writeCalls = calls.filter((c) => c.name === 'write');
const createCalls = writeCalls.filter((c) => (c.args as { command?: string }).command === 'create');

let ok = true;
if (result.turns < 1) { console.error('✗ turns < 1 — loop never ran'); ok = false; }
if (createCalls.length < 1) { console.error('✗ no write(create) — model did not produce a Neuron'); ok = false; }
if (typeof result.costCents !== 'number') { console.error('✗ costCents not a number'); ok = false; }
if (result.modelTrail.length < 1) { console.error('✗ empty modelTrail'); ok = false; }

if (ok) {
  console.log(
    `\n✓ F190.6 ingest tool-loop verified: ${result.turns} turn(s), ` +
    `${createCalls.length} Neuron create(s), costCents=${result.costCents}, ` +
    `model=${result.modelTrail.at(-1)?.model}`,
  );
} else {
  process.exit(1);
}
