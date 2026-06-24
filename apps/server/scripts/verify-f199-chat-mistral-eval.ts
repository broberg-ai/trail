/**
 * F199.1 — "test med intern Trail-chat først" (Christian-directed gate).
 *
 * Non-destructive, NO-DEPLOY quality eval: run Trail's grounded chat-RAG task
 * shape through the shared `ai` client on the CURRENT prod model (anthropic
 * haiku-4.5) vs the F199 candidate (Mistral, EU). Same system prompt + same
 * context + same questions → side-by-side, so we judge MODEL quality (the real
 * F199 risk), not retrieval.
 *
 * Each model is called DIRECT with NO fallback and an explicit try/catch, so a
 * failure (e.g. mistral-direct adapter not wired) is reported honestly instead
 * of silently falling back to another provider and mislabelling the result.
 *
 * Run (sources the live Mistral key from ai-sdk/.env — value never printed):
 *   set -a; source /Users/cb/Apps/broberg/trail/.env
 *   export MISTRAL_API_KEY=$(grep '^MISTRAL_API_KEY=' /Users/cb/Apps/broberg/ai-sdk/.env | cut -d= -f2- | tr -d '"')
 *   set +a
 *   cd apps/server && bun run scripts/verify-f199-chat-mistral-eval.ts
 */
import { ai } from '../src/lib/ai.js';

// Faithful to ai-sdk-backend.ts: a grounded-RAG system prompt that answers ONLY
// from provided context, declines when the context lacks the answer, and mirrors
// the user's language. Context here is 3 REAL Trail facts (stand-in for retrieved
// Neurons) so we can score grounding + honesty without the retrieval stack.
const SYSTEM = `You are Trail's knowledge assistant. Answer the user's question using ONLY the information in the CONTEXT below.
- If the context does not contain the answer, say plainly that you do not have that information — never invent facts.
- Answer in the SAME language as the question.
- Be concise and stick to what the context supports.

CONTEXT:
[1] Trail runs one multi-tenant admin app (app.trailmem.com) plus a stateless engine fleet. Each tenant has its own trail.db stored on the engine's volume. The tenant→engine mapping lives in the admin's small control.db.
[2] When a cc session calls trail_save({title, content}), buddy routes the title and content VERBATIM to Trail's pending-candidate queue — buddy does not summarise or compress. The calling session writes the finished takeaway. A separate intercom→Neuron judge (DeepSeek) is the only step that runs a model.
[3] Trail's search uses SQLite FTS5 keyword matching. Trail does not use embeddings.`;

interface Q {
  lang: string;
  q: string;
  expect: string; // what a correct grounded answer should do
}
const QUESTIONS: Q[] = [
  { lang: 'EN', q: "Where is each tenant's trail.db stored?", expect: "on the engine's volume (from [1])" },
  { lang: 'DA', q: 'Komprimerer buddy indholdet når man kalder trail_save?', expect: 'NEJ — verbatim, ingen komprimering (from [2]); should answer in Danish' },
  { lang: 'EN', q: 'Which embedding model does Trail use for semantic search?', expect: 'DECLINE / correct: Trail uses FTS5 keyword search, no embeddings (from [3]) — hallucination trap' },
];

interface ModelCfg {
  label: string;
  override: { provider: string; model: string; transport: 'http' };
}
const MODELS: ModelCfg[] = [
  { label: 'haiku-4.5 (current prod)', override: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', transport: 'http' } },
  { label: 'mistral-small (F199 candidate, EU-direct)', override: { provider: 'mistral', model: 'mistral-small-latest', transport: 'http' } },
];

if (!process.env.ANTHROPIC_API_KEY) console.warn('⚠ no ANTHROPIC_API_KEY — haiku leg will fail');
if (!process.env.MISTRAL_API_KEY) console.warn('⚠ no MISTRAL_API_KEY — mistral leg will fail');

console.log('\n=== F199.1 chat-RAG quality eval — haiku vs mistral (EU) ===\n');

for (const qq of QUESTIONS) {
  console.log(`\n────────────────────────────────────────────────────────`);
  console.log(`Q (${qq.lang}): ${qq.q}`);
  console.log(`expected: ${qq.expect}`);
  for (const m of MODELS) {
    try {
      const res = await ai.chat({
        system: SYSTEM,
        messages: [{ role: 'user', content: qq.q }],
        override: m.override,
        maxTokens: 300,
        purpose: 'f199-chat-eval',
      });
      const used = `${res.usage.provider}/${res.usage.model}`;
      console.log(`\n  • ${m.label}  [${used}, $${res.usage.costUsd.toFixed(6)}]`);
      console.log(`    ${res.text.trim().replace(/\n/g, '\n    ')}`);
    } catch (e) {
      console.log(`\n  • ${m.label}  → ✗ ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
console.log('\n────────────────────────────────────────────────────────');
console.log('Read above: does mistral (a) ground correctly, (b) answer Danish in Danish,');
console.log('(c) DECLINE the embedding-model trap like haiku should? That is the F199.1 signal.\n');
