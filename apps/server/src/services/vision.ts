import type { DescribeImage } from '@trail/pipelines';
import { ai } from '../lib/ai.js';

// Read keys at call-time, not module-load-time, so a key added after
// boot (or rotated) gets picked up without restart.
const getMistralKey = () => process.env.MISTRAL_API_KEY ?? '';
// F199.2 — vision migrated off Anthropic to Mistral (EU, GDPR-safe). Primary is
// the cheap, multimodal mistral-small-latest (proven to read images back in
// verify-f199-2-vision-mistral.ts, ~20× cheaper than haiku at equal quality);
// fallback is the stronger pixtral-large-latest. BOTH are Mistral/EU, so a
// fallback can never silently route customer images to a US model.
const VISION_MODEL = process.env.VISION_MODEL ?? 'mistral-small-latest';
const VISION_FALLBACK_MODEL = process.env.VISION_MODEL_FALLBACK ?? 'pixtral-large-latest';

/**
 * F190.1 — all vision goes through the shared @broberg/ai-sdk client. We pin
 * `transport:"http"` (the `claude` CLI is absent on the cloud engine). F199.2 —
 * the chain is now Mistral-primary → Mistral-fallback (both EU) via the SDK's
 * first-class `fallback`. Cost auto-reports to upmetrics via lib/ai.ts.
 */
const VISION_OVERRIDE = { provider: 'mistral', model: VISION_MODEL, transport: 'http' as const };
const VISION_FALLBACK = [
  { provider: 'mistral', model: VISION_FALLBACK_MODEL, transport: 'http' as const },
];

function hasVisionProvider(): boolean {
  return getMistralKey().length > 0;
}

/**
 * F161 — return the active vision-model name so persistImagesFromExtraction
 * can stamp `vision_model` on document_images rows. Reports the configured
 * primary; the actual per-call model also comes back in usage.model.
 */
export function getActiveVisionModel(): string {
  if (process.env.MISTRAL_API_KEY) return VISION_MODEL;
  return '';
}

// F25/F156 — vision pricing per 1M tokens (April 2026). Used ONLY as a fallback
// when the SDK reports costUsd=0 (unknown model in its price list) so
// extract_cost_cents stays populated. Subprocess/$0 legitimately yields 0.
const VISION_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  // F199.2 — Mistral (EU) vision. mistral-small is priced in the SDK table
  // (costUsd>0 there); pixtral-large is not, so this local fallback keeps
  // extract_cost_cents populated when the SDK reports 0. Claude entries kept
  // for back-compat if VISION_MODEL is overridden back to a Claude model.
  'mistral-small-latest': { inputPerM: 0.1, outputPerM: 0.3 },
  'pixtral-large-latest': { inputPerM: 2.0, outputPerM: 6.0 },
  'claude-haiku-4-5-20251001': { inputPerM: 1.0, outputPerM: 5.0 },
  'claude-sonnet-4-6': { inputPerM: 3.0, outputPerM: 15.0 },
};

function visionCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const p = VISION_PRICING[model];
  if (!p) return 0; // unknown model — don't guess a price
  const usd = (inputTokens * p.inputPerM + outputTokens * p.outputPerM) / 1_000_000;
  return Math.ceil(usd * 100); // → cents, rounded up so 0.4¢ → 1¢
}

/**
 * One discrete vision call through the SDK. Returns null when no provider is
 * configured at all (caller treats as "no vision"); throws if all configured
 * providers in the chain error (caller treats as a failed image).
 */
async function runVision(
  image: Uint8Array | Buffer,
  mimeType: string,
  prompt: string,
  purpose: string,
  labels?: Record<string, string>,
): Promise<{ text: string; model: string; costCents: number } | null> {
  if (!hasVisionProvider()) return null;
  // Copy into a fresh ArrayBuffer-backed Uint8Array (the SDK's input type is
  // Uint8Array<ArrayBuffer>; Buffer/typed-array inputs are ArrayBufferLike).
  const bytes = new Uint8Array(image);
  const res = await ai.vision({
    image: bytes,
    mimeType,
    prompt,
    tier: 'vision',
    override: VISION_OVERRIDE,
    fallback: VISION_FALLBACK,
    purpose,
    // F190.6 — per-tenant cost attribution in upmetrics. Omitted when the
    // caller has no tenant context (then the call lands untagged).
    ...(labels ? { labels } : {}),
  });
  const text = (res.text ?? '').trim();
  const model = res.usage.model || VISION_MODEL;
  const sdkCents = res.usage.costUsd > 0 ? Math.ceil(res.usage.costUsd * 100) : 0;
  const costCents = sdkCents > 0 ? sdkCents : visionCostCents(model, res.usage.inputTokens, res.usage.outputTokens);
  return { text, model, costCents };
}

