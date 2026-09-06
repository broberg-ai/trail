/**
 * F254.1 — hold vektorerne i takt med teksten.
 *
 * TO VEJE IND, og de dækker forskellige huller:
 *
 *   indexDocument()   kaldes NÅR en Neuron skrives. Den normale vej.
 *   sweepKb()         finder alt der mangler eller er forældet. Sikkerhedsnet
 *                     og bagfyldning i ét.
 *
 * VALGET: FEJEREN ER HOVEDVEJEN, ikke en krog i hver skrivning.
 *
 * `storeChunks` kaldes fra SEKS steder (upload, gen-kompilering, redigering,
 * tilbagerulning, ambient, reprocess). At hænge en indeksering på hvert af dem
 * er nøjagtig den fejl vi målte i nat: arkivering skrev ikke i hændelses-loggen
 * fordi kun ÉN af flere veje kendte reglen, og 144 sider stod udokumenteret i
 * fire måneder. En krog man skal huske at sætte, glemmer nogen — og hullet er
 * usynligt indtil noget andet afslører det.
 *
 * En fejer der spørger DATABASEN «hvilke tekststykker mangler en brugbar
 * vektor?» kan ikke narres af en glemt krog, en migration der tilføjer chunks,
 * eller et script der skriver udenom. Den koster til gengæld en forsinkelse:
 * ny viden er søgbar på betydning når fejeren næste gang kører, ikke i samme
 * sekund. Ved et interval på minutter er det den rigtige byttehandel.
 *
 * Sikkerhedsnettet er ikke overflødigt ved siden af skrive-vejen. En skrivning
 * kan fejle (modellen nede, timeout), en migration kan tilføje chunks, og et
 * script kan skrive direkte i basen — nøjagtig dét vi opdagede i nat med
 * hændelses-loggen, hvor 144 arkiveringer aldrig blev logget fordi kun ÉN vej
 * kendte reglen. En fejer der spørger BASEN kan ikke narres af en manglende
 * krog i en kodesti nogen glemte.
 */
import { contentHash, storeEmbedding, coverage, EMBEDDING_MODEL } from '@trail/core';
import type { TrailDatabase } from '@trail/db';
import { embed } from './embedder.js';

/**
 * PORTIONER MÅLES I TOKENS, IKKE I ANTAL — og det er en rettelse målt 6/9.
 *
 * Første udgave sendte 64 tekststykker pr. kald. Det virkede på broberg.ai og
 * fejlede på Sanne med:
 *
 *     mistral embeddings 400: "Too many tokens overall, split into more batches."
 *
 * 128 af 569 stykker blev sprunget over. Årsagen er indlysende bagefter: et
 * ANTAL siger intet om hvor lange teksterne er. Sannes Neuroner er længere
 * (~750 tokens i snit mod broberg.ai's ~560), så de samme 64 stykker blev til
 * næsten dobbelt så stor en anmodning.
 *
 * En grænse man ikke kan se fra kaldestedet skal måles i den enhed grænsen
 * ER — ellers virker koden indtil nogen skriver længere tekster, og fejler så
 * et sted ingen forbinder med årsagen.
 *
 * Budgettet er sat konservativt: 16.000 tokens pr. anmodning, anslået på
 * 3,5 tegn/token for dansk-tung tekst. Ét stykke der ALENE overskrider
 * budgettet sendes stadig for sig — bedre et kald der måske fejler med en
 * læsbar grund end et stykke der aldrig bliver forsøgt.
 */
export const TOKEN_BUDGET = Number(process.env.TRAIL_EMBED_TOKEN_BUDGET ?? 16_000);
export const CHARS_PER_TOKEN = 3.5;
const MAX_PER_BATCH = 64; // loft oveni, så en base med meget korte stykker ikke sender tusinder

/** Del i portioner der hver især holder sig under token-budgettet. */
export function portioner<T extends { content: string }>(rows: T[]): T[][] {
  const ud: T[][] = [];
  let cur: T[] = [];
  let tokens = 0;
  for (const r of rows) {
    const t = r.content.length / CHARS_PER_TOKEN;
    if (cur.length > 0 && (tokens + t > TOKEN_BUDGET || cur.length >= MAX_PER_BATCH)) {
      ud.push(cur); cur = []; tokens = 0;
    }
    cur.push(r); tokens += t;
  }
  if (cur.length > 0) ud.push(cur);
  return ud;
}

export interface IndexResult {
  chunks: number;
  embedded: number;
  skipped: number;
  costCents: number;
  inputTokens: number;
  /**
   * HVORFOR noget blev sprunget over. Uden dette felt siger svaret
   * «skipped: 10, cost: 0» og INTET om årsagen — og så skal man læse
   * motorens logfiler for at finde ud af om modellen var nede, om nøglen
   * manglede, eller om anmodningen var forkert. Målt på egen krop 6/9: en
   * fejlet bagfyldning så nøjagtig ud som en tom videnbase.
   */
  errors?: string[];
}

