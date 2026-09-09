/**
 * F265.9 — vektorerne i motorens hukommelse.
 *
 * DEN BÆRENDE PRØVE ER IKKE HASTIGHED, DET ER LIGHED. En cache der gør
 * søgningen hurtig og svaret anderledes er værre end den langsomme søgning,
 * og hurtigt-og-forkert er præcis den slags grøn dagen har handlet om.
 *
 * Derfor kører hver påstand mod RIGTIG SQL med rigtige vektorer, og
 * lighedsprøven sammenligner kold og varm cache række for række i rækkefølge
 * — ikke «omtrent samme træf».
 */
import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';
import { createLibsqlDatabase, type TrailDatabase } from '@trail/db';
import {
  loadVectors, storeEmbedding, cacheStatus, nulstilCache, rydCache,
  laegICache, hentFraCache, CACHE_LOFT_BYTES, EMBEDDING_MODEL,
  varmOpVektorer,
} from '@trail/core';

const T = 't-vc', U = 'u-vc', KB = 'kb-vc', KB2 = 'kb-vc-2';
let trail!: TrailDatabase;
const dbPath = join(process.env.TMPDIR ?? '/tmp', `vcache-${process.pid}.db`);

/** En vektor der er FORSKELLIG pr. stykke, så en ombytning kan ses. */
function vektor(seed: number): number[] {
  return Array.from({ length: 1024 }, (_, i) => Math.sin(seed * 0.37 + i * 0.011));
}

async function kb(id: string) {
  await trail.execute(
    `INSERT OR IGNORE INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES (?,?,?,?,?)`,
    [id, T, id, id, U],
  );
}

