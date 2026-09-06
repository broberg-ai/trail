/**
 * F254.1 — vektorer: kodning, lighed og den EU-rute der ikke er valgfri.
 *
 * Ren regnekraft og lagring. Selve model-kaldet ligger i serveren (den ejer
 * @broberg/ai-sdk); kernen må kun kende TALLENE, så lighed kan prøves uden en
 * netværksforbindelse og uden en API-nøgle.
 */
import type { TrailDatabase } from '@trail/db';
import { createHash } from 'node:crypto';

/**
 * EU-RUTEN, SKREVET ÉT STED.
 *
 * `@broberg/ai-sdk`'s `embedding`-tier peger på OpenAIs text-embedding-3-small
 * — USA. Det er et af de to steder SDK'et forlader EU, og CLAUDE.md advarer
 * eksplicit mod at sende persondata den vej. Sannes Neuroner er en
 * zoneterapi-kliniks: helbredsoplysninger, særlig kategori under GDPR art. 9.
 *
 * Derfor er dette ikke en indstilling. Konstanten står her, importeres af det
 * ene kaldested, og en prøve læser `usage.provider` af SVARET tilbage — ikke
 * kildeteksten. Prisforskellen er 8 øre for hele vores korpus.
 */
export const EMBEDDING_PROVIDER = 'mistral' as const;
export const EMBEDDING_MODEL = 'mistral-embed' as const;

/** float32 little-endian. Se migration 0051 for hvorfor ikke JSON. */
export function encodeVector(v: readonly number[]): Uint8Array {
  const buf = new ArrayBuffer(v.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < v.length; i += 1) view.setFloat32(i * 4, v[i]!, true);
  return new Uint8Array(buf);
}

export function decodeVector(b: Uint8Array): Float32Array {
  // Kopiér frem for at pege ind i bufferen: en Uint8Array fra databasen kan
  // dele hukommelse med driverens egen, og en byteOffset der ikke er delelig
  // med 4 får Float32Array til at kaste.
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Float32Array(copy.buffer);
}

/**
 * Cosinus-lighed. Returnerer NULL — ikke 0 — når den ikke kan beregnes.
 *
 * 0 er en GYLDIG lighed (vinkelret, altså «intet til fælles»). Bruges 0 også
 * som «kunne ikke beregnes», bliver et manglende svar til et dårligt svar, og
 * en sortering kan ikke skelne dem. Det er nattens gennemgående fejlform i
 * talform.
 */
export function cosine(a: Float32Array, b: Float32Array): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return null; // en nul-vektor har ingen retning
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Indholdets fingeraftryk — så en forældet vektor kan ses uden et model-kald. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

export interface EmbeddingRow {
  chunkId: string;
  documentId: string;
  vector: Float32Array;
}

/** Gem én vektor. Erstatter en eksisterende for samme chunk. */
export async function storeEmbedding(
  db: TrailDatabase,
  args: {
    chunkId: string; tenantId: string; knowledgeBaseId: string; documentId: string;
    vector: readonly number[]; model: string; content: string;
  },
): Promise<void> {
  await db.execute(
    `INSERT INTO chunk_embeddings
       (chunk_id, tenant_id, knowledge_base_id, document_id, vector, dims, model, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chunk_id) DO UPDATE SET
       vector = excluded.vector, dims = excluded.dims,
       model = excluded.model, content_hash = excluded.content_hash,
       created_at = datetime('now')`,
    [args.chunkId, args.tenantId, args.knowledgeBaseId, args.documentId,
     encodeVector(args.vector), args.vector.length, args.model, contentHash(args.content)],
  );
}

