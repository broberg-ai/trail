/**
 * F228 — model prices come from @broberg/ai-sdk, never from a table here.
 *
 * WHY THIS FILE REPLACES TWO HAND-MAINTAINED TABLES. chat-models.ts and
 * ingest-models.ts each carried a `costPerMillion` literal, written 13 May 2026
 * with the comment "drift is expected". Measured 3 September against the SDK:
 *
 *     7 of 9 matched exactly
 *     z-ai/glm-5.1              1.1x too high  (minor)
 *     mistral-large-latest      4.0x TOO HIGH  — $2/$6 shown, $0.50/$1.50 real
 *
 * One wrong number, and the worst one it could have been: Mistral Large is the
 * `smart`/`powerful` tier, so the picker told the owner our quality option cost
 * four times what it does. A price list that is 89% right is not 89% useful —
 * it is a list you stop checking.
 *
 * THE SDK CAN DO SOMETHING OUR TABLE COULD NOT: say how old it is.
 * `pricingGeneratedAt()` returns the snapshot timestamp, so a stale number can
 * be SEEN to be stale. Our table looked equally trustworthy at any age.
 *
 * AND AN UNKNOWN PRICE IS RENDERED AS UNKNOWN, never as a number. That is the
 * whole discipline: "we do not have a price for this" and "this costs $0" must
 * not look alike, and a leftover literal is exactly how they come to.
 */
import { getModelPrice, pricingGeneratedAt } from '@broberg/ai-sdk/pricing';

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  /** GDPR region of the host — 'eu' | 'us' | 'cn' | 'other'. Comes from the
   *  SDK, so the "not GDPR-safe" note in a picker is data rather than a
   *  hand-written string that can drift away from the truth. */
  region: string;
  /** 'curated' = hand-maintained authoritative number; 'inventory' = scraped. */
  source: string;
}

/**
 * Our own ids that the SDK does not know, mapped to the ones it does.
 *
 * These exist because Trail distinguishes *how* a model is reached — the same
 * Claude model runs free through the local CLI and metered through the API — so
 * we suffix the metered variant. The SDK prices the MODEL, not the route.
 *
 * Deliberately NOT a fallback-to-guess: an id absent here AND absent from the
 * SDK returns null, and the UI says so.
 */
const ALIASES: Record<string, string> = {
  'claude-sonnet-4-6-api': 'anthropic/claude-sonnet-4.6',
  'claude-haiku-4-5-20251001-api': 'claude-haiku-4-5-20251001',
};

/**
 * Routes we do not pay for, and it is NOT a price table.
 *
 * The SDK prices a MODEL; whether WE are billed depends on the ROUTE. Claude
 * Sonnet costs $3/$15 through the API and nothing at all through the local CLI
 * on the Max plan — same model, two different facts, and only Trail knows which
 * route an id means.
 *
 * Caught while wiring this: without the distinction, `modelPricing` answered
 * $3/$15 for the free local-CLI entry, and the picker would have priced a free
 * option as our most expensive one. That is the same failure this whole file
 * exists to remove, introduced by the fix for it.
 */
const FREE_ROUTES = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);

/** Price for one of our model ids, or null when nobody knows it. */
export function modelPricing(id: string): ModelPricing | null {
  if (FREE_ROUTES.has(id)) {
    // Region still comes from the SDK where it can: the data leaves the machine
    // even when the call is free, so GDPR does not stop mattering.
    const known = getModelPrice(id);
    return { inputPer1M: 0, outputPer1M: 0, region: known?.region ?? 'us', source: 'local-cli' };
  }
  const p = getModelPrice(ALIASES[id] ?? id);
  if (!p) return null;
  return {
    inputPer1M: p.inputPer1M,
    outputPer1M: p.outputPer1M,
    region: p.region,
    source: p.source,
  };
}

/** True when a model costs nothing — the local-CLI routes. Distinguished from
 *  "unknown" on purpose: modelPricing returns null for unknown, and a free
 *  model returns a real 0/0. */
export function isFreeModel(id: string): boolean {
  const p = modelPricing(id);
  return p !== null && p.inputPer1M === 0 && p.outputPer1M === 0;
}

/** ISO timestamp of the price snapshot, so a surface can show its age. */
export function pricesGeneratedAt(): string {
  return pricingGeneratedAt();
}
