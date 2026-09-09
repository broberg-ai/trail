/**
 * F265.5 — HELE LÆSEVEJEN MOD ET KORPUS DER ER STORT NOK TIL AT BRÆKKE DEN.
 *
 * Ejerens ordre, 9. september 2026, ordret: «hvis du laver fejl burde du måske
 * teste på 10 neuroner i stedet for 5.000.»
 *
 * Han har ret, og prisen er opgjort: FIRE gange samme dag fejlede en
 * ubegrænset forespørgsel med RESPONSE_TOO_LARGE i produktionen —
 * backfillChunks, stale(), coverage() og loadVectors. Hver af dem blev fundet
 * ved at køre mod 5.726 ægte Neuroner, én ad gangen, med et deploy imellem.
 * Alle fire ville være faldet her på under et sekund.
 *
 * DE TO SIDSTE HAR EN EGENSKAB DER GØR DEM SÆRLIGT FARLIGE: de fejler ikke når
 * noget er galt, men når noget er RIGTIGT. coverage() og loadVectors voksede
 * med antallet af embeddings, så de virkede perfekt så længe indekset var
 * tomt. Et system uden data beviser dem ikke — det er derfor prøven her
 * INSISTERER på volumen frem for at nøjes med en håndfuld rækker.
 *
 * MEN — OG DET ER HELE POINTEN — EN LOKAL PRØVE KAN IKKE FANGE FEJLEN VED AT
 * VENTE PÅ DEN. `RESPONSE_TOO_LARGE` er en grænse i libsqls PROTOKOL mod en
 * fjern database. En lokal SQLite-fil har intet loft, så den ubegrænsede kode
 * kører fint her. Målt: rullede jeg loadVectors tilbage til sin ubegrænsede
 * form, bestod prøven 3/3.
 *
 * Så prøven måler STØRRELSEN på hvert enkelt svar frem for at afvente en fejl
 * der aldrig kommer lokalt. Det er den eneste form der virker: den koder
 * begrænsningen ind i stedet for at håbe på at ramme den.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibsqlDatabase, type TrailDatabase } from '@trail/db';
import { coverage, loadVectors, EMBEDDING_MODEL, contentHash } from '@trail/core';
import { backfillChunks } from './indexer.js';

/**
 * Libsqls loft er i megabyte-klassen; 1 MB er konservativt og giver plads til
 * et korpus mange gange større end det her uden at ramme grænsen i prod.
 */
const LOFT_BYTES = 1_000_000;

/**
 * Mål ÆGTE bytes, ikke JSON-længde.
 *
 * F265.5 — første udgave brugte `JSON.stringify(rows).length`. Målt: en
 * ArrayBuffer på 4.096 bytes bliver til «{}» — TO tegn. Vektorkolonnen er
 * netop en ArrayBuffer, så måleren rapporterede omtrent ingenting for præcis
 * den kolonne der er stor, og en mutation der fjernede sideinddelingen fra
 * loadVectors bestod 3/3.
 *
 * Måleren var altså blind for det den fandtes for at måle. Fjerde gang på ét
 * døgn at instrumentet — ikke systemet — var fejlen.
 */
function svarBytes(rows: unknown[]): number {
  let sum = 0;
  for (const r of rows) {
    for (const v of Object.values(r as Record<string, unknown>)) {
      if (v instanceof ArrayBuffer) sum += v.byteLength;
      else if (ArrayBuffer.isView(v)) sum += (v as ArrayBufferView).byteLength;
      else if (typeof v === 'string') sum += Buffer.byteLength(v, 'utf8');
      else if (v != null) sum += String(v).length;
    }
  }
  return sum;
}

/**
 * Ombryd databasen og mål hvert ENKELT svar. Kalder man ti gange, er det ti
 * målinger — ikke en sum. Det er præcis den akse libsql begrænser.
 */
function medMåler(db: TrailDatabase): { db: TrailDatabase; største: () => number } {
  let største = 0;
  const proxy = {
    ...db,
    execute: async (sql: string, args?: unknown[]) => {
      const r = await (db as { execute: (s: string, a?: unknown[]) => Promise<{ rows: unknown[] }> }).execute(sql, args);
      const b = svarBytes(r.rows ?? []);
      if (b > største) største = b;
      return r;
    },
  } as unknown as TrailDatabase;
  return { db: proxy, største: () => største };
}

const dir = mkdtempSync(join(tmpdir(), 'f265-5-'));
let db: TrailDatabase;
const T = 't-vol', KB = 'kb-vol';

// Stort nok til at ramme loftet, lille nok til at køre på et sekund.
const NEURONER = 400;
const STYKKER_PR = 3;          // 1.200 stykker i alt
// 3 kB — MÅLT på det ægte korpus (70 Neuroner, gennemsnit 3.016 tegn). Første
// udgave brugte 2 kB, og så var den ubegrænsede backfillChunks kun 800 kB:
// under loftet, så mutationen bestod. Prøvedata der er mindre end
// virkeligheden gør prøven blind for præcis den fejl den findes for.
const KROP = 'Denne Neuron beskriver en beslutning og dens begrundelse. '.repeat(53); // ~3 kB

