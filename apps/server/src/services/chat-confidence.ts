/**
 * F182.6 — decay-aware chat retrieval helpers.
 *
 * Pure-ish helpers the chat context-builder uses to hide and rank retrieved
 * Neurons by their F182 confidence: superseded Neurons (F182.5) drop out,
 * low-confidence ones (< floor) are hidden unless curator-pinned (F182.8), and
 * survivors are ranked confidence-DESC so fresher/stronger knowledge leads the
 * LLM's context. Extracted from the route so the rules are unit-testable
 * without standing up the FTS index.
 */
import { documents, type TrailDatabase } from '@trail/db';
import { and, eq, inArray } from 'drizzle-orm';

/** Neurons below this confidence are hidden from chat (unless pinned).
 *  Generalises the F139 faded-heuristic floor to all Neuron types. */
export const CHAT_HIDE_BELOW = (() => {
  const raw = Number(process.env.TRAIL_CHAT_CONFIDENCE_FLOOR ?? 0.3);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.3;
})();

export interface NeuronConfidenceState {
  confidence: number;
  pinned: boolean;
  superseded: boolean;
}

/** Load confidence + pin + supersede state for a candidate Neuron set —
 *  one query for the whole set. */
export async function loadNeuronConfidence(
  trail: TrailDatabase,
  tenantId: string,
  ids: string[],
): Promise<Map<string, NeuronConfidenceState>> {
  const map = new Map<string, NeuronConfidenceState>();
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return map;
  const rows = await trail.db
    .select({
      id: documents.id,
      confidence: documents.confidence,
      pinned: documents.confidencePinned,
      supersededBy: documents.supersededByNeuronId,
    })
    .from(documents)
    .where(and(eq(documents.tenantId, tenantId), inArray(documents.id, unique)))
    .all();
  for (const r of rows) {
    map.set(r.id, {
      confidence: r.confidence,
      pinned: !!r.pinned,
      superseded: r.supersededBy != null,
    });
  }
  return map;
}

/** Should this Neuron appear in chat context? Unknown state → visible (a fresh
 *  Neuron at the 0.7 default). Superseded → hidden. Pinned → always visible.
 *  Otherwise gated on the confidence floor. */
export function isChatVisible(
  state: NeuronConfidenceState | undefined,
  floor: number = CHAT_HIDE_BELOW,
): boolean {
  if (!state) return true;
  if (state.superseded) return false;
  if (state.pinned) return true;
  return state.confidence >= floor;
}

/** Confidence used for ranking — unknown Neurons sort at the 0.7 default. */
export function confidenceOf(
  map: Map<string, NeuronConfidenceState>,
  id: string,
): number {
  return map.get(id)?.confidence ?? 0.7;
}
