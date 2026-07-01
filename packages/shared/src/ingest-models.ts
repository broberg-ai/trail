/**
 * F149 — curated whitelist of ingest-backend model IDs.
 *
 * Single source of truth for:
 *   - F149 chain.ts default-chain definitions
 *   - F152 Runtime Model Switcher UI dropdown
 *   - verify-ingest-models.ts CI check
 *
 * Adding a new model = one entry here. Removing = delete the entry
 * AND anywhere it appears in default chains. The CI check catches
 * stale IDs by cross-referencing against provider /models endpoints.
 *
 * `costPerMillion` is the headline price in USD per million tokens
 * as advertised at 2026-04-24. Drift is expected — the cost numbers
 * shipped at `ingest_jobs.cost_cents` come from the provider's
 * actual usage response, not this table. This table is only for UI
 * hints ("~3¢ per ingest based on 2026 pricing").
 */

export type IngestBackendId = 'claude-cli' | 'openrouter' | 'mistral';

export interface IngestModel {
  /** Provider-native ID — what we pass to the API. */
  id: string;
  /** Backend that serves this model. */
  backend: IngestBackendId;
  /** Human-readable label for UI dropdowns. */
  label: string;
  /** Short description for hover tooltip. */
  description: string;
  /** Headline pricing (USD per 1M tokens). */
  costPerMillion: { input: number; output: number };
  /** Does the model support OpenAI-compatible tool calling? */
  supportsToolCalling: boolean;
  /** Rough quality tier for UI sorting ("best" → "budget"). */
  quality: 'best' | 'great' | 'good' | 'budget';
  /** True when the model is battle-tested for Trail ingest. */
  tested: boolean;
}

export const INGEST_MODELS: IngestModel[] = [
  // Claude-cli backend (not in OpenRouter registry — claude CLI
  // resolves natively via the local claude binary).
  {
    id: 'claude-sonnet-4-6',
    backend: 'claude-cli',
    label: 'Claude Sonnet 4.6 (local CLI)',
    description: 'Local claude CLI backend (dev Mac only); not in the OpenRouter registry.',
    costPerMillion: { input: 0, output: 0 },
    supportsToolCalling: true,
    quality: 'best',
    tested: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    backend: 'claude-cli',
    label: 'Claude Haiku 4.5 (local CLI)',
    description: 'Cheaper Claude variant via local CLI. Used for lint/contradiction-detection where tier-1 quality isn\'t needed.',
    costPerMillion: { input: 0, output: 0 },
    supportsToolCalling: true,
    quality: 'good',
    tested: true,
  },

  // Mistral backend — F199.10 (EU-direct, api.mistral.ai). New default for
  // ingest: it sees the WHOLE source document, the largest customer-data
  // surface in Trail. Empirically verified via a 15-page real customer PDF +
  // two synthetic sources: mistral-small-latest matched or OUTPERFORMED
  // mistral-large-latest on fact-recall in this tool-loop (large's slower
  // per-turn latency means it gets through LESS of a long document before
  // hitting the turn cap — see F199.10 plan-doc). Large is kept available
  // for manual per-KB override, not used as an automatic size-based upgrade.
  {
    id: 'mistral-small-latest',
    backend: 'mistral',
    label: 'Mistral Small (EU)',
    description: 'Default for ingest — EU-hosted, ~10x cheaper than the previous default, and matched/beat mistral-large-latest on recall in F199.10 testing.',
    costPerMillion: { input: 0.1, output: 0.3 },
    supportsToolCalling: true,
    quality: 'great',
    tested: true,
  },
  {
    id: 'mistral-large-latest',
    backend: 'mistral',
    label: 'Mistral Large (EU)',
    description: 'Higher-reasoning EU model. NOT auto-selected by document size — F199.10 testing showed it can score LOWER recall than Small on longer sources (slower per-turn, same turn budget). Available for manual per-KB override only.',
    costPerMillion: { input: 2.0, output: 6.0 },
    supportsToolCalling: true,
    quality: 'best',
    tested: true,
  },

  // OpenRouter backend — battle-tested via model-lab 2026-04-24.
  {
    id: 'google/gemini-2.5-flash',
    backend: 'openrouter',
    label: 'Gemini 2.5 Flash',
    description: 'Production favourite per model-lab benchmark. 11 turns, ~3¢ on the F149 reference fixture.',
    costPerMillion: { input: 0.3, output: 2.5 },
    supportsToolCalling: true,
    quality: 'great',
    tested: true,
  },
  {
    id: 'z-ai/glm-5.1',
    backend: 'openrouter',
    label: 'GLM 5.1',
    description: 'High-quality first-pass for the 2-pass GLM→Flash combo. Better typed-edges than single-pass models.',
    costPerMillion: { input: 1.05, output: 3.5 },
    supportsToolCalling: true,
    quality: 'great',
    tested: true,
  },
  {
    id: 'qwen/qwen3.6-plus',
    backend: 'openrouter',
    label: 'Qwen 3.6 Plus',
    description: 'Budget option. Good enough for English sources; weaker on multi-lingual fidelity.',
    costPerMillion: { input: 0.325, output: 1.95 },
    supportsToolCalling: true,
    quality: 'budget',
    tested: true,
  },
  {
    // Note: dot-separated (4.6) not dash-separated (4-6) on OpenRouter.
    // Verified via verify-ingest-models.ts against live /models registry.
    id: 'anthropic/claude-sonnet-4.6',
    backend: 'openrouter',
    label: 'Claude Sonnet 4.6 (via API)',
    description: 'Anthropic API path — high-quality last-resort when cloud fallback reaches it.',
    costPerMillion: { input: 3.0, output: 15.0 },
    supportsToolCalling: true,
    quality: 'best',
    tested: true,
  },
];

/** Lookup by ID (returns undefined for unknown IDs). */
export function findIngestModel(id: string): IngestModel | undefined {
  return INGEST_MODELS.find((m) => m.id === id);
}

/** Filter to a specific backend. */
export function modelsForBackend(backend: IngestBackendId): IngestModel[] {
  return INGEST_MODELS.filter((m) => m.backend === backend);
}

/** IDs we expect to resolve against OpenRouter's public /models list. */
export function openrouterModelIds(): string[] {
  return INGEST_MODELS.filter((m) => m.backend === 'openrouter').map((m) => m.id);
}
