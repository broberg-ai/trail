/**
 * F182.5 — supersession decision.
 *
 * Given a confirmed contradiction between two Neurons (F158), decide whether
 * one should auto-supersede the other. The rule (F182 plan-doc open question 3):
 *
 *   auto-supersede when  |Δconfidence| > DELTA  AND  winner.sourceCount >= loser.sourceCount
 *
 * where the winner is the higher-confidence Neuron and sourceCount is the
 * number of distinct provenance Sources backing it (document_references). When
 * neither side dominates, returns null — the contradiction stays a curator
 * decision via the existing contradiction-alert path. No LLM here; pure SQL +
 * arithmetic over already-computed confidence (the F182.3 decay job owns the
 * scoring).
 */
import { documents, documentReferences, type TrailDatabase } from '@trail/db';
import { and, eq, sql } from 'drizzle-orm';

/** Confidence gap required to auto-supersede. Tunable; plan-doc default 0.25. */
export const SUPERSEDE_CONFIDENCE_DELTA = (() => {
  const raw = Number(process.env.TRAIL_SUPERSEDE_DELTA ?? 0.25);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.25;
})();

export interface SupersessionDecision {
  /** The older / lower-confidence Neuron — gets marked superseded. */
  targetNeuronId: string;
  /** The newer / higher-confidence Neuron that replaces it. */
  replacementNeuronId: string;
  /** Replacement's confidence (used as the candidate's confidence). */
  replacementConfidence: number;
  /** winner − loser confidence, always > DELTA. */
  confidenceDelta: number;
}

async function loadMeta(
  trail: TrailDatabase,
  tenantId: string,
  id: string,
): Promise<{ confidence: number; sourceCount: number } | null> {
  const doc = await trail.db
    .select({ confidence: documents.confidence })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)))
    .get();
  if (!doc) return null;
  const sc = await trail.db
    .select({ n: sql<number>`count(distinct ${documentReferences.sourceDocumentId})` })
    .from(documentReferences)
    .where(eq(documentReferences.wikiDocumentId, id))
    .get();
  return { confidence: doc.confidence, sourceCount: Number(sc?.n ?? 0) };
}

/**
 * Decide whether `newDocumentId` and `existingDocumentId` should auto-supersede
 * one another. Returns the directed decision, or null when neither dominates.
 */
export async function decideSupersession(
  trail: TrailDatabase,
  tenantId: string,
  newDocumentId: string,
  existingDocumentId: string,
): Promise<SupersessionDecision | null> {
  const a = await loadMeta(trail, tenantId, newDocumentId);
  const b = await loadMeta(trail, tenantId, existingDocumentId);
  if (!a || !b) return null;

  const delta = a.confidence - b.confidence;
  if (delta > SUPERSEDE_CONFIDENCE_DELTA && a.sourceCount >= b.sourceCount) {
    // The new Neuron is the stronger claim → it supersedes the existing one.
    return {
      targetNeuronId: existingDocumentId,
      replacementNeuronId: newDocumentId,
      replacementConfidence: a.confidence,
      confidenceDelta: delta,
    };
  }
  if (-delta > SUPERSEDE_CONFIDENCE_DELTA && b.sourceCount >= a.sourceCount) {
    // The existing Neuron is the stronger claim → it supersedes the new one.
    return {
      targetNeuronId: newDocumentId,
      replacementNeuronId: existingDocumentId,
      replacementConfidence: b.confidence,
      confidenceDelta: -delta,
    };
  }
  return null;
}
