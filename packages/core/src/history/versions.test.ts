/**
 * F253.2 + F253.3 — mærket koster én række, og gendannelsen kan gendannes.
 *
 * Den bærende prøve er ikke «virker det»; det er «koster det ingenting», for
 * hele designet hviler på at et mærke er et BOGMÆRKE og ikke en kopi. Går den
 * antagelse i stykker, bliver et mærke pr. kompilering til gigabytes.
 */
import { test, expect } from 'bun:test';
import { createLibsqlDatabase } from '@trail/db';
import { join } from 'node:path';
import { rmSync, statSync } from 'node:fs';
import { takeBrainVersion, listBrainVersions, ensureRecentBrainVersion } from './versions.js';
import { diffBrainVersion, restoreBrainVersion } from './restore.js';
import { auditEventLogCoverage } from './coverage.js';

const T = 't-bv';
const KB = 'kb-bv';

async function seed() {
  const p = join(process.env.TMPDIR ?? '/tmp', `bv-${process.pid}-${Math.random()}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  const trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.initFTS();
  await trail.execute(`INSERT INTO tenants (id, slug, name, plan) VALUES (?,?,?,?)`, [T, 'bv', 'BV', 'hobby']);
  await trail.execute(`INSERT INTO users (id, tenant_id, email, display_name, role, onboarded) VALUES (?,?,?,?,?,1)`,
    ['u-bv', T, 'bv@local.trail', 'B', 'owner']);
  await trail.execute(`INSERT INTO knowledge_bases (id, tenant_id, created_by, name, slug, language) VALUES (?,?,?,?,?,?)`,
    [KB, T, 'u-bv', 'bv', 'bv', 'da']);
  return { trail, path: p };
}

/** Skriv en Neuron som appen gør: indhold + hændelse med fuld kopi. */
async function write(trail: any, id: string, text: string, version: number, when?: string) {
  const exists = (await trail.execute(`SELECT id FROM documents WHERE id = ?`, [id])).rows[0];
  if (!exists) {
    await trail.execute(
      `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, path, file_type, file_size, content, version, archived)
       VALUES (?,?,?,?,'wiki',?,'/neurons/',?,?,?,?,0)`,
      [id, T, KB, 'u-bv', `${id}.md`, 'md', text.length, text, version]);
  } else {
    await trail.execute(`UPDATE documents SET content = ?, version = ?, archived = 0 WHERE id = ?`, [text, version, id]);
  }
  await trail.execute(
    `INSERT INTO wiki_events (id, tenant_id, document_id, event_type, actor_kind, previous_version, new_version, content_snapshot${when ? ', created_at' : ''})
     VALUES (?,?,?,?,'llm',?,?,?${when ? ',?' : ''})`,
    [`evt-${id}-${version}-${Math.random().toString(36).slice(2, 7)}`, T, id,
     version === 1 ? 'created' : 'edited', version === 1 ? null : version - 1, version, text,
     ...(when ? [when] : [])]);
}

const wait = () => new Promise((r) => setTimeout(r, 1100)); // datetime('now') har sekund-opløsning

test('et mærke koster ÉN række og kopierer INTET indhold', async () => {
  const { trail, path } = await seed();
  // 30 Neuroner à 20 KB = ~600 KB indhold. Kopierede et mærke dem, ville 10
  // mærker koste ~6 MB. Det er præcis den antagelse der skal falsificeres.
  for (let i = 0; i < 30; i += 1) await write(trail, `n${i}`, 'x'.repeat(20_000), 1);
  await trail.execute(`PRAGMA wal_checkpoint(TRUNCATE)`);
  const før = statSync(path).size;

  for (let i = 0; i < 10; i += 1)
    await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: `mærke ${i}` });

  await trail.execute(`PRAGMA wal_checkpoint(TRUNCATE)`);
  const efter = statSync(path).size;
  const vokst = efter - før;

  expect((await listBrainVersions(trail, T, KB)).length).toBe(10);
  // 10 mærker over 600 KB indhold må ikke koste mere end 10 KB.
  expect(vokst).toBeLessThan(10_000);
});

test('mærket bærer et HÆNDELSES-id, ikke kun et tidsstempel', async () => {
  const { trail } = await seed();
  await write(trail, 'n1', 'tekst', 1);
  const v = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'm' });
  expect(v.highWaterEventId).toBeTruthy();
  // To hændelser kan lande i samme sekund; tid alene er ikke en nøgle.
  const ev = (await trail.execute(`SELECT id FROM wiki_events ORDER BY rowid DESC LIMIT 1`)).rows[0] as any;
  expect(v.highWaterEventId).toBe(ev.id);
});

test('mærket lukker revner FØR grænsen sættes — og siger det hvis det ikke kunne', async () => {
  const { trail } = await seed();
  await write(trail, 'n1', 'oprindelig', 1);
  await trail.execute(`UPDATE documents SET content = 'skrevet udenom loggen' WHERE id = 'n1'`);
  expect((await auditEventLogCoverage(trail, T, KB)).intact).toBe(false);

  const v = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'm' });
  expect(v.coverageIntact).toBe(true);
  expect(v.coverageGaps).toBe(0);
  expect((await auditEventLogCoverage(trail, T, KB)).intact).toBe(true);

  // Negativ kontrol: uden reparation SKAL mærket bære sandheden om sig selv.
  await trail.execute(`UPDATE documents SET content = 'igen udenom' WHERE id = 'n1'`);
  const v2 = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'm2', repair: false });
  expect(v2.coverageIntact).toBe(false);
  expect(v2.coverageGaps).toBe(1);
});

test('mærker er pr. videnbase — et mærke i én KB er usynligt i en anden', async () => {
  const { trail } = await seed();
  await trail.execute(`INSERT INTO knowledge_bases (id, tenant_id, created_by, name, slug, language) VALUES (?,?,?,?,?,?)`,
    ['kb-anden', T, 'u-bv', 'anden', 'anden', 'da']);
  await write(trail, 'n1', 'tekst', 1);
  await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'kun her' });

  expect((await listBrainVersions(trail, T, KB)).length).toBe(1);
  expect((await listBrainVersions(trail, T, 'kb-anden')).length).toBe(0);
});

test('forskellen skelner de TRE tilstande, og de summer til antallet af ændringer', async () => {
  const { trail } = await seed();
  await write(trail, 'bliver-ændret', 'før', 1);
  await write(trail, 'bliver-arkiveret', 'lever', 1);
  await write(trail, 'rører-sig-ikke', 'stille', 1);
  await wait();
  const v = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'mærket' });
  await wait();

  await write(trail, 'bliver-ændret', 'efter', 2);
  await trail.execute(`UPDATE documents SET archived = 1 WHERE id = 'bliver-arkiveret'`);
  await write(trail, 'opstod-bagefter', 'ny side', 1);

  const d = await diffBrainVersion(trail, T, v.id);
  expect(d.revert).toBe(1);     // bliver-ændret
  expect(d.unarchive).toBe(1);  // bliver-arkiveret var aktiv ved mærket
  expect(d.archive).toBe(1);    // opstod-bagefter fandtes ikke
  expect(d.unchanged).toBe(1);  // rører-sig-ikke
  expect(d.changes.length).toBe(d.revert + d.archive + d.unarchive);
});

test('forskellen ÆNDRER INTET — begge tabeller er byte-identiske bagefter', async () => {
  const { trail } = await seed();
  await write(trail, 'n1', 'før', 1);
  await wait();
  const v = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'm' });
  await wait();
  await write(trail, 'n1', 'efter', 2);

  const snap = async () => JSON.stringify([
    (await trail.execute(`SELECT id, content, version, archived FROM documents ORDER BY id`)).rows,
    (await trail.execute(`SELECT id, new_version, content_snapshot FROM wiki_events ORDER BY id`)).rows,
  ]);
  const før = await snap();
  await diffBrainVersion(trail, T, v.id);
  expect(await snap()).toBe(før);
});

test('en gendannelse kan gendannes — indholdet ved B er STRENGT identisk efter A→B', async () => {
  const { trail } = await seed();
  await write(trail, 'n1', 'tilstand A', 1);
  await wait();
  const a = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'A' });
  await wait();
  await write(trail, 'n1', 'tilstand B', 2);
  await wait();
  const b = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'B' });

  await restoreBrainVersion(trail, T, a.id);
  const efterA = (await trail.execute(`SELECT content FROM documents WHERE id='n1'`)).rows[0] as any;
  expect(efterA.content).toBe('tilstand A'); // streng lighed, ikke "indeholder"

  await restoreBrainVersion(trail, T, b.id);
  const efterB = (await trail.execute(`SELECT content FROM documents WHERE id='n1'`)).rows[0] as any;
  expect(efterB.content).toBe('tilstand B');
});

test('en uændret side skrives IKKE og får INGEN hændelse', async () => {
  const { trail } = await seed();
  await write(trail, 'rører-sig-ikke', 'stille', 1);
  await write(trail, 'ændres', 'før', 1);
  await wait();
  const v = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'm' });
  await wait();
  await write(trail, 'ændres', 'efter', 2);

  const før = (await trail.execute(
    `SELECT COUNT(*) n FROM wiki_events WHERE document_id='rører-sig-ikke'`)).rows[0] as any;
  await restoreBrainVersion(trail, T, v.id);
  const efter = (await trail.execute(
    `SELECT COUNT(*) n FROM wiki_events WHERE document_id='rører-sig-ikke'`)).rows[0] as any;
  expect(Number(efter.n)).toBe(Number(før.n));
});

test('gendannelsen efterlader loggen INTAKT — og tager et sikkerheds-mærke først', async () => {
  const { trail } = await seed();
  await write(trail, 'n1', 'A', 1);
  await wait();
  const v = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'A' });
  await wait();
  await write(trail, 'n1', 'B', 2);

  const r = await restoreBrainVersion(trail, T, v.id);
  expect(r.safetyVersionId).toBeTruthy();
  expect((await auditEventLogCoverage(trail, T, KB)).intact).toBe(true);

  // Sikkerheds-mærket skal bære tilstanden FØR rulningen, altså 'B'.
  const tilbage = await restoreBrainVersion(trail, T, r.safetyVersionId);
  expect(tilbage.applied).toBeGreaterThan(0);
  const nu = (await trail.execute(`SELECT content FROM documents WHERE id='n1'`)).rows[0] as any;
  expect(nu.content).toBe('B');
});

test('et mærke over en log med revner AFVISES — ikke en halv rulning der ser hel ud', async () => {
  const { trail } = await seed();
  await write(trail, 'n1', 'A', 1);
  await trail.execute(`UPDATE documents SET content = 'udenom' WHERE id = 'n1'`);
  const v = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'ufuldstændig', repair: false });
  expect(v.coverageIntact).toBe(false);

  await expect(restoreBrainVersion(trail, T, v.id)).rejects.toThrow(/revne/);
});

test('søgeindekset meldes STALE hvis kalderen ikke bygger det om', async () => {
  const { trail } = await seed();
  await write(trail, 'n1', 'A', 1);
  await wait();
  const v = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'A' });
  await wait();
  await write(trail, 'n1', 'B', 2);

  const uden = await restoreBrainVersion(trail, T, v.id);
  expect(uden.chunksRebuilt).toBe(0);
  expect(uden.searchIndexStale).toBe(true); // et tavst forældet indeks er den fejl feltet findes for

  await wait();
  await write(trail, 'n1', 'C', 3);
  const rørt: string[] = [];
  const med = await restoreBrainVersion(trail, T, v.id, {
    rebuildChunks: async (id) => { rørt.push(id); },
  });
  expect(med.chunksRebuilt).toBe(rørt.length);
  expect(med.searchIndexStale).toBe(false);
});

test('en byge af skrivninger giver ÉT mærke, ikke ét pr. skrivning', async () => {
  const { trail } = await seed();
  await write(trail, 'n1', 'tekst', 1);

  // 20 skrivninger i træk, som en site-synkronisering af 20 artikler.
  const created: boolean[] = [];
  for (let i = 0; i < 20; i += 1) {
    const r = await ensureRecentBrainVersion(trail, {
      tenantId: T, knowledgeBaseId: KB, label: `skrivning ${i}`, reason: 'auto:ingest',
    });
    created.push(r.created);
  }

  expect(created.filter(Boolean).length).toBe(1);      // kun den FØRSTE tog et mærke
  expect(created[0]).toBe(true);
  expect((await listBrainVersions(trail, T, KB)).length).toBe(1);
});

test('afdæmpningen gælder PR. GRUND — en lint-kørsel skygges ikke af en ingest', async () => {
  // Ellers ville en ingest-byge sluge det mærke en lint-kørsel skulle have haft,
  // og der ville ikke være noget at rulle tilbage til fra før linten.
  const { trail } = await seed();
  await write(trail, 'n1', 'tekst', 1);

  const a = await ensureRecentBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'ingest', reason: 'auto:ingest' });
  const b = await ensureRecentBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'lint', reason: 'auto:lint' });

  expect(a.created).toBe(true);
  expect(b.created).toBe(true);
  expect((await listBrainVersions(trail, T, KB)).length).toBe(2);
});

test('et manuelt mærke tages ALTID — afdæmpningen må ikke sluge en ejers eget', async () => {
  const { trail } = await seed();
  await write(trail, 'n1', 'tekst', 1);
  await ensureRecentBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'auto', reason: 'auto:ingest' });
  const m1 = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'før jeg roder' });
  const m2 = await takeBrainVersion(trail, { tenantId: T, knowledgeBaseId: KB, label: 'og en til' });

  expect(m1.id).not.toBe(m2.id);
  expect((await listBrainVersions(trail, T, KB)).length).toBe(3);
});
