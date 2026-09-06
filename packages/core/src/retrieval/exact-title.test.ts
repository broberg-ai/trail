/**
 * F261 — «hvis jeg søger efter "Cardmem" så leder jeg i min hjerne efter om
 * der er en præcis reference (en neuron) med det navn.» (ejeren, 6/9 2026)
 *
 * MÅLT FØR REGLEN: søgning på «Christian Broberg» i broberg.ai gav hans egen
 * Neuron som nr. 17, under seksten sider der blot NÆVNTE «broberg».
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibsqlDatabase, type TrailDatabase } from '@trail/db';
import { exactTitleMatches } from './exact-title.js';

const dir = mkdtempSync(join(tmpdir(), 'f261-'));
let db: TrailDatabase;
const T = 't-1', KB = 'kb-1';

async function nyt(id: string, titel: string, o: { kind?: string; archived?: number; kb?: string; tid?: string } = {}) {
  await db.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, filename, file_type, path,
                            title, content, kind, archived, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, T, o.kb ?? KB, 'u-1', `${id}.md`, 'md', '/neurons/entities/', titel, 'krop',
     o.kind ?? 'wiki', o.archived ?? 0, '2026-01-01', o.tid ?? '2026-01-01'],
  );
}

beforeAll(async () => {
  db = await createLibsqlDatabase({ path: join(dir, 'f261.db') });
  await db.runMigrations();
  await db.execute(`INSERT INTO tenants (id, slug, name) VALUES (?,?,?)`, [T, 't1', 'T1']);
  await db.execute(`INSERT INTO users (id, tenant_id, email, role) VALUES (?,?,?,?)`,
    ['u-1', T, 'a@b.dk', 'owner']);
  for (const k of [KB, 'kb-2'])
    await db.execute(`INSERT INTO knowledge_bases (id, tenant_id, created_by, slug, name) VALUES (?,?,?,?,?)`,
      [k, T, 'u-1', k, k]);
  await nyt('cb', 'Christian Broberg');
  await nyt('cm', 'cardmem');
  await nyt('log', 'Log');                                   // nævner navnet, hedder det ikke
  await nyt('kilde', 'Christian Broberg', { kind: 'source' }); // rå kilde
  await nyt('arkiv', 'cardmem', { archived: 1 });             // arkiveret
  await nyt('anden-kb', 'cardmem', { kb: 'kb-2' });           // anden videnbase
});
afterAll(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('et helt navn rammer sin Neuron', async () => {
  const r = await exactTitleMatches(db, T, KB, 'Christian Broberg');
  expect(r.map((x) => x.id)).toEqual(['cb']);
});

test('ét ord rammer også — «cardmem»', async () => {
  const r = await exactTitleMatches(db, T, KB, 'cardmem');
  expect(r.map((x) => x.id)).toEqual(['cm']);
});

test('store bogstaver og mellemrum er ligegyldige', async () => {
  for (const q of ['christian broberg', '  Christian Broberg  ', 'CHRISTIAN BROBERG']) {
    expect((await exactTitleMatches(db, T, KB, q)).map((x) => x.id)).toEqual(['cb']);
  }
});

test('NEGATIV KONTROL: en DELVIS titel rammer ikke', async () => {
  // Ellers ville «Christian» trække alt med navnet i titlen frem, og så er
  // det ikke længere et præcist opslag men en dårlig ordsøgning.
  expect(await exactTitleMatches(db, T, KB, 'Christian')).toEqual([]);
  expect(await exactTitleMatches(db, T, KB, 'card')).toEqual([]);
});

test('NEGATIV KONTROL: en RÅ KILDE med samme titel returneres ikke', async () => {
  // Chatten svarer fra hjernen, aldrig fra råmaterialet.
  const r = await exactTitleMatches(db, T, KB, 'Christian Broberg');
  expect(r.map((x) => x.id)).not.toContain('kilde');
});

test('NEGATIV KONTROL: arkiveret og anden videnbase holdes ude', async () => {
  const r = await exactTitleMatches(db, T, KB, 'cardmem');
  expect(r.map((x) => x.id)).toEqual(['cm']); // ikke 'arkiv', ikke 'anden-kb'
});

test('FLERE med samme titel returneres ALLE, nyeste først', async () => {
  // Der ER dubletter i drift — to Neuroner hed «Christian Broberg» i samme
  // base. At vælge én ville skjule den anden.
  await nyt('cb2', 'Christian Broberg', { tid: '2026-09-06' });
  const r = await exactTitleMatches(db, T, KB, 'Christian Broberg');
  expect(r.map((x) => x.id)).toEqual(['cb2', 'cb']);
});

test('tomt eller absurd langt opslag er ikke et navn', async () => {
  expect(await exactTitleMatches(db, T, KB, '   ')).toEqual([]);
  expect(await exactTitleMatches(db, T, KB, 'x'.repeat(201))).toEqual([]);
});
