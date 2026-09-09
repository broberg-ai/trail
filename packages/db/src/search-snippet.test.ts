/**
 * F265.3 — søgetræffet skal være et UDDRAG, ikke hele dokumentet.
 *
 * Den målte fejl (9/9 2026, prod): svarets tekstfelt hed `highlight` og VAR
 * hele dokumentet. 5.685 tegn i svaret mod 5.659 tegn i dokumentet — kun
 * <mark>-tags til forskel. SQLites highlight() returnerer hele kolonnen;
 * snippet() giver et uddrag.
 *
 * Prisen betalte agenterne: ~3.770 tokens for ét opslag med limit=5, og på en
 * naturlig forespørgsel var nul af de fem relevante.
 *
 * Prøven hævder på STØRRELSEN, ikke på at der kom noget tilbage — et felt der
 * findes beviser ingenting om hvor stort det er, og det var netop dét ingen
 * kiggede på i månedsvis.
 */
import { expect, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { runMigrationsByHash } from './migrate-runner.js';
import { initFTS } from './fts.js';
import { searchDocuments } from './search.js';

const MIGRATIONS = resolve(import.meta.dir, '../drizzle');

// Et LANGT dokument med det søgte ord midt i. Fyldet er almindelige ord, så
// selve matchet er det eneste distinkte — som i et rigtigt korpus.
const FYLD = 'indledende afsnit uden relevans for spoergsmaalet. '.repeat(60);
const LANGT = `${FYLD}her staar ordet jaervsporet midt i teksten. ${FYLD}`;
const KORT = 'kort neuron der naevner jaervsporet og ikke andet.';

async function opsæt(dbFile: string) {
  const client = createClient({ url: `file:${dbFile}` });
  await client.execute('PRAGMA foreign_keys = ON');
  await runMigrationsByHash(client, MIGRATIONS);
  await initFTS(client);
  await client.execute("INSERT INTO tenants (id, slug, name) VALUES ('t1','t1','T1')");
  await client.execute("INSERT INTO users (id, tenant_id, email) VALUES ('u1','t1','a@b.c')");
  await client.execute(
    "INSERT INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES ('k1','t1','k1','K1','u1')",
  );
  return client;
}

test('F265.3 et LANGT dokument returneres som et UDDRAG, ikke helt', async () => {
  const dbFile = resolve(import.meta.dir, `../.tmp-snippet-${process.pid}.db`);
  const client = await opsæt(dbFile);
  try {
    await client.execute({
      sql: "INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path, title, content) VALUES ('d1','t1','k1','u1','wiki','d1.md','md','/neurons/','Lang neuron',?)",
      args: [LANGT],
    });

    const hits = await searchDocuments(client, 'jaervsporet', 'k1', 't1', 5);
    expect(hits.length).toBe(1);
    const h = hits[0]!.highlight;

    // DEN BÆRENDE HÆVDELSE: størrelsen. Dokumentet er >2000 tegn; uddraget
    // skal være markant mindre. Med highlight() var de to praktisk talt ens.
    expect(LANGT.length).toBeGreaterThan(2000);
    expect(h.length).toBeLessThan(600);

    // Og uddraget skal stadig BÆRE træffet. Et kortere svar der har mistet det
    // matchede ord er ikke en forbedring — det er en anden fejl.
    expect(h).toContain('<mark>');
    expect(h.toLowerCase()).toContain('jaervsporet');
  } finally {
    await client.close();
    for (const s of ['', '-wal', '-shm']) rmSync(`${dbFile}${s}`, { force: true });
  }
});

test('F265.3 NEGATIV KONTROL: et KORT dokument afkortes ikke', async () => {
  // Uden den her ville «returnér altid noget kort» bestå — også en udgave der
  // klipper hvert svar til 100 tegn uanset hvad. snippet() skal give hele
  // teksten når den er kortere end vinduet.
  const dbFile = resolve(import.meta.dir, `../.tmp-snippet-kort-${process.pid}.db`);
  const client = await opsæt(dbFile);
  try {
    await client.execute({
      sql: "INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path, title, content) VALUES ('d2','t1','k1','u1','wiki','d2.md','md','/neurons/','Kort neuron',?)",
      args: [KORT],
    });

    const hits = await searchDocuments(client, 'jaervsporet', 'k1', 't1', 5);
    expect(hits.length).toBe(1);
    const h = hits[0]!.highlight.replace(/<\/?mark>/g, '').replace(/…/g, '');

    // Hele den korte tekst skal være der — ordret, ikke bare «indeholder ordet».
    expect(h.trim()).toBe(KORT);
  } finally {
    await client.close();
    for (const s of ['', '-wal', '-shm']) rmSync(`${dbFile}${s}`, { force: true });
  }
});
