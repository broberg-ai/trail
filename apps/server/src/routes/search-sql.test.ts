/**
 * F261.2 — EN KOLONNE DER IKKE FINDES, FEJLER FØRST I DRIFT.
 *
 * MÅLT 6/9: søgning på «Christian Broberg» svarede 500 — `no such column:
 * seq_id`. Kolonnen hedder `seq`. Fejlen stod i TO af rutens SELECT'er: min
 * egen nye, og hybrid-blokkens, som havde båret den latent siden den blev
 * skrevet.
 *
 * HVORFOR INGEN PRØVE FANGEDE DET. Enheds-prøven for opslaget var grøn — den
 * testede at det RIGTIGE dokument blev fundet, ikke den SQL der bagefter
 * henter rækken. Og begge SELECT'er kører KUN når et træf ikke allerede var i
 * ordresultatet, hvilket er en sjælden gren: «cardmem» var grøn i produktion i
 * samme minut som «Christian Broberg» gav 500.
 *
 * Prøven læser sætningerne UD AF KILDEN og udfører dem, så et forkert
 * kolonnenavn ikke kan overleve en grøn kørsel. Læses de fra en kopi her i
 * filen, beviser den kun at kopien er rigtig.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLibsqlDatabase, type TrailDatabase } from '@trail/db';

const dir = mkdtempSync(join(tmpdir(), 'f261-sql-'));
let db: TrailDatabase;

beforeAll(async () => {
  db = await createLibsqlDatabase({ path: join(dir, 'sql.db') });
  await db.runMigrations();
});
afterAll(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

/** Alle `SELECT … FROM documents`-sætninger i søgeruten, hentet fra kilden. */
function selectsFraRuten(): string[] {
  const kilde = readFileSync(join(import.meta.dir, 'search.ts'), 'utf-8');
  const fundet = [...kilde.matchAll(/`(SELECT[\s\S]*?FROM documents[\s\S]*?)`/g)].map((m) => m[1]!);
  return fundet;
}

test('søgeruten indeholder de SELECT\'er prøven skal dække', () => {
  // POSITIV KONTROL: uden den ville «alle sætninger kører» bestå på nul
  // sætninger — en fraværs-påstand der ikke har kigget på noget.
  expect(selectsFraRuten().length).toBeGreaterThanOrEqual(2);
});

test('hver SELECT i søgeruten kan FAKTISK udføres mod skemaet', async () => {
  for (const sql of selectsFraRuten()) {
    // Erstat `IN (${…})` med en tom-men-lovlig liste, og bind alle ?
    const konkret = sql.replace(/IN \(\$\{[^}]*\}\)/g, "IN ('x')");
    const antalParam = (konkret.match(/\?/g) ?? []).length;
    try {
      await db.execute(konkret, Array(antalParam).fill('x'));
    } catch (err) {
      throw new Error(
        `SELECT i search.ts kan ikke udføres:\n${konkret}\n→ ${err instanceof Error ? err.message : err}`,
      );
    }
  }
});
