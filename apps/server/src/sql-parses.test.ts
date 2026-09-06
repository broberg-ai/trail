/**
 * F262.2 — EN SÆTNING DER IKKE KAN PARSES, SER UD SOM EN INDSTILLING.
 *
 * MÅLT 6. september 2026. `hybridEnabled()` skrev:
 *
 *   SELECT hybrid_search_enabled AS on FROM knowledge_bases WHERE id = ?
 *
 * `on` er et reserveret ord i SQLite. Sætningen kunne slet ikke parses, en
 * catch svarede `false`, og vektorsøgningen kørte ALDRIG i produktion — ikke
 * på nogen videnbase, ikke ét sekund, mens kolonnen stod på 1 og kontakten i
 * brugerfladen så tændt ud.
 *
 * ENHEDSPRØVER MED MOCK FANGER DEN IKKE. En prøve der kalder hybridEnabled med
 * en stub-database beviser at logikken omkring svaret er rigtig, og den ville
 * have været grøn hele vejen igennem. Kun det at UDFØRE sætningen mod et rigtigt
 * skema kan skelne.
 *
 * Derfor fejer denne prøve HELE motoren igennem, ikke kun den ene fil: fejlen
 * lå i services/, mens F261.2's tilsvarende prøve kun dækkede routes/search.ts.
 * En prøve der kun dækker det sted man sidst blev brændt, dækker altid fortiden.
 *
 * ÆRLIGT OM RÆKKEVIDDEN: sætninger hvis `${}` ikke er en IN-liste kan ikke
 * udføres uden at gætte hvad der bliver sat ind, og gættet kunne selv lave
 * fejlen. De er talt op og skrevet ud, så hullet er SYNLIGT frem for antaget.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createLibsqlDatabase, type TrailDatabase } from '@trail/db';

const dir = mkdtempSync(join(tmpdir(), 'f262-sql-'));
let db: TrailDatabase;

beforeAll(async () => {
  db = await createLibsqlDatabase({ path: join(dir, 'sql.db') });
  await db.runMigrations();
});
afterAll(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const ROD = join(import.meta.dir, '..', '..', '..');

interface Sætning { fil: string; sql: string }

/** Blok- og linjekommentarer ud, så kun rigtig kode fejes. */
function udenKommentarer(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Tabeller der med vilje IKKE ligger i motorens skema.
 *
 * Ikke en undtagelsesliste for fejl — en grænse mellem to databaser. Nøgle- og
 * sessions-indekset er kontrolplanets (apps/admin-server), og `trail_migration`
 * skrives af flytte-scriptet på sqld-siden. En sætning mod dem kan ikke prøves
 * her, og at lade dem fejle ville lære læseren at ignorere rødt.
 */
const FREMMEDE_TABELLER = new Set(['api_key_index', 'session_index', 'trail_migration']);

function alleSelects(): { kørbare: Sætning[]; sprunget: Sætning[] } {
  const filer = execSync(
    "git ls-files 'apps/server/src/**/*.ts' 'packages/core/src/**/*.ts' 'packages/db/src/**/*.ts'",
    { cwd: ROD },
  ).toString().trim().split('\n').filter((f) => f && !/\.test\.ts$/.test(f));

  const kørbare: Sætning[] = [];
  const sprunget: Sætning[] = [];
  for (const fil of filer) {
    // KOMMENTARER FØRST VÆK. Prøvens allerførste kørsel flaggede
    // `SELECT hybrid_search_enabled AS on` — den fejl den blev skrevet for, og
    // som var rettet: strengen stod i JSDoc'en der DOKUMENTERER fejlen. En
    // fejning der læser sin egen dokumentation som kode, rapporterer fortiden.
    const kilde = udenKommentarer(readFileSync(join(ROD, fil), 'utf-8'));
    for (const m of kilde.matchAll(/`(\s*SELECT[\s\S]*?)`/g)) {
      const sql = m[1]!;
      const interp = [...sql.matchAll(/\$\{[^}]*\}/g)];
      // Kun `IN (${…})` kan erstattes trygt — den er altid en liste af ?.
      const trygt = interp.every((i) =>
        /IN \(\$\{[^}]*\}\)/.test(sql.slice(Math.max(0, i.index! - 4), i.index! + i[0].length + 1)));
      (trygt ? kørbare : sprunget).push({ fil, sql });
    }
  }
  return { kørbare, sprunget };
}

test('fejningen finder faktisk sætninger — ellers består den på ingenting', () => {
  const { kørbare } = alleSelects();
  // POSITIV KONTROL. Uden den ville en fejl i git ls-files eller i regex'en
  // give nul sætninger, og «alle kører» ville bestå uden at have kigget.
  expect(kørbare.length).toBeGreaterThanOrEqual(40);
});

test('hybridEnabled\'s egen sætning er MED i fejningen', () => {
  const { kørbare } = alleSelects();
  const hybrid = kørbare.filter((s) => s.fil.endsWith('services/hybrid-search.ts'));
  // Den fil er hele grunden til at prøven findes. Falder den ud af fejningen
  // — omskrevet, flyttet, delt op — skal prøven sige det, ikke tie.
  expect(hybrid.length).toBeGreaterThanOrEqual(1);
  expect(hybrid.some((s) => /hybrid_search_enabled/.test(s.sql))).toBe(true);
});

test('hver SELECT i motoren kan FAKTISK udføres mod skemaet', async () => {
  const { kørbare, sprunget } = alleSelects();
  const fejl: string[] = [];
  for (const { fil, sql } of kørbare) {
    const konkret = sql.replace(/IN \(\$\{[^}]*\}\)/g, "IN ('x')");
    const antalParam = (konkret.match(/\?/g) ?? []).length;
    try {
      await db.execute(konkret, Array(antalParam).fill('x'));
    } catch (err) {
      const besked = err instanceof Error ? err.message : String(err);
      // Kun PARSE- og skema-fejl er interessante. En sætning kan sagtens
      // fejle på en type eller en tom tabel uden at være forkert skrevet.
      const fremmed = [...FREMMEDE_TABELLER].some((t) => besked.includes(`no such table: ${t}`));
      if (!fremmed && /syntax error|no such column|no such table|no such function/i.test(besked)) {
        fejl.push(`${fil}:\n${konkret.trim()}\n→ ${besked}`);
      }
    }
  }
  if (fejl.length > 0) throw new Error(`${fejl.length} SELECT kan ikke udføres:\n\n${fejl.join('\n\n')}`);
  // Rækkevidden skrives ud ved hver grøn kørsel, så «alt er dækket» aldrig
  // kan læses ind i et grønt flueben.
  console.log(`[F262.2] ${kørbare.length} SELECT udført · ${sprunget.length} sprunget over (indsat udtryk der ikke er en IN-liste)`);
});
