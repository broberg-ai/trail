/**
 * F190.1 — the one shared @broberg/ai-sdk client for ALL discrete LLM calls
 * in Trail (vision, chat-synthesis, translate, tag-suggest, source-infer,
 * glossary, contradiction-lint). Per Christian's standing policy, no service
 * may call a provider SDK / raw fetch directly or home-roll failover/cost — it
 * goes through this `ai` facade.
 *
 * Cost auto-reports to upmetrics via `upmetricsSink` (agentName="trail"). The
 * sink is fire-and-forget inside the SDK; if `UPMETRICS_API_KEY` is unset we
 * wire `noopSink` so a missing key NEVER blocks or throws into an LLM call.
 *
 * Providers default to the SDK's env-keyed registry (anthropic via
 * ANTHROPIC_API_KEY, openrouter via OPENROUTER_API_KEY, …). On the cloud engine
 * the `claude` CLI is absent, so callers pin `transport:"http"` in their
 * override — never rely on the subprocess transport here.
 *
 * NOT for the agentic ingest compile-loop — that stays claude-code
 * orchestration (ai-sdk is single-shot by design; see F190 plan-doc).
 */
import {
  createAI,
  upmetricsSink,
  noopSink,
  defaultProviders,
  openrouterAdapter,
  anthropicAdapter,
  type CostSink,
  type AiClient,
} from '@broberg/ai-sdk';

function buildSink(): CostSink {
  const apiKey = process.env.UPMETRICS_API_KEY;
  if (!apiKey) return noopSink; // no key → no-op; never blocks the LLM call
  return upmetricsSink({
    baseUrl: process.env.UPMETRICS_BASE_URL ?? 'https://upmetrics.org',
    apiKey,
    agentName: 'trail',
    agentKind: 'chatbot',
    onError: (err) =>
      console.warn(
        `[ai-sdk] upmetrics sink error: ${err instanceof Error ? err.message : String(err)}`,
      ),
  });
}

export const ai = createAI({ costSink: buildSink() });

/**
 * F190.6 — per-tenant key client for ingest (F149 Phase 2e). The shared `ai`
 * above keys off the engine-level env (ANTHROPIC_API_KEY / OPENROUTER_API_KEY
 * Fly secrets) — the path every current tenant on the shared engine uses. When
 * a tenant has supplied its OWN key via `tenant_secrets`, ingest passes it here
 * and we mint a throwaway client that pins that key onto the relevant adapter
 * (the SDK has no per-call apiKey override yet — flagged to ai-sdk). No
 * `process.env` mutation, so concurrent ingests with different tenant keys
 * never race. Returns the shared `ai` unchanged when no per-tenant key is set.
 */
export function aiForTenant(keys: { openrouter?: string; anthropic?: string }): AiClient {
  if (!keys.openrouter && !keys.anthropic) return ai;
  return createAI({
    costSink: buildSink(),
    providers: {
      ...defaultProviders,
      ...(keys.openrouter
        ? {
            openrouter: openrouterAdapter({
              apiKey: keys.openrouter,
              referer: 'https://trailmem.com',
              title: 'trail-ingest',
            }),
          }
        : {}),
      ...(keys.anthropic ? { anthropic: anthropicAdapter({ apiKey: keys.anthropic }) } : {}),
    },
  });
}