/** Tekststykker der mangler en brugbar vektor (ingen, forældet, eller anden model). */
async function stale(
  db: TrailDatabase,
  where: { tenantId: string; knowledgeBaseId?: string; documentId?: string },
): Promise<Array<{ id: string; content: string; documentId: string; knowledgeBaseId: string }>> {
  // Parametrene bindes i den rÆKKEFØLGE de står i SQL'en: model i JOIN'en
  // først, derefter tenant i WHERE, derefter de valgfrie filtre. Bygges de i en
  // anden orden og klippes til bagefter, virker det ved et TILFÆLDE — og går i
  // stykker næste gang nogen tilføjer et filter.
  const args: unknown[] = [EMBEDDING_MODEL, where.tenantId];
  let filter = '';
  if (where.knowledgeBaseId) { filter += ' AND c.knowledge_base_id = ?'; args.push(where.knowledgeBaseId); }
  if (where.documentId) { filter += ' AND c.document_id = ?'; args.push(where.documentId); }

  const rows = (await db.execute(
    `SELECT c.id AS id, c.content AS content, c.document_id AS documentId,
            c.knowledge_base_id AS knowledgeBaseId, e.content_hash AS h
       FROM document_chunks c
       LEFT JOIN chunk_embeddings e ON e.chunk_id = c.id AND e.model = ?
       JOIN documents d ON d.id = c.document_id
      WHERE c.tenant_id = ? AND d.archived = 0 ${filter}`,
    args as string[],
  )).rows as Array<{ id: string; content: string; documentId: string; knowledgeBaseId: string; h: string | null }>;

  // Forældet afgøres HER og ikke i SQL, fordi SQLite ikke har en hash-funktion.
  return rows
    .filter((r) => r.h === null || r.h !== contentHash(r.content))
    .map(({ h: _h, ...rest }) => rest);
}

async function embedBatch(
  db: TrailDatabase,
  tenantId: string,
  rows: Array<{ id: string; content: string; documentId: string; knowledgeBaseId: string }>,
): Promise<{ embedded: number; costCents: number; inputTokens: number }> {
  let embedded = 0, costCents = 0, inputTokens = 0;
  for (const slice of portioner(rows)) {
    const res = await embed(slice.map((r) => r.content));
    for (let j = 0; j < slice.length; j += 1) {
      const r = slice[j]!;
      await storeEmbedding(db, {
        chunkId: r.id, tenantId, knowledgeBaseId: r.knowledgeBaseId, documentId: r.documentId,
        vector: res.vectors[j]!, model: res.model, content: r.content,
      });
      embedded += 1;
    }
    costCents += res.costCents;
    inputTokens += res.inputTokens;
  }
  return { embedded, costCents, inputTokens };
}

/**
 * Indeksér én Neuron. Kaldes efter en skrivning.
 *
 * ALDRIG FATAL. Fejler modellen, bliver Neuronet stående uden vektor og
 * fejeren tager det senere. En indeksering der kan vælte en skrivning ville
 * gøre en forbedring af SØGNINGEN til en ny måde at miste VIDEN på.
 */
export async function indexDocument(
  db: TrailDatabase,
  tenantId: string,
  documentId: string,
): Promise<IndexResult> {
  const rows = await stale(db, { tenantId, documentId });
  if (rows.length === 0) return { chunks: 0, embedded: 0, skipped: 0, costCents: 0, inputTokens: 0 };
  try {
    const r = await embedBatch(db, tenantId, rows);
    return { chunks: rows.length, skipped: 0, ...r };
  } catch (err) {
    const besked = err instanceof Error ? err.message : String(err);
    console.error('[F254] kunne ikke indeksere', documentId, besked);
    return { chunks: rows.length, embedded: 0, skipped: rows.length, costCents: 0, inputTokens: 0, errors: [besked] };
  }
}

/** Fej en hel videnbase. Bagfyldning OG det kontinuerlige sikkerhedsnet. */
export async function sweepKb(
  db: TrailDatabase,
  tenantId: string,
  knowledgeBaseId: string,
  opts: { max?: number; onProgress?: (done: number, total: number, cents: number) => void } = {},
): Promise<IndexResult & { coverageAfter: number }> {
  let rows = await stale(db, { tenantId, knowledgeBaseId });
  if (opts.max) rows = rows.slice(0, opts.max);

  let embedded = 0, costCents = 0, inputTokens = 0, skipped = 0;
  const errors: string[] = [];
  const alle = portioner(rows);
  let gjort = 0;
  for (const slice of alle) {
    try {
      const r = await embedBatch(db, tenantId, slice);
      embedded += r.embedded; costCents += r.costCents; inputTokens += r.inputTokens;
    } catch (err) {
      // Én fejlet portion stopper ikke resten: en bagfyldning af 6.796 Neuroner
      // må ikke skulle starte forfra fordi kald nummer 40 fik en timeout.
      // Men årsagen SKAL med i svaret — en tælling uden grund tvinger den
      // næste til at læse logfiler for at forstå sit eget resultat.
      const besked = err instanceof Error ? err.message : String(err);
      console.error('[F254] portion fejlede, fortsætter:', besked);
      if (!errors.includes(besked)) errors.push(besked);
      skipped += slice.length;
    }
    gjort += slice.length;
    opts.onProgress?.(gjort, rows.length, costCents);
  }

  const cov = await coverage(db, tenantId, knowledgeBaseId);
  return {
    chunks: rows.length, embedded, skipped, costCents, inputTokens,
    ...(errors.length > 0 ? { errors } : {}),
    coverageAfter: cov.ratio,
  };
}
