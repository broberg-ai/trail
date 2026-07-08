/**
 * F202.1 — thin driver for the ingest-model eval lab. NOT a flag-CLI: cc is the
 * interface. To run a comparison, edit SOURCE_FILE / MODELS / FACTS below and:
 *   set -a; source ../../.env; set +a; bun run scripts/model-eval.ts
 *
 * The real work lives in src/services/model-eval/runner.ts (runIngestComparison),
 * which drives the REAL production ingest pipeline (buildCompilePrompt + the
 * real MistralBackend/OpenRouterBackend) against a throwaway KB. Results persist
 * to apps/model-lab/data/model-lab.db (eval_runs).
 */
import { readFileSync } from 'node:fs';
import { runIngestComparison, formatComparison } from '../src/services/model-eval/runner.js';
import type { Fact } from '../src/services/model-eval/recall.js';

// ── Edit these for a new comparison ─────────────────────────────────────────
const SOURCE_FILE =
  '/private/tmp/claude-501/-Users-cb-Apps-broberg-trail/e2438f44-1c90-43c2-9ebe-f022244ac7c8/scratchpad/zoneterapibogen-core.txt';
const SOURCE_NAME = 'zoneterapibogen-core.md';
// 'all' | string[] of ids. Both via OpenRouter here (Mistral-direct key was
// rate-limited); mistral-small-2603 == prod Mistral Small weights.
const MODELS: 'all' | string[] = ['mistralai/mistral-small-2603', 'deepseek/deepseek-v4-flash'];
// Optional grep-recall ledger; set to undefined to skip recall.
const FACTS: Fact[] | undefined = [
  { id: 'F1', needle: 'Fodsved' }, { id: 'F2', needle: 'Ligtorne' }, { id: 'F3', needle: 'Opsvulmede fødder' },
  { id: 'F4', needle: 'Vorter' }, { id: 'F5', needle: 'Kolde fødder' }, { id: 'F6', needle: 'nyre-energi' },
  { id: 'F7', needle: 'Skæl' }, { id: 'F8', needle: 'Spændt hud' }, { id: 'F9', needle: 'akupunkturpunkter' },
  { id: 'F10', needle: 'Åbnere' }, { id: 'F11', needle: 'milt-, mave-, nyre- og blæremeridianerne' },
  { id: 'F12', needle: 'Blære 60' }, { id: 'F13', needle: 'Nyre 3' }, { id: 'F14', needle: 'Mave 36' },
  { id: 'F15', needle: 'MP9' }, { id: 'F16', needle: 'MP6' }, { id: 'F17', needle: 'Pigepunktet' },
  { id: 'F18', needle: 'Behandles ikke ved gravide' }, { id: 'F19', needle: 'menstruationsbesvær' },
  { id: 'F20', needle: 'impotens' }, { id: 'F21', needle: 'hoste og astma' }, { id: 'F22', needle: 'vanskelige fødsler' },
  { id: 'F23', needle: 'Achillessenen' }, { id: 'F24', needle: 'gastrocnemicus' }, { id: 'F25', needle: 'skinnebens-condylus' },
];
// ────────────────────────────────────────────────────────────────────────────

const source = readFileSync(SOURCE_FILE, 'utf8');
console.log(`Source: ${SOURCE_NAME} (${source.length} chars) · models: ${MODELS === 'all' ? 'all' : MODELS.join(', ')} · facts: ${FACTS?.length ?? 0}\n`);

const results = await runIngestComparison({ source, sourceName: SOURCE_NAME, models: MODELS, facts: FACTS });

console.log(formatComparison(results));
console.log('\nPersisted to apps/model-lab/data/model-lab.db (eval_runs).');
process.exit(0);
