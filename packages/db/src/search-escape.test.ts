/**
 * F265.7 — et søgeuddrag renderes som HTML, så dokumentets eget indhold må
 * ikke kunne bære tags med ud.
 *
 * Den målte fejl (9/9 2026): `snippet()` escaper intet. En probe mod en rigtig
 * database gav uddraget ORDRET —
 *
 *   "noget tekst <img src=x onerror=\"alert(1)\"> og ordet <mark>…</mark> …"
 *
 * — og admin sætter netop det felt ind med `dangerouslySetInnerHTML`. Altså
 * lagret XSS i en indlogget administrators browser, via ethvert dokument der
 * indeholder HTML. Web Clipperen henter vilkårlige sider fra nettet, så det er
 * ikke en konstrueret situation; det er produktets funktion.
 *
 * Prøverne hævder på BEGGE halvdele, og det er med vilje: «alt escapes» kan
 * bestås af en udgave der også dræber vores egen markering, og «markeringen
 * virker» kan bestås af den nuværende, farlige kode. Kun sammen udelukker de
 * hinandens fejlvej.
 */
import { expect, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { runMigrationsByHash } from './migrate-runner.js';
import { initFTS } from './fts.js';
import { searchDocuments, searchChunks, sikkertUddrag } from './search.js';

const MIGRATIONS = resolve(import.meta.dir, '../drizzle');

const ONDT = 'indledning <img src=x onerror="alert(1)"> og ordet jaervsporet her, og lidt mere tekst.';

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

function ryd(dbFile: string) {
  for (const s of ['', '-wal', '-shm']) rmSync(`${dbFile}${s}`, { force: true });
}

test('F265.7 dokument-stien: HTML fra kilden bliver TEKST, og markeringen overlever', async () => {
  const dbFile = resolve(import.meta.dir, `../.tmp-escape-doc-${process.pid}.db`);
  const client = await opsæt(dbFile);
  try {
    await client.execute({
      sql: "INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path, title, content) VALUES ('d1','t1','k1','u1','wiki','d1.md','md','/neurons/','Ondt dokument',?)",
      args: [ONDT],
    });

    const hits = await searchDocuments(client, 'jaervsporet', 'k1', 't1', 5);
    expect(hits.length).toBe(1);
    const h = hits[0]!.highlight;

    // DEN BÆRENDE HÆVDELSE: ingen tag fra dokumentet overlever som tag.
    expect(h).not.toContain('<img');
    expect(h).not.toContain('onerror="');
    // Teksten er der stadig — vi escaper, vi sletter ikke.
    expect(h).toContain('&lt;img');

    // OG DEN ANDEN HALVDEL: vores egen markering ER stadig et rigtigt tag.
    // Uden den ville «escape alt» bestå, og træffet ville holde op med at
    // være fremhævet i UI'et — en sikkerhedsrettelse der tømmer skærmen.
    expect(h).toContain('<mark>jaervsporet</mark>');
  } finally {
    await client.close();
    ryd(dbFile);
  }
});

test('F265.7 stump-stien: samme regel gælder chunks_fts', async () => {
  // To SQL-steder, to prøver. Rettes kun det ene, er den anden vej stadig
  // åben — og stump-træf er præcis dem F265.5 lige har gjort synlige.
  const dbFile = resolve(import.meta.dir, `../.tmp-escape-chunk-${process.pid}.db`);
  const client = await opsæt(dbFile);
  try {
    await client.execute({
      sql: "INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path, title, content) VALUES ('d1','t1','k1','u1','wiki','d1.md','md','/neurons/','Ondt dokument',?)",
      args: [ONDT],
    });
    await client.execute({
      sql: "INSERT INTO document_chunks (id, tenant_id, knowledge_base_id, document_id, chunk_index, content, token_count) VALUES ('c1','t1','k1','d1',0,?,20)",
      args: [ONDT],
    });

    const hits = await searchChunks(client, 'jaervsporet', 'k1', 't1', 5);
    expect(hits.length).toBe(1);
    const h = hits[0]!.highlight;

    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img');
    expect(h).toContain('<mark>jaervsporet</mark>');
  } finally {
    await client.close();
    ryd(dbFile);
  }
});

test('F265.7 sentinel-omvejen er BUNDET: det værste et dokument kan indsprøjte er et inert <mark>', () => {
  // Sentinel'en byttes til rigtige tags EFTER escapingen, så alt hvad
  // dokumentet selv kan skrive på den plads, slipper udenom. Kontroltegn kan
  // ikke stå i et almindeligt tekstdokument, men «kan ikke» er en påstand og
  // ikke et bevis — så her måles hvad der SKER hvis et alligevel gør.
  //
  // Svaret, og det er grunden til at valget holder: det eneste en angriber kan
  // få ud af omvejen er <mark>, som ikke kan køre noget. Et vilkårligt tag kan
  // de ikke få, for < og > escapes før byttet.
  const medSentinel = 'tekst \u0001x\u0002 og \u0001y\u0002 og <script>alert(1)</script>';
  const ud = sikkertUddrag(medSentinel);

  expect(ud).toContain('<mark>'); // omvejen VIRKER — det er ikke skjult
  expect(ud).not.toContain('<script'); // men den giver kun mark, aldrig script
  expect(ud).toContain('&lt;script&gt;');
});

test('F265.7 negativ kontrol: et harmløst uddrag ændres ikke ud over sin markering', () => {
  // Uden den ville «escape alt aggressivt» bestå hele resten af filen, også en
  // udgave der ødelagde almindelig tekst med tegnsætning i.
  expect(sikkertUddrag('helt almindelig tekst uden noget')).toBe(
    'helt almindelig tekst uden noget',
  );
  expect(sikkertUddrag('\u0001match\u0002 midt i')).toBe('<mark>match</mark> midt i');
});

test('F265.7 ANDEN DØR: vektor-vejens uddrag klippes FØR det escapes', () => {
  // Motorens routes/search.ts bygger sit eget uddrag af rå stykke-indhold og
  // lander i SAMME felt som snippet()-vejen. Rækkefølgen er ikke ligegyldig:
  // escapes der FØR klipningen, kan de 300 tegn skære en HTML-entitet midt
  // over («&am») og efterlade noget der hverken er tekst eller tag.
  //
  // Prøven pinner rækkefølgen ved at lægge et & præcis i klippekanten.
  const råt = `${'x'.repeat(299)}&<img src=q onerror=y>`;
  const klippet = råt.length > 300 ? `${råt.slice(0, 300)}…` : råt;
  const ud = sikkertUddrag(klippet);

  expect(ud.endsWith('&amp;…')).toBe(true); // hel entitet, ikke en halv
  expect(ud).not.toContain('<img'); // og resten nåede aldrig med
});

test('F265.7 en tekst UDEN sentinel får ingen markering — vektor-vejens normaltilfælde', () => {
  // Vektor-uddraget har ingen match-markering (der er intet ord at markere,
  // træffet er semantisk). Escaperen må derfor ikke opfinde et <mark>.
  const ud = sikkertUddrag('helt almindeligt stykke med <b>tags</b> i.');
  expect(ud).not.toContain('<mark>');
  expect(ud).toBe('helt almindeligt stykke med &lt;b&gt;tags&lt;/b&gt; i.');
});