// ── Standalone image-source describer (F25) ─────────────────────────────

export interface ImageDescribeResult {
  markdown: string;
  costCents: number;
  model: string;
}

const SOURCE_PROMPT = (filename: string): string =>
  `Beskriv dette billede som en stand-alone kilde i en knowledge base.\n\n` +
  `Filnavn: "${filename}"\n\n` +
  `Returnér markdown:\n` +
  `- Start med en H1 (\\#) hvor titlen reflekterer billedets indhold\n` +
  `- Beskriv det visuelle indhold faktuelt: objekter, layout, diagrammer, charts, tekst der er synlig\n` +
  `- Læs og citér alle synlige tekst-elementer\n` +
  `- Hvis det er et diagram/flowchart: beskriv komponenter + relationer mellem dem\n` +
  `- Hvis det er en tabel/skema: gengiv strukturen som markdown-tabel\n` +
  `- Ingen spekulation — kun det der faktisk er synligt\n` +
  `- Sprog: dansk\n\n` +
  `300-500 ord typisk. Ingen "decorative"-svar — billedet er uploaded som kilde, så et svar forventes.`;

/**
 * F25 — describe a standalone image source (full-image, self-contained
 * source-doc). Returns markdown + USD-cents cost (F156 credits) + model.
 */
export async function describeImageAsSource(
  bytes: Buffer,
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
  filename: string,
  labels?: Record<string, string>,
): Promise<ImageDescribeResult | null> {
  const r = await runVision(bytes, mediaType, SOURCE_PROMPT(filename), 'image-source', labels);
  if (!r || !r.text) return null;
  return { markdown: r.text, costCents: r.costCents, model: r.model };
}

// ── Embedded PDF-image describer + auto-flag (F08 / F163) ────────────────

export interface AutoFlagSignal {
  signal: boolean;
  reason: string | null;
}

export interface DescribeResult {
  description: string | null;
  autoFlag: AutoFlagSignal;
}

const QUALITY_MARKER_RE = /\[QUALITY:\s*(normal|low)\]\s*$/i;

/**
 * F163.3 Phase 0 — language-aware embedded-image prompt. Caller passes
 * KB.language so descriptions land in the locale the curator + end-users read.
 */
const EMBED_PROMPT = (page: number, language: string): string => {
  const lang = (language ?? 'en').toLowerCase();
  const langInstruction =
    lang === 'da'
      ? 'Skriv beskrivelsen på dansk.'
      : lang === 'de'
      ? 'Schreib die Beschreibung auf Deutsch.'
      : 'Write the description in English.';
  return (
    `Describe this image from page ${page} of a document in 1-2 short sentences. ${langInstruction}\n` +
    `Focus on content (diagrams, charts, labels, people, objects). Do not speculate.\n` +
    `If the image is decorative or contains no information, reply with exactly: "decorative".\n\n` +
    `End your response with EXACTLY ONE OF these markers on a new line:\n` +
    `  [QUALITY: normal]   — image has identifiable content worth keeping\n` +
    `  [QUALITY: low]      — image is too small/unclear/decorative/blank to be useful`
  );
};

const AUTO_FLAG_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /too small (and|to|for)\s+(unclear|identify|provide|make)/i, reason: 'too-small-and-unclear' },
  { pattern: /minimal graphic element/i, reason: 'minimal-graphic' },
  { pattern: /(decorative|placeholder) (mark|element|item)/i, reason: 'decorative-marker' },
  { pattern: /faint or low-contrast/i, reason: 'low-contrast' },
  { pattern: /(very small|tiny) (dark|light|black|white) (square|rectangle|shape|element)/i, reason: 'small-shape' },
  { pattern: /pixel-like shape/i, reason: 'pixel-like' },
  { pattern: /unable to (make out|discern|identify) (specific|any|the)/i, reason: 'unable-to-identify' },
];

