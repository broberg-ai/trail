/**
 * F159 — curated whitelist of chat-backend model IDs.
 *
 * Single source of truth for:
 *   - F159 chat-chain.ts default-chain definitions
 *   - F159 admin Settings UI dropdown
 *   - future CI check against provider /models endpoints
 *
 * Adding a new model = one entry here. Removing = delete the entry
 * AND anywhere it appears in default chains.
 *
 * `costPerMillion` is the headline price in USD per million tokens
 * as advertised at 2026-05-13. Drift is expected — the cost numbers
 * shipped at `chat_messages.cost_cents` come from the provider's
 * actual usage response, not this table.
 *
 * Why a separate whitelist from INGEST_MODELS:
 *   - Chat needs cheaper / faster defaults (single-question wall-time
 *     matters; ingest is run async).
 *   - Some ingest-only models (GLM 5.1) are too slow for interactive
 *     chat even though they shine on bulk compile.
 *   - Some chat-only models (Haiku for cheap public-facing) aren't
 *     useful for ingest (multi-turn compile needs better reasoning).
 *   - Mirror-but-not-shared lets each path evolve independently.
 */

export type ChatBackendId = 'claude-cli' | 'claude-api' | 'openrouter';

export interface ChatModel {
  /** Provider-native ID — what we pass to the API. */
  id: string;
  /** Backend that serves this model. */
  backend: ChatBackendId;
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
  /** True when the model is battle-tested for Trail chat. */
  tested: boolean;
}

export const CHAT_MODELS: ChatModel[] = [
  // Claude-cli backend — Christian's Max Plan, no per-message cost
  // when subscription is active. Default for dev + Max-plan-equipped
  // hosts. Not deployable on stock Fly engines (no CLI on disk).
  {
    id: 'claude-sonnet-4-6',
    backend: 'claude-cli',
    label: 'Claude Sonnet 4.6 (Max Plan)',
    description:
      "Claude Max Plan via CLI subprocess. No per-message cost when subscription is active. Best reasoning, full MCP tool support. Dev default.",
    costPerMillion: { input: 0, output: 0 },
    supportsToolCalling: true,
    quality: 'best',
    tested: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    backend: 'claude-cli',
    label: 'Claude Haiku 4.5 (Max Plan)',
    description:
      'Cheaper Claude variant on Max Plan. Good for high-volume public-facing chat where Sonnet-grade reasoning is overkill.',
    costPerMillion: { input: 0, output: 0 },
    supportsToolCalling: true,
    quality: 'good',
    tested: true,
  },

  // Claude-API backend — direct Anthropic API call, bypasses CLI.
  // Used for Fly-deployed engines without claude binary on disk.
  {
    id: 'claude-sonnet-4-6-api',
    backend: 'claude-api',
    label: 'Claude Sonnet 4.6 (API)',
    description:
      "Direct Anthropic API call. Same quality as Max Plan CLI but per-message cost applies. Production default on Fly engines.",
    costPerMillion: { input: 3.0, output: 15.0 },
    supportsToolCalling: true,
    quality: 'best',
    tested: true,
  },
  {
    id: 'claude-haiku-4-5-20251001-api',
    backend: 'claude-api',
    label: 'Claude Haiku 4.5 (API)',
    description:
      'Direct Anthropic API call for Haiku. Cheap + fast for high-volume public chat. ~5x cheaper than Sonnet.',
    costPerMillion: { input: 0.8, output: 4.0 },
    supportsToolCalling: true,
    quality: 'good',
    tested: true,
  },

  // OpenRouter backend — cost-optimised alternatives via the OpenRouter
  // pricing layer. Good for tenants who want non-Anthropic options.
  {
    id: 'google/gemini-2.5-flash',
    backend: 'openrouter',
    label: 'Gemini 2.5 Flash',
    description:
      'Fast + cheap Google model. Strong on factual recall, weaker on multi-step reasoning. Great for public chat over a curated KB.',
    costPerMillion: { input: 0.3, output: 2.5 },
    supportsToolCalling: true,
    quality: 'great',
    tested: true,
  },
  {
    id: 'qwen/qwen3.6-plus',
    backend: 'openrouter',
    label: 'Qwen 3.6 Plus',
    description:
      'Budget option via OpenRouter. Adequate quality on English-language KBs; weaker on multi-lingual fidelity.',
    costPerMillion: { input: 0.325, output: 1.95 },
    supportsToolCalling: true,
    quality: 'budget',
    tested: true,
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    backend: 'openrouter',
    label: 'Claude Sonnet 4.6 (via OpenRouter)',
    description:
      "Anthropic Sonnet routed through OpenRouter — useful when a tenant already has OpenRouter credit and wants to avoid setting up Anthropic billing separately. Slight latency overhead.",
    costPerMillion: { input: 3.0, output: 15.0 },
    supportsToolCalling: true,
    quality: 'best',
    tested: true,
  },
];

/** Lookup by ID (returns undefined for unknown IDs). */
export function findChatModel(id: string): ChatModel | undefined {
  return CHAT_MODELS.find((m) => m.id === id);
}

/** Filter to a specific backend. */
export function chatModelsForBackend(backend: ChatBackendId): ChatModel[] {
  return CHAT_MODELS.filter((m) => m.backend === backend);
}
