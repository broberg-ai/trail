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
  type Usage,
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
// F191.5 — telemetry sink for FREE runs that don't go through an ai.* call
// (the local-ingest compile is the interactive cc session's own work, not an
// SDK call). Reusing the same upmetricsSink keeps ONE source of truth for the
// agent_runs POST contract. noopSink when no key — never throws into a request.
const telemetrySink = buildSink();

/**
 * F191.5 — record a FREE ($0) ingest run to upmetrics for a source compiled by
 * the interactive local-ingest cc session (Max-plan). There is no ai.* call to
 * auto-report it, so the engine stamps it server-side (UPMETRICS_API_KEY stays
 * here, never reaches the Station/skill). Reports one run per compiled source —
 * cost 0, subprocess:true — so the F151/F190.5 cost panel reflects local ingest
 * VOLUME (free_run_count) alongside paid cloud ingest. Fire-and-forget.
 */
export async function reportLocalIngestRun(opts: {
  tenantId: string;
  kbId: string;
  model?: string;
}): Promise<void> {
  const usage: Usage = {
    provider: 'anthropic',
    model: opts.model ?? 'claude-code',
    transport: 'subprocess',
    capability: 'chat',
    // @broberg/ai-sdk 0.38 requires the region on every recorded run, so the
    // cost panel can answer "where did this data go" and not only "what did it
    // cost". This path is the local Claude CLI on Christian's Mac — the model
    // is Anthropic's, hosted in the US, and the call being FREE does not make
    // it EU-resident. Saying 'eu' here because no money moved would be the
    // exact conflation the field exists to prevent.
    region: 'us',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    subprocess: true,
    purpose: 'local-ingest',
    latencyMs: 0,
    labels: { tenantId: opts.tenantId, kbId: opts.kbId, connector: 'mcp:claude-code' },
    ts: new Date().toISOString(),
  };
  try {
    await telemetrySink.record(usage);
  } catch (err) {
    // Telemetry must never break the request that triggered it.
    console.warn(
      `[F191.5] local-ingest telemetry failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

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
