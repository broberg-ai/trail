/**
 * F182.7 — Memory Health data (pure SQL, no LLM). Extracted from the route so
 * the histogram bucketing + decaying/superseded queries are unit-testable
 * without standing up Hono + auth.
 */
import { documents, confidenceSignals, type TrailDatabase } from '@trail/db';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

export const DECAYING_CONFIDENCE_MAX = 0.5; // plan-doc deemphasise threshold
export const REINFORCEMENT_WINDOW_DAYS = 30;
const LIST_LIMIT = 100;

export interface DecayingNeuron {
  id: string;
  filename: string;
  title: string | null;
  path: string;
  confidence: number;
  lastRecomputedAt: number | null;
}

export interface SupersededChain {
  id: string;
  filename: string;
  title: string | null;
  path: string;
  replacementId: string | null;
  replacementFilename: string | null;
  replacementTitle: string | null;
}

export interface MemoryHealth {
  histogram: number[]; // 5 buckets: [0,0.2) … [0.8,1.0]
  decaying: DecayingNeuron[];
  superseded: SupersededChain[];
}

export async function getMemoryHealth(
  trail: TrailDatabase,
  tenantId: string,
  kbId: string,
  now: number = Date.now(),
): Promise<MemoryHealth> {
  const wikiScope = and(
    eq(documents.tenantId, tenantId),
    eq(documents.knowledgeBaseId, kbId),
    eq(documents.kind, 'wiki'),
    eq(documents.archived, false),
  );

  // Histogram — FLOOR(conf*5) is 0..5 (5 only at exactly 1.0); MIN(4,…) folds
  // the top edge into the last bucket so we get exactly 5 buckets.
  const bucketRows = await trail.db
    .select({
      bucket: sql<number>`CAST(MIN(4, CAST(${documents.confidence} * 5 AS INTEGER)) AS INTEGER)`,
      n: sql<number>`COUNT(*)`,
    })
    .from(documents)
    .where(wikiScope)
    .groupBy(sql`1`)
    .all();
  const histogram = [0, 0, 0, 0, 0];
  for (const r of bucketRows) {
    histogram[Math.max(0, Math.min(4, Number(r.bucket)))] = Number(r.n);
  }

  const cutoff = now - REINFORCEMENT_WINDOW_DAYS * 24 * 3600 * 1000;
  const decaying = await trail.db
    .select({
      id: documents.id,
      filename: documents.filename,
      title: documents.title,
      path: documents.path,
      confidence: documents.confidence,
      lastRecomputedAt: documents.confidenceLastRecomputedAt,
    })
    .from(documents)
    .where(
      and(
        wikiScope,
        lt(documents.confidence, DECAYING_CONFIDENCE_MAX),
        eq(documents.confidencePinned, false),
        sql`${documents.supersededByNeuronId} IS NULL`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${confidenceSignals} cs
          WHERE cs.neuron_id = ${documents.id}
            AND cs.signal_type IN ('cite','access','chat-cite')
            AND cs.recorded_at > ${cutoff}
        )`,
      ),
    )
    .orderBy(documents.confidence)
    .limit(LIST_LIMIT)
    .all();

  const replacement = alias(documents, 'replacement');
  const superseded = await trail.db
    .select({
      id: documents.id,
      filename: documents.filename,
      title: documents.title,
      path: documents.path,
      replacementId: replacement.id,
      replacementFilename: replacement.filename,
      replacementTitle: replacement.title,
    })
    .from(documents)
    .leftJoin(replacement, eq(replacement.id, documents.supersededByNeuronId))
    .where(and(wikiScope, isNotNull(documents.supersededByNeuronId)))
    .limit(LIST_LIMIT)
    .all();

  return { histogram, decaying, superseded };
}
