/**
 * F202.1 — model-set resolver for the ingest eval lab.
 *
 * The production whitelist (`INGEST_MODELS` in @trail/shared) is the source of
 * truth for `'all'`. Its `backend` field maps 1:1 to the real backend class
 * the lab instantiates (mistral → MistralBackend, openrouter → OpenRouterBackend).
 * `claude-cli` is excluded from `'all'` — it needs the local `claude` binary +
 * MCP stdio bridge, which the in-process lab can't drive.
 *
 * `LAB_EXTRA` holds comparison-only models that are deliberately NOT in the
 * production whitelist (e.g. a China-hosted model, or the OpenRouter mirror of
 * an EU model). They exist for curiosity/reference runs and must never be a
 * production default.
 */
import { INGEST_MODELS, findIngestModel, type IngestModel, type IngestBackendId } from '@trail/shared';

export interface EvalModel {
  /** Provider-native id passed to the backend. */
  id: string;
  /** Which real backend class serves it. */
  backend: IngestBackendId;
  /** Human label. */
  label: string;
  /** True only for GDPR-clean routing (Mistral EU-direct). OpenRouter transits
   *  US regardless of the underlying model, so anything on that backend is false. */
  euSafe: boolean;
}

// Comparison-only models NOT in the production INGEST_MODELS whitelist.
// Reference/curiosity runs — never a production default.
export const LAB_EXTRA: EvalModel[] = [
  { id: 'deepseek/deepseek-v4-flash', backend: 'openrouter', label: 'DeepSeek V4 Flash (China)', euSafe: false },
  { id: 'mistralai/mistral-small-2603', backend: 'openrouter', label: 'Mistral Small 4 (via OpenRouter)', euSafe: false },
  { id: 'google/gemini-2.5-flash-lite', backend: 'openrouter', label: 'Gemini 2.5 Flash Lite', euSafe: false },
];

function euSafe(m: IngestModel): boolean {
  return m.backend === 'mistral';
}

function toEval(m: IngestModel): EvalModel {
  return { id: m.id, backend: m.backend, label: m.label, euSafe: euSafe(m) };
}

/**
 * Resolve a model spec to concrete models.
 *   'all'       → every runnable production model (INGEST_MODELS minus
 *                 claude-cli) plus the lab-only extras.
 *   ['id', ...] → each id, resolved from INGEST_MODELS ∪ LAB_EXTRA.
 * An unknown id throws — a typo must not silently drop a model from a run.
 */
export function resolveModels(spec: 'all' | string[]): EvalModel[] {
  if (spec === 'all') {
    const prod = INGEST_MODELS.filter((m) => m.backend !== 'claude-cli').map(toEval);
    return [...prod, ...LAB_EXTRA];
  }
  return spec.map((id) => {
    const prod = findIngestModel(id);
    if (prod) return toEval(prod);
    const extra = LAB_EXTRA.find((e) => e.id === id);
    if (extra) return extra;
    const known = [...INGEST_MODELS.map((m) => m.id), ...LAB_EXTRA.map((e) => e.id)].join(', ');
    throw new Error(`Unknown model id "${id}" — not in INGEST_MODELS or lab extras. Known: ${known}`);
  });
}
