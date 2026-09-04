/**
 * F238 — sletning af et billede må ikke være umulig.
 *
 * MÅLT PÅ PRODUKTION 4. september: alle tre tenants kunne ikke slette et
 * billede. sanne-andersen (1.557), broberg-ai (742), fd-aalborg (53 — en
 * kunde). Migration 0046 havde oprettet et contentless FTS5-indeks over rækker
 * der ALLEREDE fandtes, uden en rebuild, så indekset var tomt; en DELETE fyrer
 * en trigger der vil fjerne en post der aldrig blev indsat, og SQLite svarer
 * «database disk image is malformed».
 *
 * HVORFOR INTET FANGEDE DET, og det er den vigtige del:
 *
 *   PRAGMA integrity_check          sagde  ok
 *   FTS5 integrity-check, begge idx sagde  OK
 *   en SØGNING i indekset           virkede
 *   en frisk database               virker altid — der er ingen rækker at
 *                                   være ude af sync med
 *
 * Fire grønne signaler, og fejlen sad i den ene handling ingen af dem udfører.
 * Derfor prøver DENNE test det den skal bevise: den SLETTER.
 *
 * Og den gør det på en database hvor rækkerne fandtes FØR indekset — ellers
 * ville den bestå på præcis den tilstand der aldrig fejler.
 */
import { expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { createLibsqlDatabase } from './index.js';

const DB = '/tmp/f238-fts-delete.db';

async function freshDb() {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
  const trail = await createLibsqlDatabase({ path: DB });
  await trail.runMigrations();
  return trail;
}

test('et billede kan slettes efter migrationerne — på en TOM database', async () => {
  const trail = await freshDb();
  await trail.execute('PRAGMA foreign_keys = OFF');
  await trail.execute(
    `INSERT INTO document_images (id,document_id,tenant_id,knowledge_base_id,filename,storage_path,content_hash,size_bytes,width,height)
     VALUES ('a','d1','t1','kb1','x.png','p','h',10,100,100)`,
  );
  await trail.execute("DELETE FROM document_images WHERE id='a'");
  const n = (await trail.execute('SELECT COUNT(*) AS n FROM document_images')).rows[0] as { n: number };
  expect(Number(n.n)).toBe(0);
});

test('DEN MÅLTE FEJL — rækker der fandtes FØR indekset kan stadig slettes', async () => {
  // Genskaber produktionstilstanden: et contentless FTS5-indeks oprettet oven
  // på rækker der allerede var der. Det er den ENESTE tilstand fejlen findes i,
  // og derfor den eneste der er værd at teste.
  const trail = await freshDb();
  await trail.execute('PRAGMA foreign_keys = OFF');
  for (let i = 0; i < 5; i++) {
    await trail.execute(
      `INSERT INTO document_images (id,document_id,tenant_id,knowledge_base_id,filename,storage_path,content_hash,size_bytes,width,height)
       VALUES ('r${i}','d1','t1','kb1','f${i}.png','p${i}','h',10,100,100)`,
    );
  }

  const raw = new Database(DB);
  // Riv indekset ned og byg det op igen UDEN rebuild — nøjagtig det 0046 gjorde.
  raw.run('DROP TABLE document_images_ocr_fts');
  raw.run(`CREATE VIRTUAL TABLE document_images_ocr_fts USING fts5(
    ocr_text, content='document_images', content_rowid='rowid')`);

  // NEGATIV KONTROL: uden rebuild SKAL sletningen fejle. Består den her, kan
  // testen nedenfor ikke bevise noget — så vi ville måle et indeks der aldrig
  // var i stykker.
  let brokeAsExpected = false;
  try { raw.run("DELETE FROM document_images WHERE id='r0'"); }
  catch (e) { brokeAsExpected = String((e as Error).message).includes('malformed'); }
  expect(brokeAsExpected).toBe(true);

  // Og reparationen — den ene linje 0046 manglede.
  raw.run("INSERT INTO document_images_ocr_fts(document_images_ocr_fts) VALUES('rebuild')");
  raw.run("DELETE FROM document_images WHERE id='r0'");
  const left = raw.query('SELECT COUNT(*) n FROM document_images').get() as { n: number };
  expect(left.n).toBe(4);
  raw.close();
});

test('migration 0046 BÆRER sin rebuild — teksten, ikke kun opførslen', async () => {
  // Opførsels-testen ovenfor ville også bestå hvis nogen fjernede rebuild fra
  // 0046 og lagde den et tredje sted. Denne pinner den hvor den hører hjemme.
  const sql = await Bun.file(new URL('../drizzle/0046_image_ocr.sql', import.meta.url)).text();
  expect(sql).toContain("VALUES('rebuild')");
});
