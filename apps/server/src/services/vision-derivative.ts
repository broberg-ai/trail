/**
 * F165.1 — Vision derivatives.
 *
 * Anthropic's Messages API rejects images > 5 MB. Phone photos and
 * high-res scans regularly cross that line, so vision_description
 * silently stays NULL. This service produces a WebP derivative @ q=80
 * with the long edge capped at 1568 px, persisted alongside the
 * original at the same storage path with a `.webp` suffix. The
 * original is never modified — Trail is becoming the customer's
 * Brand Intelligence Base, lossless retention is non-negotiable.
 *
 * The decision to derive lives here, not at upload-time, because:
 *   - upload-time work is already too heavy (F165 moved Vision out
 *     of the critical path); inserting an additional ~50-200ms
 *     CPU-bound encode here would re-bloat it.
 *   - many uploaded images never get Vision'd (curator archives the
 *     source, deletes the image, etc.); deriving lazily means we
 *     don't burn CPU + storage on the no-op path.
 *   - the derivative is keyed off Vision-time metadata (model,
 *     prompt) anyway, so generating right before the model call
 *     keeps the rule "derivative is the bytes the model saw" simple.
 *
 * Idempotent: a second call returns the existing derivative bytes
 * without re-encoding (storage.get is the source of truth).
 */
import sharp from 'sharp';
import { storage } from '../lib/storage.js';

const MAX_LONG_EDGE = 1568;
const WEBP_QUALITY = 80;
// Threshold: skip derivative-generation if the original is already
// small enough for Anthropic's 5 MB cap with comfortable headroom.
// 3 MB original ≈ ~3.5 MB after base64 encode (Anthropic's actual
// budget), still well under 5 MB.
const SIZE_BYTES_THRESHOLD = 3 * 1024 * 1024;
// Pixel-count threshold: Anthropic also docs a "no more than ~4M
// pixels" recommendation. A 4MP cap aligns with that and prevents
// e.g. 8000×6000 scans (48 MP) from being sent unscaled even when
// the file size happens to be under threshold.
const PIXELS_THRESHOLD = 4_000_000;

/**
 * F161.5 — single source of truth for the derivative threshold.
 * An image gets a downscaled WebP derivative when it is too big to send
 * to the vision model (>3 MB or >4 MP). The image-search endpoint reuses
 * this to decide whether to advertise a `?variant=thumb` thumbnailUrl, so
 * a hit only gets a thumb URL when a derivative would actually be produced.
 */
export function needsDerivative(width: number, height: number, sizeBytes: number): boolean {
  return sizeBytes > SIZE_BYTES_THRESHOLD || width * height > PIXELS_THRESHOLD;
}

export interface DerivativeResult {
  /** Bytes the Vision model should see (derivative if generated, original otherwise). */
  bytes: Uint8Array;
  /** True if a derivative was generated/loaded; false if the original is small enough. */
  isDerivative: boolean;
  /**
   * Storage path of the derivative if isDerivative=true, null otherwise.
   * Caller persists this on `document_images.vision_derivative_path`.
   */
  derivativePath: string | null;
}

/**
 * Decide whether the original needs a derivative, and if so, produce
 * (or load the cached) WebP version.
 *
 * @param originalPath storage-relative path to the original image
 * @param width pixel width (from document_images row)
 * @param height pixel height (from document_images row)
 * @param sizeBytes file size in bytes (from document_images row)
 */
export async function ensureDerivative(
  originalPath: string,
  width: number,
  height: number,
  sizeBytes: number,
): Promise<DerivativeResult> {
  const needs = needsDerivative(width, height, sizeBytes);

  if (!needs) {
    const bytes = await storage.get(originalPath);
    if (!bytes) {
      throw new Error(`vision-derivative: original missing at ${originalPath}`);
    }
    return { bytes, isDerivative: false, derivativePath: null };
  }

  const derivativePath = derivativePathFor(originalPath);

  // Cache hit — already encoded for a previous Vision pass.
  const existing = await storage.get(derivativePath);
  if (existing) {
    return { bytes: existing, isDerivative: true, derivativePath };
  }

  const original = await storage.get(originalPath);
  if (!original) {
    throw new Error(`vision-derivative: original missing at ${originalPath}`);
  }

  // sharp respects EXIF orientation by default for JPEG; we don't
  // strip metadata because it's harmless on a Vision-only path.
  // `withMetadata()` not called → metadata is dropped → smaller output.
  const encoded = await sharp(original)
    .rotate() // apply EXIF orientation
    .resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  await storage.put(derivativePath, encoded, 'image/webp');
  return { bytes: encoded, isDerivative: true, derivativePath };
}

/**
 * Derive `.../images/page-N-img-M.webp` from `.../images/page-N-img-M.png`.
 * Same directory, suffix-only difference — keeps the existing storage
 * helpers happy; no new path conventions to teach.
 */
export function derivativePathFor(originalPath: string): string {
  const lastDot = originalPath.lastIndexOf('.');
  const base = lastDot > 0 ? originalPath.slice(0, lastDot) : originalPath;
  return `${base}.webp`;
}

/**
 * F165.1 — strict-fallback decision for F164 Phase 3.
 *
 * Returns true ONLY for availability problems (5xx, timeout,
 * connection-reset). 4xx responses (400, 401, 413, 429 input-shape)
 * are bugs/quota issues, not availability problems, and must NOT be
 * silently routed to OpenRouter — that hides the real failure mode.
 *
 * Hooked into the Anthropic-direct backend's catch path; OpenRouter
 * fallback engages only when this returns true.
 */
export function shouldFallback(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; status?: number; code?: string; message?: string };

  // Network-level
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  if (e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') return true;

  // HTTP status
  if (typeof e.status === 'number') {
    return e.status >= 500 && e.status <= 599;
  }

  // Fallback parse — message-based for cases where the SDK didn't
  // surface a structured status. Conservative: only known
  // availability phrases.
  const msg = (e.message ?? '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('aborted')) return true;
  if (/\b5\d\d\b/.test(msg)) return true;

  return false;
}