beforeAll(async () => {
  db = await createLibsqlDatabase({ path: join(dir, 'vol.db') });
  await db.runMigrations();
  await db.execute(`INSERT INTO tenants (id, slug, name) VALUES (?,?,?)`, [T, 'tvol', 'tvol']);
  await db.execute(`INSERT INTO users (id, tenant_id, email, role) VALUES (?,?,?,?)`, ['u', T, 'a@b.dk', 'owner']);
  await db.execute(
    `INSERT INTO knowledge_bases (id, tenant_id, created_by, slug, name) VALUES (?,?,?,?,?)`,
    [KB, T, 'u', 'kbvol', 'KBvol'],
  );
  for (let i = 0; i < NEURONER; i++) {
    const id = `n-${String(i).padStart(5, '0')}`;
    await db.execute(
      `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, filename, file_type, path,
                              title, content, kind, archived, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'wiki',0,?,?)`,
      [id, T, KB, 'u', `${id}.md`, 'md', '/neurons/', id, KROP, '2026-01-01', '2026-01-01'],
    );
  }
});
afterAll(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('BAGFYLDNINGEN klarer et korpus over grænsen', async () => {
  // Fejlede i prod med RESPONSE_TOO_LARGE efter 155 ms mod 5.726 Neuroner.
  let kaldt = 0;
  const m = medMåler(db);
  const r = await backfillChunks(m.db, T, KB, async (documentId, kbId, content) => {
    for (let k = 0; k < STYKKER_PR; k++) {
      await db.execute(
        `INSERT INTO document_chunks (id, tenant_id, knowledge_base_id, document_id, chunk_index, content, token_count)
         VALUES (?,?,?,?,?,?,?)`,
        [`c-${documentId}-${k}`, T, kbId, documentId, k, `${content} stykke ${k}`, 500],
      );
    }
    kaldt++;
    return STYKKER_PR;
  });
  expect(kaldt).toBe(NEURONER);
  expect(r.documents).toBe(NEURONER);
  // Læs TILBAGE fra basen — «tilbagekaldet blev kaldt 400 gange» og «der står
  // 1.200 stykker» er to forskellige påstande.
  const n = (await db.execute(`SELECT COUNT(*) AS n FROM document_chunks WHERE tenant_id = ?`, [T])).rows[0] as { n: number };
  expect(Number(n.n)).toBe(NEURONER * STYKKER_PR);
  expect(m.største()).toBeLessThan(LOFT_BYTES);
});

test('DÆKNINGSMÅLEREN svarer når indekset er FYLDT — ikke kun når det er tomt', async () => {
  // Den her er den lumske: coverage() virkede perfekt ved 0 embeddings og
  // brød sammen ved ~6.600. Prøven skriver derfor vektorer FØRST.
  const vektor = new Uint8Array(new Float32Array(1024).buffer);
  const stykker = (await db.execute(
    `SELECT id, document_id AS d, content FROM document_chunks WHERE tenant_id = ?`, [T],
  )).rows as Array<{ id: string; d: string; content: string }>;
  expect(stykker.length).toBe(NEURONER * STYKKER_PR);

  // BRUG KODENS EGEN HASH, ikke min egen sha256. Første udgave hashede med
  // node:crypto — så stemte intet, alle 1.200 blev talt som FORÆLDEDE, og
  // coverage svarede embedded=0 mens loadVectors fandt 1.200. Prøven målte sin
  // egen hash-funktion i stedet for systemets.
  for (const s of stykker) {
    await db.execute(
      `INSERT INTO chunk_embeddings (chunk_id, tenant_id, knowledge_base_id, document_id, model, dims, vector, content_hash)
       VALUES (?,?,?,?,?,?,?,?)`,
      [s.id, T, KB, s.d, EMBEDDING_MODEL, 1024, vektor,
       contentHash(s.content)],
    );
  }

  const m = medMåler(db);
  const cov = await coverage(m.db, T, KB);
  expect(cov.chunks).toBe(NEURONER * STYKKER_PR);
  expect(cov.embedded).toBe(NEURONER * STYKKER_PR);
  expect(cov.stale).toBe(0);
  // DEN BÆRENDE HÆVDELSE: intet enkelt svar må nærme sig loftet.
  expect(m.største()).toBeLessThan(LOFT_BYTES);
});

test('SØGE-VEJEN henter alle vektorer når der ER mange — det var fjerde fejl', async () => {
  // loadVectors fejlede i prod MINUTTER efter at indekset nåede 100 %.
  // Hver vektor er 1.024 floats; her er der 1.200 af dem.
  const m = medMåler(db);
  const v = await loadVectors(m.db, T, KB);
  expect(v.length).toBe(NEURONER * STYKKER_PR);
  // Ingen tabt og ingen dublet — sideinddelingen skal dække hele mængden.
  expect(new Set(v.map((x) => x.chunkId)).size).toBe(NEURONER * STYKKER_PR);
  // Og hvert svar skal være under loftet. Uden denne linje består prøven på
  // den ubegrænsede kode, fordi en lokal fil ikke afviser noget.
  expect(m.største()).toBeLessThan(LOFT_BYTES);
});
