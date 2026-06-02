/**
 * F190.5 — read Trail's per-tenant/per-KB LLM cost from upmetrics' F014 cost
 * read-API and surface it next to the internal `ingest_jobs.cost_cents` in the
 * F151 Cost panel.
 *
 * LEAK-SAFETY (hard rule): the caller passes the AUTHENTICATED tenant id (from
 * auth-ctx) and we filter server-side with `?tag.tenantId=<that>`. We NEVER use
 * `?groupBy` here — that returns ALL tenants and would re-expose the
 * cross-tenant cost leak this story exists to avoid. Engine-wide / cross-tenant
 * totals are an operator-only concern (separate surface, not this per-curator
 * route). The kbId filter narrows to the panel's KB (matches the per-KB view).
 *
 * Cost source-of-truth note: upmetrics holds *discrete* LLM-call cost (the
 * ai-sdk-routed calls — chat/vision/helpers). Ingest cost stays in
 * `ingest_jobs.cost_cents` (claude-code orchestration, not ai-sdk). This overlay
 * is supplementary, not a replacement.
 *
 * Auth: per-project `X-Upmetrics-Key` = `UPMETRICS_API_KEY` (Fly secret). When
 * unset (e.g. local dev), every call returns null so the panel simply omits the
 * overlay — never throws into the route.
 */

const UPMETRICS_BASE = process.env.UPMETRICS_BASE_URL ?? 'https://upmetrics.org';
const getKey = (): string => process.env.UPMETRICS_API_KEY ?? '';
const TTL_MS = 60_000;

export type CostWindow = 'day' | 'week' | 'month';

export interface UpmetricsCostSummary {
  generatedAt: string;
  window: { from: string; to: string };
  totalMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  runCount: number;
  metered: { meteredMicroUsd: number; freeRunCount: number };
  byModel: Array<{ key: string; microUsd: number; runCount: number }>;
  byCapability: Array<{ key: string; microUsd: number; runCount: number }>;
}

interface CacheEntry {
  summary: UpmetricsCostSummary | null;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

/** Shape of the upmetrics /api/cost/summary response (F014 frozen contract). */
interface RawSummary {
  generated_at?: string;
  window?: { from?: string; to?: string };
  total_micro_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  run_count?: number;
  metered?: { metered_micro_usd?: number; free_run_count?: number };
  by_model?: Array<{ model?: string; key?: string; micro_usd?: number; run_count?: number }>;
  by_capability?: Array<{ capability?: string; key?: string; micro_usd?: number; run_count?: number }>;
}

function mapBreakdown(
  rows: Array<{ model?: string; capability?: string; key?: string; micro_usd?: number; run_count?: number }> | undefined,
): Array<{ key: string; microUsd: number; runCount: number }> {
  return (rows ?? []).map((r) => ({
    key: r.model ?? r.capability ?? r.key ?? 'unknown',
    microUsd: r.micro_usd ?? 0,
    runCount: r.run_count ?? 0,
  }));
}

/**
 * Per-tenant (+ per-KB) discrete-LLM cost from upmetrics. `tenantId` MUST be the
 * authenticated tenant (leak-safety); `kbId` narrows to the panel's KB. Returns
 * null when no key is configured or the fetch fails — caller renders no overlay.
 */
export async function getUpmetricsCostForTenant(
  tenantId: string,
  kbId: string,
  window: CostWindow,
): Promise<UpmetricsCostSummary | null> {
  const key = getKey();
  if (!key) return null;

  const cacheKey = `${tenantId}:${kbId}:${window}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.summary;

  let summary: UpmetricsCostSummary | null = null;
  try {
    // Per-KB cost for the AUTHENTICATED tenant. upmetrics confirmed (#2797)
    // that `?tag.<key>=` filters AND on the same call, so tenantId + kbId
    // together scope to this tenant's spend on this KB. The filtered response
    // contains ONLY this tenant (no leak); tenantId is the hard leak-guard and
    // is always the authenticated tenant (never client-supplied).
    const url =
      `${UPMETRICS_BASE}/api/cost/summary?window=${window}` +
      `&tag.tenantId=${encodeURIComponent(tenantId)}` +
      `&tag.kbId=${encodeURIComponent(kbId)}`;
    const res = await fetch(url, {
      headers: { 'X-Upmetrics-Key': key },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const raw = (await res.json()) as RawSummary;
      summary = {
        generatedAt: raw.generated_at ?? '',
        window: { from: raw.window?.from ?? '', to: raw.window?.to ?? '' },
        totalMicroUsd: raw.total_micro_usd ?? 0,
        inputTokens: raw.input_tokens ?? 0,
        outputTokens: raw.output_tokens ?? 0,
        runCount: raw.run_count ?? 0,
        metered: {
          meteredMicroUsd: raw.metered?.metered_micro_usd ?? 0,
          freeRunCount: raw.metered?.free_run_count ?? 0,
        },
        byModel: mapBreakdown(raw.by_model),
        byCapability: mapBreakdown(raw.by_capability),
      };
    }
  } catch {
    summary = null; // timeout / network / parse → no overlay, never throw
  }

  cache.set(cacheKey, { summary, expiresAt: Date.now() + TTL_MS });
  return summary;
}
