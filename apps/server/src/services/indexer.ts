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
import { chunkText, storeChunks } from './chunker.js';

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
      WHERE c.tenant_id = ? AND d.archived = 0 AND d.kind = 'wiki' ${filter}`,
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
): Promise<IndexResult & {
  coverageAfter: number;
  kildeVektorerFjernet: number;
  backfilledDocuments: number;
  backfilledChunks: number;
  byKind: Record<string, { chunks: number; embedded: number }>;
}> {
  // F254.5 — stykker FØR vektorer. En Neuron uden stykker er usynlig for
  // vektor-søgningen, og var det for hele korpusset indtil 6/9. Rækkefølgen er
  // bærende: bagfyldes der efter embeddingen, bliver de nye stykker først
  // vektoriseret ved NÆSTE fejning, og en bagfyldning ville melde færdig med
  // halvdelen af arbejdet gjort.
  const bagfyldt = await backfillChunks(db, tenantId, knowledgeBaseId, async (documentId, kbId, content) => {
    const stykker = chunkText(content);
    if (stykker.length > 0) await storeChunks(db, documentId, tenantId, kbId, stykker);
    return stykker.length;
  });

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

  // F254.7 — ejeren 6/9: «det er ikke kildematerialet der skal indekseres og
  // embeddes, det er Neurons». Kilder er KUN råmateriale til at skabe Neuroner.
  //
  // Oprydningen ligger i FEJEREN og ikke i et engangs-script: et script rydder
  // ÉN gang og efterlader mekanismen der genskabte problemet. En fejer der
  // spørger basen kan ikke narres af en fremtidig kodesti der glemmer reglen.
  const ryddet = await db.execute(
    `DELETE FROM chunk_embeddings
      WHERE tenant_id = ? AND knowledge_base_id = ?
        AND chunk_id IN (
          SELECT c.id FROM document_chunks c
            JOIN documents d ON d.id = c.document_id
           WHERE c.knowledge_base_id = ? AND d.kind <> 'wiki')`,
    [tenantId, knowledgeBaseId, knowledgeBaseId],
  );

  const cov = await coverage(db, tenantId, knowledgeBaseId);
  return {
    chunks: rows.length, embedded, skipped, costCents, inputTokens,
    kildeVektorerFjernet: Number(ryddet.rowsAffected ?? 0),
    ...(errors.length > 0 ? { errors } : {}),
    backfilledDocuments: bagfyldt.documents,
    backfilledChunks: bagfyldt.chunks,
    coverageAfter: cov.ratio,
    byKind: cov.byKind,
  };
}

/**
 * F254.5 — BAGFYLD TEKSTSTYKKER FØR DU EMBEDDER.
 *
 * Målt 6. september 2026, mens den sidste indeksering kørte: hvert eneste
 * tekststykke i hver eneste videnbase tilhørte et `kind='source'`-dokument.
 * Ikke én Neuron. Fordelingen er entydig — stykke-tallet er fuldt forklaret af
 * kilderne alene:
 *
 *     base              kilder  Neuroner  stykker   stykker/kilde
 *     broberg-ai           116       202      343            2,96
 *     sanne-andersen        82       239      569            6,94
 *     buddy-sessions         2     5.699       44           22,00
 *     cb-m1                  2       552        1            0,50
 *
 * ÅRSAGEN: `storeChunks` kaldes seks steder — upload, redigering,
 * gen-kompilering, ambient, gendannelse — og INGEN af dem er den vej en Neuron
 * bliver født. Kandidat-godkendelsen (`wiki-write`, og dermed trail_save,
 * MCP'en, local-ingest, chat-gem) har aldrig skrevet et stykke.
 *
 * Det ramte ikke tekst-søgningen, og derfor lå det uopdaget: `documents_fts`
 * indekserer dokumenterne selv, uafhængigt af stykker. Stykke-tabellen gav kun
 * passage-niveauet — et savn, ikke et brud. Den blev bærende den dag F254 kom,
 * for vektorerne lægges på STYKKER. Så vektor-indekset dækkede den skrabede
 * halvdel af korpusset og ikke den skrevne — præcis omvendt af hele præmissen.
 *
 * OG MIN EGEN DÆKNINGSMÅLER KUNNE IKKE SE DET. `coverage()` tæller stykker med
 * vektor ud af stykker DER FINDES. Findes stykket ikke, indgår det hverken i
 * tælleren eller i nævneren — så en base uden ét eneste Neuron-stykke melder
 * 100 %, sandt om en population der udelader netop det der mangler. Det er
 * søsteren til den falsk-røde nævner fra i går (392fb00): samme funktion,
 * modsat fortegn. En måler hvis population skrumper når fejlen sker, kan ikke
 * se fejlen. Derfor rapporterer `/index` nu fordelt på dokumenttype.
 *
 * FEJER, IKKE KROG — samme valg som resten af filen, og her stærkere: skrive-
 * vejen har ikke seks kaldsteder der glemmer at kalde, den har NUL. En krog ét
 * sted er et løfte hvert fremtidigt skrivested skal huske at holde; en fejer
 * der spørger basen «hvilke dokumenter har ingen stykker?» kan ikke narres.
 * Og den bagfylder de ~6.700 eksisterende Neuroner i samme mekanisme.
 */
export async function backfillChunks(
  db: TrailDatabase,
  tenantId: string,
  knowledgeBaseId: string,
  storeChunksFn: (documentId: string, kbId: string, content: string) => Promise<number>,
): Promise<{ documents: number; chunks: number }> {
  const rows = (await db.execute(
    `SELECT d.id AS id, d.content AS content
       FROM documents d
      WHERE d.tenant_id = ? AND d.knowledge_base_id = ? AND d.archived = 0
        AND NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id)`,
    [tenantId, knowledgeBaseId],
  )).rows as Array<{ id: string; content: string | null }>;

  let documents = 0;
  let chunks = 0;
  for (const r of rows) {
    // Et tomt dokument springes over UDEN at kalde storeChunks. Et kald med nul
    // stykker ville rydde og genindsætte ingenting i en transaktion, og
    // dokumentet ville stadig mangle stykker ved næste fejning — arbejde der
    // gentages for evigt uden at flytte noget.
    if (!r.content || r.content.trim().length === 0) continue;
    const n = await storeChunksFn(r.id, knowledgeBaseId, r.content);
    if (n > 0) { documents += 1; chunks += n; }
  }
  return { documents, chunks };
}
