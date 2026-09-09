/**
 * F254.1 — portioner måles i TOKENS, ikke i antal.
 *
 * Prøven er bygget om den målte fejl: 64 stykker virkede på broberg.ai og
 * fejlede på Sanne med «Too many tokens overall», fordi hendes tekststykker er
 * længere. Et ANTAL siger intet om hvor lange teksterne er.
 */
import { test, expect } from 'bun:test';
import { portioner, TOKEN_BUDGET, CHARS_PER_TOKEN } from './indexer.js';

const tekst = (tokens: number) => ({ content: 'x'.repeat(Math.round(tokens * CHARS_PER_TOKEN)) });

test('lange stykker deles i FLERE portioner end korte — det var hele fejlen', () => {
  const lange = Array.from({ length: 64 }, () => tekst(750));   // Sannes profil
  const korte = Array.from({ length: 64 }, () => tekst(100));
  expect(portioner(lange).length).toBeGreaterThan(portioner(korte).length);
});

test('ingen portion overskrider budgettet', () => {
  const rows = Array.from({ length: 200 }, (_, i) => tekst(300 + (i % 7) * 400));
  for (const p of portioner(rows)) {
    const t = p.reduce((s, r) => s + r.content.length / CHARS_PER_TOKEN, 0);
    // Ét stykke alene må gerne sprænge budgettet; en portion med flere må ikke.
    if (p.length > 1) expect(t).toBeLessThanOrEqual(TOKEN_BUDGET);
  }
});

test('ET stykke der ALENE er for stort sendes stadig — frem for aldrig at blive forsøgt', () => {
  const p = portioner([tekst(TOKEN_BUDGET * 3)]);
  expect(p.length).toBe(1);
  expect(p[0]!.length).toBe(1);
});

test('ALLE stykker kommer med, præcis én gang', () => {
  const rows = Array.from({ length: 137 }, (_, i) => ({ content: `nr-${i}`.repeat(50) }));
  const flad = portioner(rows).flat();
  expect(flad.length).toBe(137);
  expect(new Set(flad.map((r) => r.content)).size).toBe(137);
});

test('tom liste giver ingen portioner — ikke én tom', () => {
  // En tom portion ville blive sendt som et kald med nul tekster og koste en
  // rundtur for ingenting.
  expect(portioner([])).toEqual([]);
});

/**
 * F254.5 — bagfyldning af tekststykker.
 *
 * Den målte fejl: `storeChunks` kaldes seks steder, og ingen af dem er den vej
 * en Neuron bliver født. Resultatet var at hvert eneste stykke i hver eneste
 * base tilhørte en RÅ KILDE — 182 af 182 stykke-hits over fire søgninger — så
 * vektor-indekset dækkede den skrabede halvdel af korpusset og ikke den skrevne.
 */
import { backfillChunks } from './indexer.js';

type Kaldt = { documentId: string; kbId: string; content: string };

function fakeDb(rows: Array<{ id: string; content: string | null }>) {
  const sqlSet: string[] = [];
  return {
    db: {
      execute: async (sql: string) => { sqlSet.push(sql); return { rows }; },
    } as never,
    sqlSet,
  };
}

test('DOKUMENTER UDEN STYKKER BLIVER CHUNKET — det var hele fejlen', async () => {
  const { db } = fakeDb([
    { id: 'neuron-1', content: 'Trail er en RAG hvis korpus er skrevet.' },
    { id: 'neuron-2', content: 'Compile-at-ingest, ikke query-time.' },
  ]);
  const kaldt: Kaldt[] = [];
  const r = await backfillChunks(db, 't1', 'kb1', async (documentId, kbId, content) => {
    kaldt.push({ documentId, kbId, content });
    return 3;
  });
  expect(kaldt.map((k) => k.documentId)).toEqual(['neuron-1', 'neuron-2']);
  expect(r).toEqual({ documents: 2, chunks: 6 });
});

test('forespørgslen udelukker arkiverede OG dokumenter der allerede HAR stykker', async () => {
  // Uden begge betingelser ville bagfyldningen enten genskabe stykker for
  // arkiveret indhold (som søgningen med vilje skjuler) eller re-chunke hele
  // basen ved hver fejning — storeChunks sletter og genindsætter, så det ville
  // koste en fuld omskrivning af tabellen hvert minut.
  const { db, sqlSet } = fakeDb([]);
  await backfillChunks(db, 't1', 'kb1', async () => 0);
  expect(sqlSet[0]).toContain('d.archived = 0');
  expect(sqlSet[0]).toContain('NOT EXISTS');
});

test('et TOMT dokument kalder ikke storeChunks — ellers gentages arbejdet for evigt', async () => {
  // chunkText('') giver nul stykker, så dokumentet ville stadig mangle stykker
  // ved næste fejning: en transaktion der rydder og genindsætter ingenting,
  // igen og igen, uden nogensinde at flytte noget.
  const { db } = fakeDb([
    { id: 'tom', content: '   ' },
    { id: 'null', content: null },
    { id: 'rigtig', content: 'indhold' },
  ]);
  const kaldt: string[] = [];
  const r = await backfillChunks(db, 't1', 'kb1', async (id) => { kaldt.push(id); return 1; });
  expect(kaldt).toEqual(['rigtig']);
  expect(r.documents).toBe(1);
});

