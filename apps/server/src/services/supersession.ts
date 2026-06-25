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

export interface NeuronMeta {
  confidence: number;
  sourceCount: number;
  /** documents.created_at (SQLite datetime text — lexically == chronologically sortable). */
  createdAt: string;
}

async function loadMeta(
  trail: TrailDatabase,
  tenantId: string,
  id: string,
): Promise<NeuronMeta | null> {
  const doc = await trail.db
    .select({ confidence: documents.confidence, createdAt: documents.createdAt })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)))
    .get();
  if (!doc) return null;
  const sc = await trail.db
    .select({ n: sql<number>`count(distinct ${documentReferences.sourceDocumentId})` })
    .from(documentReferences)
    .where(eq(documentReferences.wikiDocumentId, id))
    .get();
  return { confidence: doc.confidence, sourceCount: Number(sc?.n ?? 0), createdAt: doc.createdAt };
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
  return decideFromMeta(newDocumentId, a, existingDocumentId, b);
}

/**
 * Pure decision over two Neurons' meta. Exported for unit-testing without a DB.
 *
 * Confidence picks the winner — BUT a hard RECENCY GUARD prevents the bug class
 * that suppressed a freshly-saved Neuron. A brand-new Neuron starts at the
 * default 0.7 confidence — lower than an older, established Neuron near ~1.0 —
 * so on a (frequently false-positive) contradiction match the OLDER Neuron would
 * "win" and auto-supersede the NEWER one. That is backwards: supersession means
 * "a newer/better Neuron replaces an older one", never the reverse. So we refuse
 * any decision whose winner (replacement) is OLDER than its loser (target).
 *
 * Observed 2026-06-25: F199.1 (created 24 Jun) was wrongly superseded by an
 * unrelated vision-selector Neuron (10 Jun), which hid F199.1 from chat
 * entirely (isChatVisible drops superseded Neurons).
 */
export function decideFromMeta(
  newDocumentId: string,
  a: NeuronMeta,
  existingDocumentId: string,
  b: NeuronMeta,
): SupersessionDecision | null {
  const delta = a.confidence - b.confidence;
  let target: { id: string; meta: NeuronMeta };
  let replacement: { id: string; meta: NeuronMeta };
  if (delta > SUPERSEDE_CONFIDENCE_DELTA && a.sourceCount >= b.sourceCount) {
    // The new Neuron is the stronger claim → it supersedes the existing one.
    target = { id: existingDocumentId, meta: b };
    replacement = { id: newDocumentId, meta: a };
  } else if (-delta > SUPERSEDE_CONFIDENCE_DELTA && b.sourceCount >= a.sourceCount) {
    // The existing Neuron is the stronger claim → it supersedes the new one.
    target = { id: newDocumentId, meta: a };
    replacement = { id: existingDocumentId, meta: b };
  } else {
    return null;
  }
  // RECENCY GUARD — never let an OLDER Neuron supersede a NEWER one.
  if (replacement.meta.createdAt < target.meta.createdAt) return null;
  return {
    targetNeuronId: target.id,
    replacementNeuronId: replacement.id,
    replacementConfidence: replacement.meta.confidence,
    confidenceDelta: Math.abs(delta),
  };
}
