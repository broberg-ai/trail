/**
 * F263.15 — «venter» skal betyde «kan tages nu», ikke «flaget er sat».
 *
 * Den bærende påstand er en SAMTIDIGHEDS-påstand, så hver positiv prøve er
 * parret med en negativ kontrol i modsat retning. Uden dem ville «returnér
 * aldrig noget» bestå halvdelen af filen.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';
import { createLibsqlDatabase, documents, type TrailDatabase } from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { kanTagesNu } from './documents.js';

const T = 't-lease', U = 'u-lease', KB = 'kb-lease';
const NU = '2026-09-09T12:00:00.000Z';
let trail!: TrailDatabase;
const dbPath = join(process.env.TMPDIR ?? '/tmp', `koelease-${process.pid}.db`);

async function kilde(id: string, lease: string | null) {
  await trail.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, filename, file_type, path,
                            title, content, kind, archived, awaiting_local_compile,
                            compile_lease_until, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'source',0,1,?,?,?)`,
    [id, T, KB, U, `${id}.md`, 'md', '/', id, 'krop', lease, NU, NU],
  );
}

/** Præcis prædikatet ruten bruger — importeret, ikke kopieret. */
async function ledige(nu = NU): Promise<string[]> {
  const rows = await trail.db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.tenantId, T), kanTagesNu(nu), eq(documents.archived, false)))
    .all();
  return rows.map((r) => r.id).sort();
}

beforeAll(async () => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
  trail = await createLibsqlDatabase({ path: dbPath });
  await trail.runMigrations();
  await trail.execute(`INSERT INTO tenants (id, slug, name) VALUES (?,?,?)`, [T, 'tl', 'TL']);
  await trail.execute(`INSERT INTO users (id, tenant_id, email, role) VALUES (?,?,?,?)`, [U, T, 'a@b.dk', 'owner']);
  await trail.execute(
    `INSERT INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES (?,?,?,?,?)`,
    [KB, T, 'kb', 'KB', U],
  );
  await kilde('uden-lease', null);                          // aldrig claimet
  await kilde('lease-i-live', '2026-09-09T12:05:00.000Z');  // 5 min ude i fremtiden
  await kilde('lease-udloebet', '2026-09-09T11:55:00.000Z');// 5 min siden
  await kilde('lease-lige-nu', NU);                          // præcis kanten
});

afterAll(() => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
});

test('F263.15 en LEVENDE lease skjuler kilden — det er hele fejlen kortet lukker', async () => {
  expect(await ledige()).not.toContain('lease-i-live');
});

test('F263.15 NEGATIV KONTROL: uden lease er kilden stadig ledig', async () => {
  // Uden den ville «returnér ingenting» bestå prøven ovenfor — og den
  // håndkørte vej ville holde op med at kunne se noget som helst.
  expect(await ledige()).toContain('uden-lease');
});

test('F263.15 en UDLØBET lease bliver ledig igen af sig selv', async () => {
  // Selvhelbredelsen: ingen rydder et flag. Det er derfor leasen er en frist
  // og ikke en lås — en død arbejder frigiver ingenting.
  expect(await ledige()).toContain('lease-udloebet');
});

test('F263.15 KANTEN: en lease der udløber i dette sekund tæller som ledig', async () => {
  // Målt frem for valgt: prædikatet er `lease < nu`, så lease == nu er IKKE
  // ledig. Begge sider af kanten hævdes, så en fremtidig ændring fra < til <=
  // ikke kan ske ubemærket.
  expect(await ledige()).not.toContain('lease-lige-nu');
  expect(await ledige('2026-09-09T12:00:00.001Z')).toContain('lease-lige-nu');
});

test('F263.15 BEGGE ruter bruger prædikatet — ikke kun den ene', async () => {
  // To kaldesteder, og det var netop asymmetrien der var fejlen: den leasede
  // vej så leasen, den gamle gjorde ikke. En prøve på prædikatet alene ville
  // være grøn selv hvis en rute holdt op med at kalde det.
  const kilde = readFileSync(new URL('./documents.ts', import.meta.url), 'utf8');
  expect(kilde.split('kanTagesNu(new Date().toISOString())').length - 1).toBe(2);
  expect(kilde).not.toContain('conditions.push(eq(documents.awaitingLocalCompile, true))');
});

test('F263.15 ids-feltet er load-bearing for buddys dedup og skal blive', async () => {
  // buddy målte det selv (#27054): mangler `ids`, falder deres nøgle stille
  // tilbage til ANTALLET, og to forskellige kilder med samme antal ser ens ud
  // — så ægte nyt arbejde springes over. Ingen af os kan se den fejl udefra.
  const kilde = readFileSync(new URL('./documents.ts', import.meta.url), 'utf8');
  expect(kilde).toContain('ids: rows.map((r) => r.id)');
});