function getMinFlagDim(): number {
  const v = Number(process.env.TRAIL_VISION_AUTO_FLAG_MIN_DIM ?? 80);
  return Number.isFinite(v) && v > 0 ? v : 80;
}

/**
 * F163.2 — parse the Vision response, strip the [QUALITY: ...] marker if
 * present, and derive the auto-flag signal from the marker (primary) or the
 * regex backstop. Exported so the PDF pipeline + vision-rerun handler share
 * one source of truth.
 */
export function parseQualitySignal(rawText: string | null): {
  cleanText: string | null;
  autoFlag: AutoFlagSignal;
} {
  if (!rawText) return { cleanText: null, autoFlag: { signal: false, reason: null } };
  const trimmed = rawText.trim();
  if (!trimmed) return { cleanText: null, autoFlag: { signal: false, reason: null } };

  const markerMatch = trimmed.match(QUALITY_MARKER_RE);
  const cleanText = (markerMatch ? trimmed.replace(QUALITY_MARKER_RE, '').trim() : trimmed) || null;

  if (markerMatch) {
    const isLow = markerMatch[1]?.toLowerCase() === 'low';
    return {
      cleanText,
      autoFlag: isLow
        ? { signal: true, reason: 'vision-prompt-low' }
        : { signal: false, reason: null },
    };
  }
  if (cleanText) {
    for (const { pattern, reason } of AUTO_FLAG_PATTERNS) {
      if (pattern.test(cleanText)) {
        return { cleanText, autoFlag: { signal: true, reason: `regex:${reason}` } };
      }
    }
  }
  return { cleanText, autoFlag: { signal: false, reason: null } };
}

/**
 * F163.2.1 — layer a dimension-threshold check on top of an existing
 * text-derived signal. Text wins if it already flagged; otherwise the
 * dim-check fires when EITHER axis is below TRAIL_VISION_AUTO_FLAG_MIN_DIM.
 */
export function applyDimensionFlag(
  existing: AutoFlagSignal,
  width?: number | null,
  height?: number | null,
): AutoFlagSignal {
  if (existing.signal) return existing;
  const minDim = getMinFlagDim();
  const w = width ?? null;
  const h = height ?? null;
  if (w !== null && h !== null && (w < minDim || h < minDim)) {
    return { signal: true, reason: `small-dimensions:${w}x${h}` };
  }
  return existing;
}

/**
 * F164 — provider chain now owned by the SDK (F199.2: Mistral primary +
 * Mistral fallback, both EU, via VISION_FALLBACK). Returns null if no key is configured or the
 * model returned the "decorative" sentinel; throws only if every provider in
 * the chain errors (caller treats as a failed image).
 */
export function createVisionBackend(labels?: Record<string, string>): DescribeImage | null {
  const rich = createVisionBackendWithMetadata(labels);
  if (!rich) return null;
  return async (pngBytes, context) => {
    const result = await rich(pngBytes, context);
    return result.description;
  };
}

export type DescribeImageWithMetadata = (
  pngBytes: Uint8Array | Buffer,
  context: { page: number; width?: number; height?: number; filename?: string; language?: string },
) => Promise<DescribeResult>;

export function createVisionBackendWithMetadata(
  labels?: Record<string, string>,
): DescribeImageWithMetadata | null {
  if (!hasVisionProvider()) return null;

  return async (pngBytes, context) => {
    const language = context.language ?? 'en';
    const r = await runVision(pngBytes, 'image/png', EMBED_PROMPT(context.page, language), 'pdf-embedded-image', labels);
    // "decorative" sentinel is a legitimate result, not an error → treat as
    // null (no description, no auto-flag) exactly like the pre-F190 path.
    let raw: string | null = r ? r.text : null;
    if (raw && raw.trim().toLowerCase() === 'decorative') raw = null;
    const { cleanText, autoFlag } = parseQualitySignal(raw);
    return { description: cleanText, autoFlag };
  };
}