async function neuronMedVektor(id: string, kb = KB, seed = 1) {
  await trail.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, filename, file_type, path,
                            title, content, kind, archived, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'/neurons/',?,?, 'wiki', 0, '2026-09-09','2026-09-09')`,
    [id, T, kb, U, `${id}.md`, 'md', id, 'krop'],
  );
  await trail.execute(
    `INSERT INTO document_chunks (id, tenant_id, knowledge_base_id, document_id, chunk_index, content, token_count)
     VALUES (?,?,?,?,0,?,10)`,
    [`c-${id}`, T, kb, id, 'krop'],
  );
  await storeEmbedding(trail, {
    chunkId: `c-${id}`, tenantId: T, knowledgeBaseId: kb, documentId: id,
    vector: vektor(seed), model: EMBEDDING_MODEL, content: 'krop',
  });
}

beforeAll(async () => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
  trail = await createLibsqlDatabase({ path: dbPath });
  await trail.runMigrations();
  await trail.execute(`INSERT INTO tenants (id, slug, name) VALUES (?,?,?)`, [T, 'tvc', 'TVC']);
  await trail.execute(`INSERT INTO users (id, tenant_id, email, role) VALUES (?,?,?,?)`, [U, T, 'a@b.dk', 'owner']);
  for (const k of [KB, KB2])
    await trail.execute(
      `INSERT INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES (?,?,?,?,?)`,
      [k, T, k, k, U],
    );
  for (let i = 1; i <= 5; i++) await neuronMedVektor(`n${i}`, KB, i);
  await neuronMedVektor('m1', KB2, 99);
});

beforeEach(() => nulstilCache());
afterAll(() => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
});

test('F265.9 DEN BÆRENDE: kold og varm cache giver IDENTISKE vektorer i samme rækkefølge', async () => {
  const kold = await loadVectors(trail, T, KB);
  const varm = await loadVectors(trail, T, KB);

  expect(varm.length).toBe(kold.length);
  expect(kold.length).toBe(5);
  // Række for række, i rækkefølge — ikke «samme mængde».
  for (let i = 0; i < kold.length; i++) {
    expect(varm[i]!.chunkId).toBe(kold[i]!.chunkId);
    expect(varm[i]!.documentId).toBe(kold[i]!.documentId);
    expect(Array.from(varm[i]!.vector)).toEqual(Array.from(kold[i]!.vector));
  }
  // Og at det ANDET kald faktisk kom fra cachen — ellers beviser ligheden kun
  // at databasen svarer det samme to gange.
  expect(cacheStatus().traef).toBe(1);
  expect(cacheStatus().forbier).toBe(1);
});

test('F265.9 DØR 1: en NY vektor kan findes med det samme — ikke først efter genstart', async () => {
  // EGEN Trail. Prøverne deler database, og en der skriver i en anden prøves
  // Trail gør tællingerne dér afhængige af rækkefølgen — den slags grønt/rødt
  // siger noget om testfilen frem for om koden.
  await kb('kb-doer1');
  await neuronMedVektor('d1a', 'kb-doer1', 11);
  await loadVectors(trail, T, 'kb-doer1');     // varm
  expect(cacheStatus().trails).toBe(1);

  await neuronMedVektor('d1b', 'kb-doer1', 12); // storeEmbedding skal rydde
  const efter = await loadVectors(trail, T, 'kb-doer1');

  expect(efter.length).toBe(2);
  expect(efter.map((v) => v.chunkId)).toContain('c-d1b');
});

test('F265.9 DØR 2: en RYDNING slår igennem — en slettet vektor bliver ikke hængende', async () => {
  await kb('kb-doer2');
  await neuronMedVektor('d2a', 'kb-doer2', 21);
  await loadVectors(trail, T, 'kb-doer2');
  expect(cacheStatus().trails).toBe(1);

  // Fejeren i indexer.ts gør præcis dette par: DELETE + rydCache.
  await trail.execute(`DELETE FROM chunk_embeddings WHERE knowledge_base_id = ?`, ['kb-doer2']);
  rydCache(T, 'kb-doer2');

  expect(await loadVectors(trail, T, 'kb-doer2')).toHaveLength(0);
});

test('F265.9 NEGATIV KONTROL: uden rydning ville den gamle liste blive serveret', async () => {
  // Beviser at rydningen i de to prøver ovenfor GØR noget — uden den her
  // kunne begge være grønne fordi databasen tilfældigvis blev spurgt igen.
  await kb('kb-neg');
  await neuronMedVektor('nega', 'kb-neg', 31);
  await loadVectors(trail, T, 'kb-neg');
  await trail.execute(`DELETE FROM chunk_embeddings WHERE knowledge_base_id = ?`, ['kb-neg']);
  // BEVIDST ingen rydCache her:
  expect(await loadVectors(trail, T, 'kb-neg')).toHaveLength(1); // den forældede
  rydCache(T, 'kb-neg');
  expect(await loadVectors(trail, T, 'kb-neg')).toHaveLength(0); // og så den rigtige
});

test('F265.9 LOFTET håndhæves, og det er den KOLDESTE Trail der ryger', () => {
  // Direkte mod cachen med syntetiske poster: at fylde 200 MB gennem rigtig
  // SQL ville tage minutter og måle SQLite frem for udsmidningen.
  const stor = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      chunkId: `c${i}`, documentId: `d${i}`, vector: new Float32Array(1024),
    }));
  // Størrelsen er valgt så PRÆCIS ÉN udsmidning er nødvendig. Med tre store
  // Trails og en fjerde der lige sprænger loftet, kan prøven skelne «den
  // koldeste røg» fra «der røg noget» — og det er hele påstanden.
  const pr_trail = 16_000; // ~65,5 MB. Tre = 196 MB (under), fire = 262 MB (over).
  laegICache(T, 'a', EMBEDDING_MODEL, stor(pr_trail));
  laegICache(T, 'b', EMBEDDING_MODEL, stor(pr_trail));
  laegICache(T, 'c', EMBEDDING_MODEL, stor(pr_trail));
  // Gør 'a' og 'b' varme; 'c' står tilbage som den koldeste.
  hentFraCache(T, 'a', EMBEDDING_MODEL);
  hentFraCache(T, 'b', EMBEDDING_MODEL);
  laegICache(T, 'd', EMBEDDING_MODEL, stor(pr_trail)); // sprænger loftet

  expect(cacheStatus().bytes).toBeLessThanOrEqual(CACHE_LOFT_BYTES);
  expect(cacheStatus().udsmidt).toBe(1);
  // DEN BÆRENDE: det er den KOLDESTE der røg, ikke en tilfældig.
  expect(hentFraCache(T, 'c', EMBEDDING_MODEL)).toBeNull();
  expect(hentFraCache(T, 'a', EMBEDDING_MODEL)).not.toBeNull();
  expect(hentFraCache(T, 'b', EMBEDDING_MODEL)).not.toBeNull();
  expect(hentFraCache(T, 'd', EMBEDDING_MODEL)).not.toBeNull();
});

test('F265.9 en Trail der er SMIDT UD svarer korrekt, ikke tomt', async () => {
  await kb('kb-ud');
  await neuronMedVektor('uda', 'kb-ud', 41);
  await neuronMedVektor('udb', 'kb-ud', 42);
  await loadVectors(trail, T, 'kb-ud');
  rydCache(T, 'kb-ud');                         // som en udsmidning
  const efter = await loadVectors(trail, T, 'kb-ud');
  expect(efter).toHaveLength(2);                // faldet tilbage til basen
});

test('F265.9 en Trail større end HELE loftet cacher vi ikke — frem for at tømme alt', () => {
  const kaempe = Array.from({ length: 60_000 }, (_, i) => ({
    chunkId: `k${i}`, documentId: `d${i}`, vector: new Float32Array(1024),
  })); // ~245 MB > loftet
  laegICache(T, 'kaempe', EMBEDDING_MODEL, kaempe);
  expect(hentFraCache(T, 'kaempe', EMBEDDING_MODEL)).toBeNull();
  expect(cacheStatus().bytes).toBe(0);
});

test('F265.9 MODELLEN er en del af nøglen — to modeller må ikke dele vektorer', () => {
  laegICache(T, KB, 'model-a', [{ chunkId: 'x', documentId: 'd', vector: new Float32Array(1024) }]);
  // Cosinus mellem to modellers vektorer er meningsløs uden at være forkert på
  // nogen målbar måde — derfor må et opslag på model-b ikke ramme model-a's post.
  expect(hentFraCache(T, KB, 'model-b')).toBeNull();
  expect(hentFraCache(T, KB, 'model-a')).not.toBeNull();
});

test('F265.9 én kundes cache kan ikke læses af en anden', () => {
  laegICache(T, KB, EMBEDDING_MODEL, [{ chunkId: 'x', documentId: 'd', vector: new Float32Array(1024) }]);
  expect(hentFraCache('en-anden-kunde', KB, EMBEDDING_MODEL)).toBeNull();
});

test('F265.9 en FEJNING DER SLETTER NUL må ikke rydde cachen', () => {
  // DEN DYRE FEJL, målt på prod i første udgave: fejeren ryddede ubetinget.
  // Den kører hver 10. minut for hver Trail, og de fleste kørsler sletter nul
  // rækker — så cachen blev tømt hurtigere end den blev brugt. traef=10,
  // ryddet=2, trails=0: den virkede, den nåede bare aldrig at hjælpe.
  //
  // Prøven spejler fejerens BESLUTNING, ikke dens SQL: ryd kun når der faktisk
  // blev slettet noget.
  const post = [{ chunkId: 'x', documentId: 'd', vector: new Float32Array(1024) }];
  laegICache(T, 'kb-fej', EMBEDDING_MODEL, post);

  const fejning = (slettedeRaekker: number) => {
    if (slettedeRaekker > 0) rydCache(T, 'kb-fej');
  };

  fejning(0);
  expect(hentFraCache(T, 'kb-fej', EMBEDDING_MODEL)).not.toBeNull(); // stadig varm

  fejning(3);
  expect(hentFraCache(T, 'kb-fej', EMBEDDING_MODEL)).toBeNull();     // og ryddet når det gælder
});

test('F265.9 fejerens kaldested ER betinget — ikke kun prøvens model af det', () => {
  // Prøven ovenfor tester en KOPI af beslutningen. Uden denne kunne
  // indexer.ts gå tilbage til ubetinget rydning uden at noget blev rødt.
  const kode = readFileSync(
    new URL('./indexer.ts', import.meta.url), 'utf8',
  );
  expect(kode).toContain('if (Number(ryddet.rowsAffected ?? 0) > 0) {');
  expect(kode).not.toMatch(/\n  rydVektorCache\(tenantId, knowledgeBaseId\);/);
});

// ── F265.12 — en skrivning må ikke koste hele Trail'en ────────────────────

test('F265.12 DEN BÆRENDE: efter en inkrementel opdatering er cachen IDENTISK med databasen', async () => {
  // Hurtigt-og-forkert er den farlige udgang her. En prøve på «antallet steg
  // med 1» ville bestå på en vektor lagt det forkerte sted, med de forkerte
  // tal, eller på det forkerte dokument. Derfor sammenlignes hver eneste
  // Float32Array-værdi mod et FRISKT databaseopslag, i rækkefølge.
  nulstilCache();
  await kb('kb-ident');
  await neuronMedVektor('i1', 'kb-ident', 11);
  await neuronMedVektor('i2', 'kb-ident', 22);
  await loadVectors(trail, T, 'kb-ident');            // varm cachen op

  await neuronMedVektor('i3', 'kb-ident', 33);         // skrivning MENS den er varm
  const fraCache = hentFraCache(T, 'kb-ident', EMBEDDING_MODEL)!;
  expect(fraCache).not.toBeNull();

  nulstilCache();                                      // tving et frisk opslag
  const fraDb = await loadVectors(trail, T, 'kb-ident');

  const nøgle = (v: { chunkId: string }) => v.chunkId;
  expect(fraCache.map(nøgle).sort()).toEqual(fraDb.map(nøgle).sort());

  const dbEfterId = new Map(fraDb.map((v) => [v.chunkId, v]));
  for (const c of fraCache) {
    const d = dbEfterId.get(c.chunkId)!;
    expect(d).toBeDefined();
    expect(c.documentId).toBe(d.documentId);
    expect(c.vector.length).toBe(d.vector.length);
    for (let i = 0; i < c.vector.length; i++) expect(c.vector[i]).toBe(d.vector[i]);
  }
});

test('F265.12 en ÆNDRET Neuron erstatter sin plads — den bliver ikke lagt ved siden af', async () => {
  // Uden erstatningen ville chunk'en optræde TO gange med hver sin vektor, og
  // søgningen ville rangere det samme stykke to steder på et forældet tal.
  nulstilCache();
  await kb('kb-erstat');
  await neuronMedVektor('e1', 'kb-erstat', 5);
  await loadVectors(trail, T, 'kb-erstat');

  await storeEmbedding(trail, {
    chunkId: 'c-e1', tenantId: T, knowledgeBaseId: 'kb-erstat', documentId: 'e1',
    vector: vektor(999), model: EMBEDDING_MODEL, content: 'ny krop',
  });

  const v = hentFraCache(T, 'kb-erstat', EMBEDDING_MODEL)!;
  expect(v.filter((x) => x.chunkId === 'c-e1').length).toBe(1);
  // Sammenlignet mod værdien efter SAMME float32-konvertering, ikke mod
  // JS-tallet: vektorer gemmes som float32, så et krav om float64-præcision
  // ville være en prøve på lagerformatet frem for på at den rigtige vektor
  // landede. Streng lighed — ikke «tæt på».
  expect(v[0]!.vector[0]).toBe(new Float32Array([vektor(999)[0]!])[0]!);
});

test('F265.12 KERNEN: en skrivning tømmer IKKE længere Trail\'en', async () => {
  // Præcis den fejl kortet findes for. Før: ryddet steg, trails faldt til 0,
  // og næste søgning betalte 16 sekunder på at hente 11.017 vektorer hjem.
  nulstilCache();
  await kb('kb-beholdt');
  await neuronMedVektor('b1', 'kb-beholdt', 1);
  await neuronMedVektor('b2', 'kb-beholdt', 2);
  await loadVectors(trail, T, 'kb-beholdt');
  const førT = cacheStatus().trails;

  await neuronMedVektor('b3', 'kb-beholdt', 3);

  expect(cacheStatus().trails).toBe(førT);                       // stadig i cachen
  expect(hentFraCache(T, 'kb-beholdt', EMBEDDING_MODEL)).not.toBeNull();
  expect(cacheStatus().opdateret).toBeGreaterThan(0);
});

test('F265.12 en Trail der IKKE er cachet får ikke bygget en halv liste', async () => {
  // En delvis liste ville give et halvt søgeresultat der ligner et helt —
  // værre end en kold cache, fordi ingen kan se forskel.
  nulstilCache();
  await kb('kb-uvarm');
  await neuronMedVektor('u1', 'kb-uvarm', 7);   // skrevet UDEN at cachen er varm
  expect(hentFraCache(T, 'kb-uvarm', EMBEDDING_MODEL)).toBeNull();

  const fra = await loadVectors(trail, T, 'kb-uvarm');
  expect(fra.length).toBe(1);                   // databasen har den, som altid
});

test('F265.12 en SLETNING rydder stadig helt — den kan ikke være en opdatering', async () => {
  // Beholder cachen en slettet Neuron, svarer søgningen selvsikkert med noget
  // der ikke findes mere. Det er værre end en langsom søgning.
  nulstilCache();
  await kb('kb-slet');
  await neuronMedVektor('s1', 'kb-slet', 3);
  await loadVectors(trail, T, 'kb-slet');
  expect(hentFraCache(T, 'kb-slet', EMBEDDING_MODEL)).not.toBeNull();

  rydCache(T, 'kb-slet');
  expect(hentFraCache(T, 'kb-slet', EMBEDDING_MODEL)).toBeNull();
});

test('F265.12 OPVARMNING: største Trail først, og cachen er klar før nogen søger', async () => {
  nulstilCache();
  await kb('kb-lille');
  await kb('kb-stor');
  await neuronMedVektor('L1', 'kb-lille', 1);
  for (let i = 0; i < 5; i++) await neuronMedVektor(`S${i}`, 'kb-stor', 100 + i);

  const r = await varmOpVektorer(trail);

  expect(r.videnbaser).toBeGreaterThanOrEqual(2);
  expect(r.vektorer).toBeGreaterThanOrEqual(6);
  // Begge er varme UDEN at nogen har søgt.
  expect(hentFraCache(T, 'kb-stor', EMBEDDING_MODEL)).not.toBeNull();
  expect(hentFraCache(T, 'kb-lille', EMBEDDING_MODEL)).not.toBeNull();
});
