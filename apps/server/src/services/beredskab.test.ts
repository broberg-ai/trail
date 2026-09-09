/**
 * F265.10 — det billige spørgsmål, stillet billigt.
 *
 * DEN BÆRENDE PÅSTAND ER IKKE HASTIGHED, DET ER AT VAGTEN GIVER SAMME SVAR.
 * embeddingBeredskab afløser coverage() i søgningens vagt; hvis den svarer
 * anderledes på «findes der en vektor», har vi byttet en langsom søgning for
 * en forkert. Derfor sammenlignes de to mod HINANDEN på rigtig SQL.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';
import { createLibsqlDatabase, type TrailDatabase } from '@trail/db';
import { coverage, embeddingBeredskab, storeEmbedding, EMBEDDING_MODEL } from '@trail/core';

const T = 't-ber', U = 'u-ber';
let trail!: TrailDatabase;
const dbPath = join(process.env.TMPDIR ?? '/tmp', `bered-${process.pid}.db`);

async function kb(id: string) {
  await trail.execute(
    `INSERT OR IGNORE INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES (?,?,?,?,?)`,
    [id, T, id, id, U],
  );
}

async function neuron(id: string, kbId: string, opts: { medVektor?: boolean; indhold?: string } = {}) {
  const indhold = opts.indhold ?? 'krop';
  await trail.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, filename, file_type, path,
                            title, content, kind, archived, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'/neurons/',?,?, 'wiki', 0, '2026-09-09','2026-09-09')`,
    [id, T, kbId, U, `${id}.md`, 'md', id, indhold],
  );
  await trail.execute(
    `INSERT INTO document_chunks (id, tenant_id, knowledge_base_id, document_id, chunk_index, content, token_count)
     VALUES (?,?,?,?,0,?,10)`,
    [`c-${id}`, T, kbId, id, indhold],
  );
  if (opts.medVektor) {
    await storeEmbedding(trail, {
      chunkId: `c-${id}`, tenantId: T, knowledgeBaseId: kbId, documentId: id,
      vector: Array.from({ length: 1024 }, () => 0.1), model: EMBEDDING_MODEL, content: indhold,
    });
  }
}

beforeAll(async () => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
  trail = await createLibsqlDatabase({ path: dbPath });
  await trail.runMigrations();
  await trail.execute(`INSERT INTO tenants (id, slug, name) VALUES (?,?,?)`, [T, 'tb', 'TB']);
  await trail.execute(`INSERT INTO users (id, tenant_id, email, role) VALUES (?,?,?,?)`, [U, T, 'a@b.dk', 'owner']);
});

afterAll(() => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
});

test('F265.10 DEN BÆRENDE: vagten er ENIG med coverage() om der findes vektorer', async () => {
  await kb('kb-tom');
  await neuron('t1', 'kb-tom');                       // ingen vektor
  await kb('kb-fuld');
  await neuron('f1', 'kb-fuld', { medVektor: true });

  for (const k of ['kb-tom', 'kb-fuld']) {
    const c = await coverage(trail, T, k);
    const b = await embeddingBeredskab(trail, T, k);
    // Præcis den grænse vagten træffer sin beslutning på.
    expect(b.harVektorer).toBe(c.embedded > 0);
  }
});

test('F265.10 tom videnbase giver 0, ikke NaN', async () => {
  await kb('kb-intet');
  const b = await embeddingBeredskab(trail, T, 'kb-intet');
  expect(b.harVektorer).toBe(false);
  expect(b.ratio).toBe(0);
  expect(Number.isNaN(b.ratio)).toBe(false); // 0/0 må ikke slippe ud som null i JSON
});

test('F265.10 en FORÆLDET vektor tæller stadig som «der er en vektor»', async () => {
  // DEN VIGTIGE FORSKEL, og grunden til at tallene har hvert sit navn:
  // coverage() trækker forældede fra, beredskabet gør ikke. Vagten skal bruge
  // den brede: en forældet vektor er ringere end en frisk, men den er stadig
  // noget at søge i — og alternativet ville være at slå vektor-søgningen fra
  // for en hel Trail fordi teksten blev redigeret.
  await kb('kb-gammel');
  await neuron('g1', 'kb-gammel', { medVektor: true, indhold: 'oprindelig tekst' });
  await trail.execute(`UPDATE document_chunks SET content = ? WHERE id = ?`,
    ['helt anden tekst nu', 'c-g1']);

  const c = await coverage(trail, T, 'kb-gammel');
  const b = await embeddingBeredskab(trail, T, 'kb-gammel');

  expect(c.embedded).toBe(0);        // coverage: ingen FRISKE
  expect(b.harVektorer).toBe(true);  // beredskab: der ER en vektor
  expect(b.ratio).toBe(1);
});

test('F265.10 tallene har hvert sit NAVN — de må ikke kunne forveksles', async () => {
  const b = await embeddingBeredskab(trail, T, 'kb-gammel');
  expect(b.slags).toBe('enhver-vektor');
  // Og slagsen følger med hele vejen ud i søgesvaret, så en læser af API'et
  // ikke kan tage det ene tal for det andet.
  const hs = readFileSync(new URL('./hybrid-search.ts', import.meta.url), 'utf8');
  expect(hs).toContain("coverageSlags: 'enhver-vektor'");
  const rt = readFileSync(new URL('../routes/search.ts', import.meta.url), 'utf8');
  expect(rt).toContain('coverageSlags: vec.coverageSlags');
});

test('F265.10 SØGNINGEN kalder ikke længere coverage() — det var hele prisen', () => {
  // En prøve på funktionen alene ville være grøn selv hvis hybrid-search var
  // gået tilbage til det dyre kald. Det er kaldestedet der kostede 5,7 s.
  const hs = readFileSync(new URL('./hybrid-search.ts', import.meta.url), 'utf8');
  expect(hs).toContain('await embeddingBeredskab(db, tenantId, knowledgeBaseId)');
  expect(hs).not.toContain('await coverage(db, tenantId, knowledgeBaseId)');
});

test('F265.10 KONTROL: coverage() er urørt og bruges stadig hvor præcisionen tæller', () => {
  // /index-ruten, fejeren og gendannelses-tjekket skal stadig have det
  // nøjagtige tal. Fjernes de kald, mister vi evnen til at se en forældet base.
  const idx = readFileSync(new URL('./indexer.ts', import.meta.url), 'utf8');
  expect(idx).toContain('await coverage(db, tenantId, knowledgeBaseId)');
});
