/**
 * F265.8 — hele Neuronen, kun når nogen beder om den.
 *
 * Den bærende påstand er en NEGATIV: uden flaget skal svaret være som før.
 * Uden den prøve ville «returnér altid indhold» bestå resten af filen — og
 * genindføre de ~3.770 tokens pr. opslag som F265.3 lige har fjernet for
 * flådens agenter.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';
import { createLibsqlDatabase, type TrailDatabase } from '@trail/db';
import { hentIndhold } from './search.js';

const T = 't-ind', U = 'u-ind', KB = 'kb-ind';
let trail!: TrailDatabase;
const dbPath = join(process.env.TMPDIR ?? '/tmp', `indhold-${process.pid}.db`);
const LANG = 'Dette er hele Neuronens tekst. '.repeat(80); // ~2.4 kB

async function neuron(id: string, indhold: string, arkiveret = 0) {
  await trail.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, filename, file_type, path,
                            title, content, kind, archived, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'/neurons/',?,?, 'wiki', ?, '2026-09-09','2026-09-09')`,
    [id, T, KB, U, `${id}.md`, 'md', id, indhold, arkiveret],
  );
}

beforeAll(async () => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
  trail = await createLibsqlDatabase({ path: dbPath });
  await trail.runMigrations();
  await trail.execute(`INSERT INTO tenants (id, slug, name) VALUES (?,?,?)`, [T, 'ti', 'TI']);
  await trail.execute(`INSERT INTO users (id, tenant_id, email, role) VALUES (?,?,?,?)`, [U, T, 'a@b.dk', 'owner']);
  await trail.execute(
    `INSERT INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES (?,?,?,?,?)`,
    [KB, T, 'kb', 'KB', U],
  );
  await neuron('lang', LANG);
  await neuron('arkiveret', LANG, 1);
});

afterAll(() => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
});

test('F265.8 hele Neuronen kommer med — ikke et uddrag', async () => {
  const m = await hentIndhold(trail, T, ['lang']);
  expect(m.get('lang')?.length).toBe(LANG.length);
  expect(m.get('lang')?.length).toBeGreaterThan(2000); // cms fik 337
});

test('F265.8 en tom liste koster ingen forespørgsel og giver et tomt kort', async () => {
  // Uden den ville `IN ()` blive til ugyldig SQL på det almindelige tilfælde
  // «ingen træf» — altså en fejl på den hyppigste vej.
  expect((await hentIndhold(trail, T, [])).size).toBe(0);
});

test('F265.8 NEGATIV KONTROL: en anden kundes id giver intet', async () => {
  // Uden tenant-betingelsen ville et gættet id fra en anden kunde kunne
  // hentes hjem via flaget. Det er den eneste nye læsevej kortet åbner.
  expect((await hentIndhold(trail, 'en-anden-kunde', ['lang'])).size).toBe(0);
});

test('F265.8 arkiverede Neuroner hentes ikke', async () => {
  expect((await hentIndhold(trail, T, ['arkiveret'])).size).toBe(0);
});

test('F265.8 UDEN flaget findes content-nøglen ikke — det er hele opt-in-løftet', () => {
  const kode = readFileSync(new URL('./search.ts', import.meta.url), 'utf8');
  // Nøglen sættes KUN når hentIndhold gav en værdi, og kortet er tomt uden
  // flaget. Spread-formen er dét der gør fraværet til et fravær frem for
  // `content: undefined` — som ville dukke op i JSON som en ændret form.
  expect(kode).toContain("...(fuldt !== undefined ? { content: redactSecrets(fuldt).redacted } : {})");
  expect(kode).toContain("c.req.query('includeContent') === 'true'");
});

test('F265.8 indholdet hentes EFTER filtrene, ikke før', () => {
  // Rækkefølgen ER sikkerheden: hentes der før publikums-filteret, kan flaget
  // bruges til at nå en Neuron man ikke måtte se uddraget af.
  const kode = readFileSync(new URL('./search.ts', import.meta.url), 'utf8');
  const iFilter = kode.indexOf('isVisibleToAudience(audience');
  const iHent = kode.indexOf('await hentIndhold(trail, tenant.id, filtered');
  expect(iFilter).toBeGreaterThan(-1);
  expect(iHent).toBeGreaterThan(iFilter);
  // og den henter fra `filtered`, ikke fra `documents`
  expect(kode).toContain('hentIndhold(trail, tenant.id, filtered.map((d) => d.id))');
});
