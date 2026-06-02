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
import { createAI, upmetricsSink, noopSink, type CostSink } from '@broberg/ai-sdk';

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