test('et dokument der gav NUL stykker tælles ikke som bagfyldt', async () => {
  const { db } = fakeDb([{ id: 'a', content: 'x' }]);
  const r = await backfillChunks(db, 't1', 'kb1', async () => 0);
  expect(r).toEqual({ documents: 0, chunks: 0 });
});

/**
 * F265.4 — SIDEINDDELINGEN, mod en RIGTIG database.
 *
 * De tre prøver ovenfor bruger en attrap der svarer det samme uanset hvad man
 * spørger om. Den kan derfor ikke se om `LIMIT` og `id > ?` overhovedet
 * virker — den ville have været grøn på den kode der fejlede i produktion med
 * RESPONSE_TOO_LARGE. Så disse kører mod ægte SQL.
 */
import { beforeAll as fBeforeAll, afterAll as fAfterAll } from 'bun:test';
import { mkdtempSync as mkTmp, rmSync as rmDir } from 'node:fs';
import { tmpdir as osTmp } from 'node:os';
import { join as pJoin } from 'node:path';
import { createLibsqlDatabase as mkDb, type TrailDatabase as TDb } from '@trail/db';
import { LÆSE_SIDE } from './indexer.js';

const sideDir = mkTmp(pJoin(osTmp(), 'f265-4-'));
let sideDb: TDb;
const T = 't-side', KB = 'kb-side';

fBeforeAll(async () => {
  sideDb = await mkDb({ path: pJoin(sideDir, 'side.db') });
  await sideDb.runMigrations();
  await sideDb.execute(`INSERT INTO tenants (id, slug, name) VALUES (?,?,?)`, [T, 'tside', 'tside']);
  await sideDb.execute(`INSERT INTO users (id, tenant_id, email, role) VALUES (?,?,?,?)`, ['u', T, 'a@b.dk', 'owner']);
  await sideDb.execute(
    `INSERT INTO knowledge_bases (id, tenant_id, created_by, slug, name) VALUES (?,?,?,?,?)`,
    [KB, T, 'u', 'kbside', 'KBside'],
  );
});
fAfterAll(async () => { await sideDb.close(); rmDir(sideDir, { recursive: true, force: true }); });

test('F265.4 ALLE dokumenter nås når der er FLERE end én side', async () => {
  // Mere end én side, og ikke et rundt multiplum — så en afsluttende halv side
  // også bliver prøvet. Uden sideinddeling hentede dette ét svar med alt i.
  const antal = LÆSE_SIDE + 37;
  for (let i = 0; i < antal; i++) {
    const id = `doc-${String(i).padStart(5, '0')}`;
    await sideDb.execute(
      `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, filename, file_type, path,
                              title, content, kind, archived, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`,
      [id, T, KB, 'u', `${id}.md`, 'md', '/', id, `krop ${i}`, 'wiki', '2026-01-01', '2026-01-01'],
    );
  }

  // STYKKERNE SKAL FAKTISK INDSÆTTES. Første udgave af denne prøve talte bare
  // kaldene og lod basen være urørt — og så BESTOD en OFFSET-mutation, fordi
  // ingen rækker faldt ud af NOT EXISTS undervejs. Prøven målte sin egen
  // attrap i stedet for adfærden. Nu skriver tilbagekaldet rigtige stykker,
  // så resultatsættet skrumper mens vi går gennem det — hvilket er præcis den
  // betingelse nøgle-paginering findes for at overleve.
  const set = new Set<string>();
  const r = await backfillChunks(sideDb, T, KB, async (documentId, kbId, content) => {
    await sideDb.execute(
      `INSERT INTO document_chunks (id, tenant_id, knowledge_base_id, document_id, chunk_index, content, token_count)
       VALUES (?,?,?,?,?,?,?)`,
      [`chunk-${documentId}`, T, kbId, documentId, 0, content, 1],
    );
    set.add(documentId);
    return 1;
  });

  // DEN BÆRENDE HÆVDELSE: ingen tabt, ingen dublet. Et OFFSET-baseret
  // gennemløb TABER rækker her, fordi hver behandlet række falder ud af
  // NOT EXISTS og skubber resten ned under det voksende offset.
  expect(set.size).toBe(antal);
  expect(r.documents).toBe(antal);
});

test('F265.4 NEGATIV KONTROL: én side er stadig ét kald', async () => {
  // Uden den her ville «hent altid i sider» også bestå hvis den lavede en
  // rundtur pr. række. Prisen for sideinddelingen skal betales én gang.
  const kald: string[] = [];
  const tæller = {
    ...sideDb,
    execute: async (sql: string, args?: unknown[]) => {
      if (sql.includes('NOT EXISTS')) kald.push(sql);
      return sideDb.execute(sql, args as never);
    },
  } as unknown as TDb;
  await backfillChunks(tæller, T, 'kb-tom', async () => 1);
  expect(kald.length).toBe(1);
});