/**
 * Hvor stor en del af videnbasen har en BRUGBAR vektor?
 *
 * NÆVNEREN UDELUKKER ARKIVEREDE SIDER, og det er en RETTELSE målt 6/9: første
 * udgave talte ALLE tekststykker, mens indekseringen med rette springer
 * arkiverede sider over. Så meldte en FULDT indekseret videnbase 52,8 % —
 * «halvdelen af din hjerne er ikke søgbar», om en base hvor alt søgbart var
 * taget. Tælleren og nævneren målte to forskellige populationer.
 *
 * Det er nattens fejlform vendt om: ikke en falsk grøn, men en falsk RØD. Den
 * er mildere, fordi den får nogen til at lede efter et problem der ikke
 * findes — men den koster stadig, og den ville have stået som «kendt
 * mærkværdighed» for evigt hvis ikke tallet var blevet læst samme dag.
 *
 * «Brugbar» er ikke det samme som «findes»: en vektor hvis content_hash ikke
 * længere matcher chunkens tekst er forældet, og en fra en anden model kan
 * ikke sammenlignes med de øvrige. Begge tælles som IKKE dækket, fordi det er
 * dét tallet skal betyde for den der læser det.
 */
export async function coverage(
  db: TrailDatabase,
  tenantId: string,
  knowledgeBaseId: string,
  model = EMBEDDING_MODEL,
): Promise<{ chunks: number; embedded: number; stale: number; ratio: number }> {
  const r = (await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM document_chunks c
          JOIN documents d ON d.id = c.document_id
         WHERE c.tenant_id = ? AND c.knowledge_base_id = ? AND d.archived = 0) AS chunks,
       (SELECT COUNT(*) FROM document_chunks c JOIN chunk_embeddings e ON e.chunk_id = c.id
         WHERE c.tenant_id = ? AND c.knowledge_base_id = ? AND e.model = ?)    AS with_any,
       (SELECT COUNT(*) FROM document_chunks c JOIN chunk_embeddings e ON e.chunk_id = c.id
         WHERE c.tenant_id = ? AND c.knowledge_base_id = ? AND e.model = ?
           AND e.content_hash <> ?)                                            AS placeholder`,
    [tenantId, knowledgeBaseId, tenantId, knowledgeBaseId, model,
     tenantId, knowledgeBaseId, model, ''],
  )).rows[0] as { chunks: number; with_any: number; placeholder: number };

  // Forældede tælles ved at sammenligne hash mod den NUVÆRENDE tekst — det kan
  // SQLite ikke gøre uden en hash-funktion, så det gøres her.
  const rows = (await db.execute(
    `SELECT c.content AS content, e.content_hash AS h
       FROM document_chunks c JOIN chunk_embeddings e ON e.chunk_id = c.id
      WHERE c.tenant_id = ? AND c.knowledge_base_id = ? AND e.model = ?`,
    [tenantId, knowledgeBaseId, model],
  )).rows as Array<{ content: string; h: string }>;

  let stale = 0;
  for (const row of rows) if (contentHash(row.content) !== row.h) stale += 1;

  const chunks = Number(r.chunks);
  const embedded = Number(r.with_any) - stale;
  return { chunks, embedded, stale, ratio: chunks === 0 ? 1 : embedded / chunks };
}

/** Alle brugbare vektorer i en videnbase. Ved 2,4 MB er det billigere end et indeks. */
export async function loadVectors(
  db: TrailDatabase,
  tenantId: string,
  knowledgeBaseId: string,
  model = EMBEDDING_MODEL,
): Promise<EmbeddingRow[]> {
  const rows = (await db.execute(
    `SELECT e.chunk_id AS chunkId, e.document_id AS documentId, e.vector AS vector
       FROM chunk_embeddings e
       JOIN documents d ON d.id = e.document_id
      WHERE e.tenant_id = ? AND e.knowledge_base_id = ? AND e.model = ?
        AND d.archived = 0`,
    [tenantId, knowledgeBaseId, model],
  )).rows as Array<{ chunkId: string; documentId: string; vector: Uint8Array }>;
  return rows.map((r) => ({
    chunkId: r.chunkId, documentId: r.documentId, vector: decodeVector(r.vector),
  }));
}
