/**
 * F259.2 — en genopbygning af søgeindekset ved HVER opstart tog produktionen ned.
 *
 * MÅLT 6/9 på den kørende motor, med tidtagning pr. opstartstrin:
 *
 *     [boot] sanne-andersen/fts:   9s
 *     [boot] fd-aalborg/fts:       2s
 *     [boot] broberg-ai/fts:     273s  →  timeout  →  exit 1  →  reboot
 *
 * DROP+CREATE+rebuild kørte før serveren begyndte at lytte, for hver kunde.
 * Nu genopbygges der kun når skemaet faktisk har ændret sig.
 *
 * HVORDAN PRØVEN KAN SE FORSKEL — det er hele vanskeligheden. «Kørte den
 * hurtigt?» er ikke et svar; en hurtig maskine gør en genopbygning hurtig og
 * prøven grøn på den forkerte grund. Så vi lægger en SPØGELSES-RÆKKE direkte i
 * indekset, med et rowid der ikke findes i `documents`. En genopbygning
 * konstruerer indekset forfra ud fra tabellen og fejer den væk; et spring
 * bevarer den. Rækken er derfor et direkte, binært svar på «blev der
 * genopbygget?».
 */
import { expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { createLibsqlDatabase } from './index.js';

const DB = '/tmp/f259-fts-skip.db';
const SPØGELSE = 'zqxjvmpltrbn'; // et ord der ikke kan optræde i rigtigt indhold

function ryd() {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
}

async function nyBase() {
  ryd();
  const db = await createLibsqlDatabase({ path: DB });
  await db.runMigrations();
  await db.initFTS();
  return db;
}

/** Læg en række i indekset som INTET dokument bakker op om. */
async function lægSpøgelse(db: Awaited<ReturnType<typeof createLibsqlDatabase>>) {
  await db.execute(
    `INSERT INTO documents_fts(rowid, content, title, filename) VALUES (999999, ?, ?, ?)`,
    [SPØGELSE, SPØGELSE, `${SPØGELSE}.md`],
  );
}

async function spøgelsetFindes(db: Awaited<ReturnType<typeof createLibsqlDatabase>>) {
  const r = await db.execute(`SELECT COUNT(*) AS n FROM documents_fts WHERE documents_fts MATCH ?`, [
    SPØGELSE,
  ]);
  return Number((r.rows[0] as unknown as { n: number | bigint }).n) > 0;
}

test('anden opstart på uændret skema genopbygger IKKE', async () => {
  const db = await nyBase();
  await lægSpøgelse(db);
  expect(await spøgelsetFindes(db)).toBe(true); // forudsætning: den ligger der

  await db.initFTS(); // ← skal springe over

  expect(await spøgelsetFindes(db)).toBe(true);
  await db.close();
  ryd();
});

test('POSITIV KONTROL: en tvungen genopbygning fejer spøgelset væk', async () => {
  // Uden denne beviser prøven ovenfor kun at spøgelses-rækken er svær at slette.
  const db = await nyBase();
  await lægSpøgelse(db);
  expect(await spøgelsetFindes(db)).toBe(true);

  process.env.TRAIL_FTS_REBUILD = '1';
  try {
    await db.initFTS();
  } finally {
    delete process.env.TRAIL_FTS_REBUILD;
  }

  expect(await spøgelsetFindes(db)).toBe(false);
  await db.close();
  ryd();
});

test('ÆGTE skema-afvigelse genopbygger — en manglende trigger', async () => {
  // Skemaet i basen afviger nu FAKTISK fra vores DDL. Det er den tilstand der
  // skal udløse en genopbygning — ikke et tal i en versions-kolonne.
  const db = await nyBase();
  await lægSpøgelse(db);
  await db.execute(`DROP TRIGGER documents_au`);
  await db.execute(`UPDATE fts_schema SET version = 'gammel' WHERE id = 1`);

  await db.initFTS();

  expect(await spøgelsetFindes(db)).toBe(false);
  const r = await db.execute(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'documents_au'`,
  );
  expect(Number((r.rows[0] as unknown as { n: number | bigint }).n)).toBe(1); // genskabt
  await db.close();
  ryd();
});

test('OVERTAGELSE: et korrekt skema uden versions-stempel genopbygges IKKE', async () => {
  // Fælden vi selv gravede i produktion: broberg-ais engangs-genopbygning tog
  // 278s og ramte sqld's timeout, så versionen aldrig blev skrevet, så næste
  // opstart genopbyggede igen. Et fix der først virker EFTER en genopbygning
  // der aldrig kan lykkes, virker aldrig. Bærer basen allerede præcis dette
  // skema, stemples versionen og indekset står urørt.
  const db = await nyBase();
  await lægSpøgelse(db);
  await db.execute(`DELETE FROM fts_schema`); // som en base der aldrig har set F259.2

  await db.initFTS();

  expect(await spøgelsetFindes(db)).toBe(true); // ikke genopbygget
  const r = await db.execute(`SELECT version FROM fts_schema WHERE id = 1`);
  const v = (r.rows[0] as unknown as { version: string } | undefined)?.version;
  expect((v ?? '').length).toBe(16); // og stemplet, så næste opstart springer over
  await db.close();
  ryd();
});

test('NEGATIV KONTROL: en versions-række uden tabeller må ikke springe over', async () => {
  // Den farlige genvej ville være at stole på versions-rækken alene. Så ville
  // en base hvor FTS-tabellerne er væk springe opbygningen over, og enhver
  // søgning ville fejle — en tavs, total nedbrydning af søgningen.
  const db = await nyBase();
  await db.execute(`DROP TABLE IF EXISTS documents_fts`);
  await db.execute(`DROP TABLE IF EXISTS chunks_fts`);

  await db.initFTS();

  const r = await db.execute(
    `SELECT COUNT(*) AS n FROM sqlite_master
      WHERE type = 'table' AND name IN ('documents_fts', 'chunks_fts')`,
  );
  expect(Number((r.rows[0] as unknown as { n: number | bigint }).n)).toBe(2);
  await db.close();
  ryd();
});

test('versionen skrives ned, så næste opstart kan springe over', async () => {
  const db = await nyBase();
  const r = await db.execute(`SELECT version FROM fts_schema WHERE id = 1`);
  const v = (r.rows[0] as unknown as { version: string } | undefined)?.version;
  expect(typeof v).toBe('string');
  expect((v ?? '').length).toBe(16);
  await db.close();
  ryd();
});

test('søgningen virker stadig efter et spring', async () => {
  // Springet må ikke være grønt på bekostning af det indekset findes til.
  const db = await nyBase();
  await db.initFTS();
  await db.initFTS(); // springer over
  const r = await db.execute(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'documents_fts'`,
  );
  expect(Number((r.rows[0] as unknown as { n: number | bigint }).n)).toBe(1);
  await db.close();
  ryd();
});
