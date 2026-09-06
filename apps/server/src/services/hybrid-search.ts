/**
 * F254.2 — vektor-halvdelen af hybrid genfinding.
 *
 * Returnerer KUN en rangeret liste af dokument-id'er. Den henter ikke rækker,
 * filtrerer ikke på publikum, og renser ikke hemmeligheder — og det er hele
 * pointen med at den ser sådan ud.
 *
 * HVORFOR IKKE EN PARALLEL SØGEVEJ. Den nuværende rute bærer 16 kontroller:
 * publikums-filter (F160, så en ekstern nøgle ikke ser heuristikker),
 * tag-filter (F92), hemmeligheds-scrubning (F197), `#`-opslag (F145).
 * En anden vej ind til de samme data, med sine egne kopier af de spærrer, er
 * præcis hvordan man lækker interne Neuroner til en kunde: kopien glemmer ét
 * filter, og ingen opdager det, fordi den gamle vej stadig er rigtig.
 *
 * Derfor føder denne funktion KANDIDATER ind ØVERST i den eksisterende tragt.
 * Alle filtre nedenfor gælder automatisk, fordi der kun er én tragt.
 */
import { cosine, loadVectors, coverage } from '@trail/core';
import type { TrailDatabase } from '@trail/db';
import { embed } from './embedder.js';

export interface VectorHit { documentId: string; score: number }

export interface VectorSearchResult {
  hits: VectorHit[];
  /** Andel af videnbasens tekststykker med en brugbar vektor. */
  coverage: number;
  /** Hvorfor vektor-halvdelen ikke bidrog, hvis den ikke gjorde. */
  unavailable?: 'no-embeddings' | 'embedding-failed';
}

/**
 * Find de nærmeste dokumenter på betydning.
 *
 * SIGER FRA FREM FOR AT SVARE TOMT. Er der ingen vektorer, eller fejlede
 * kaldet, sættes `unavailable` — og kalderen kan fortælle det videre. En tom
 * liste og «den halvdel virkede ikke» ser ens ud fra kaldestedet, og det er
 * forskellen mellem «vi fandt intet» og «vi kiggede ikke».
 */
export async function vectorSearch(
  db: TrailDatabase,
  tenantId: string,
  knowledgeBaseId: string,
  query: string,
  limit: number,
): Promise<VectorSearchResult> {
  const cov = await coverage(db, tenantId, knowledgeBaseId);
  if (cov.embedded === 0) return { hits: [], coverage: 0, unavailable: 'no-embeddings' };

  let qv: number[];
  try {
    const r = await embed([query]);
    qv = r.vectors[0]!;
  } catch (err) {
    console.error('[F254] kunne ikke lave vektor for forespørgslen', err);
    return { hits: [], coverage: cov.ratio, unavailable: 'embedding-failed' };
  }

  const q = Float32Array.from(qv);
  const rows = await loadVectors(db, tenantId, knowledgeBaseId);

  // Bedste tekststykke pr. DOKUMENT. Uden dette ville en lang Neuron med ti
  // stykker fylde hele resultatlisten med sig selv.
  const best = new Map<string, number>();
  for (const r of rows) {
    const s = cosine(q, r.vector);
    if (s === null) continue; // kan ikke beregnes — ikke det samme som 0
    const cur = best.get(r.documentId);
    if (cur === undefined || s > cur) best.set(r.documentId, s);
  }

  const hits = [...best.entries()]
    .map(([documentId, score]) => ({ documentId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { hits, coverage: cov.ratio };
}

/**
 * Er hybrid tændt for denne videnbase?
 *
 * Fejler opslaget, svares FALSE. En søgning skal aldrig fejle fordi et flag
 * ikke kunne læses — den skal falde tilbage til den vej der har virket hele
 * tiden.
 */
export async function hybridEnabled(db: TrailDatabase, kbId: string): Promise<boolean> {
  try {
    const r = (await db.execute(
      `SELECT hybrid_search_enabled AS on FROM knowledge_bases WHERE id = ?`, [kbId],
    )).rows[0] as { on?: number } | undefined;
    return Number(r?.on ?? 0) === 1;
  } catch {
    return false;
  }
}
