/**
 * FTS5 setup — contentless virtual tables backed by `documents` and
 * `document_chunks` via rowid. Triggers keep the indices in sync on
 * INSERT / UPDATE / DELETE so searches always see fresh content with
 * no manual bookkeeping.
 *
 * F259.2 — DEN FORUDSIGELSE GIK I OPFYLDELSE, og den kostede en nedetid.
 *
 * Her stod: «Cheap on Phase 1 volumes; F40.2 can move to a only-rebuild-if-
 * changed path if boot cost becomes material.» Basen flyttede fra lokal disk
 * til en sqld-maskine på den anden side af netværket, og så blev den material:
 *
 *     [boot] sanne-andersen/fts:   9s     (små baser)
 *     [boot] fd-aalborg/fts:       2s
 *     [boot] broberg-ai/fts:     273s  →  timeout  →  processen dør
 *
 * DROP+CREATE+rebuild rev hele søgeindekset ned og byggede det op igen ved
 * HVER opstart, for HVER kunde, før serveren begyndte at lytte. 7.217 Neuroner
 * plus deres afsnit over netværket. Motoren nåede aldrig at åbne butikken.
 *
 * Nu genopbygges der kun når skemaet FAKTISK har ændret sig. Mellem to
 * opstarter holder triggerne indekset i takt — det er hele deres formål — så en
 * genopbygning på uændret skema var arbejde uden virkning.
 */
import { createHash } from 'node:crypto';
import type { Client as LibSqlClient } from '@libsql/client';

const DROP_ALL = `
  DROP TRIGGER IF EXISTS documents_ai;
  DROP TRIGGER IF EXISTS documents_au;
  DROP TRIGGER IF EXISTS documents_ad;
  DROP TRIGGER IF EXISTS chunks_ai;
  DROP TRIGGER IF EXISTS chunks_au;
  DROP TRIGGER IF EXISTS chunks_ad;
  DROP TABLE IF EXISTS documents_fts;
  DROP TABLE IF EXISTS chunks_fts;
`;

const CREATE_DOCUMENTS_FTS = `
  CREATE VIRTUAL TABLE documents_fts USING fts5(
    content, title, filename,
    content='documents',
    content_rowid='rowid',
    tokenize='porter unicode61'
  );
`;

const CREATE_CHUNKS_FTS = `
  CREATE VIRTUAL TABLE chunks_fts USING fts5(
    content, header_breadcrumb,
    content='document_chunks',
    content_rowid='rowid',
    tokenize='porter unicode61'
  );
`;

const DOCUMENTS_TRIGGERS = `
  CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, content, title, filename)
      VALUES (new.rowid, new.content, new.title, new.filename);
  END;
  CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, content, title, filename)
      VALUES ('delete', old.rowid, old.content, old.title, old.filename);
  END;
  CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, content, title, filename)
      VALUES ('delete', old.rowid, old.content, old.title, old.filename);
    INSERT INTO documents_fts(rowid, content, title, filename)
      VALUES (new.rowid, new.content, new.title, new.filename);
  END;
`;

const CHUNKS_TRIGGERS = `
  CREATE TRIGGER chunks_ai AFTER INSERT ON document_chunks BEGIN
    INSERT INTO chunks_fts(rowid, content, header_breadcrumb)
      VALUES (new.rowid, new.content, new.header_breadcrumb);
  END;
  CREATE TRIGGER chunks_ad AFTER DELETE ON document_chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content, header_breadcrumb)
      VALUES ('delete', old.rowid, old.content, old.header_breadcrumb);
  END;
  CREATE TRIGGER chunks_au AFTER UPDATE ON document_chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content, header_breadcrumb)
      VALUES ('delete', old.rowid, old.content, old.header_breadcrumb);
    INSERT INTO chunks_fts(rowid, content, header_breadcrumb)
      VALUES (new.rowid, new.content, new.header_breadcrumb);
  END;
`;

/**
 * Rebuild all FTS5 tables + triggers from scratch, then backfill from
 * existing rows. Safe on empty databases. Call once per boot.
 *
 * libSQL's `executeMultiple` handles statement-separated DDL in one
 * round-trip, which matters here because the triggers must land in
 * the same WAL checkpoint as the table creation or the first write
 * after boot could race.
 */
/**
 * Skemaets identitet. Ændres ét tegn i en tabel- eller trigger-definition,
 * ændres denne streng, og næste opstart genopbygger. Afledt af selve DDL'en
 * med vilje: et håndholdt versionsnummer bliver glemt præcis den gang det
 * betyder noget, og så serverer vi et indeks der ikke matcher sit skema.
 */
function skemaVersion(): string {
  return createHash('sha256')
    .update([CREATE_DOCUMENTS_FTS, CREATE_CHUNKS_FTS, DOCUMENTS_TRIGGERS, CHUNKS_TRIGGERS].join('\n'))
    .digest('hex')
    .slice(0, 16);
}

/** De otte objekter skemaet består af: to tabeller og seks triggere. */
const FTS_OBJEKTER = [
  'documents_fts',
  'chunks_fts',
  'documents_ai',
  'documents_au',
  'documents_ad',
  'chunks_ai',
  'chunks_au',
  'chunks_ad',
];

/** Sammenlign SQL uden at hænge på mellemrum og linjeskift. */
function normalisér(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
}

/** Findes BEGGE FTS-tabeller? En version-række alene beviser ingenting. */
async function tabellerFindes(client: LibSqlClient): Promise<boolean> {
  const r = await client.execute(
    `SELECT COUNT(*) AS n FROM sqlite_master
      WHERE type = 'table' AND name IN ('documents_fts', 'chunks_fts')`,
  );
  return Number((r.rows[0] as unknown as { n: number | bigint }).n) === 2;
}

/**
 * F259.3 — BÆRER BASEN ALLEREDE PRÆCIS DETTE SKEMA?
 *
 * Findes alle otte objekter, og er deres GEMTE SQL identisk med vores DDL, så
 * er indekset bygget af netop dette skema og holdt i takt af netop disse
 * triggere. Så er en genopbygning arbejde uden virkning, og vi kan nøjes med
 * at stemple versionen.
 *
 * Det er ikke en optimering — det er den eneste vej ud af en fælde vi selv
 * gravede: broberg-ais engangs-genopbygning tager 278s og rammer sqld's
 * timeout, så versionen blev aldrig skrevet, så næste opstart genopbyggede
 * igen. Et fix der kun virker EFTER en genopbygning der aldrig kan lykkes,
 * virker aldrig.
 *
 * Vi sammenligner med basens EGEN gemte SQL, ikke kun med vores egen tekst:
 * spørgsmålet er hvad databasen faktisk bærer, ikke hvad vi tror vi sendte.
 */
async function skemaErAlleredeKorrekt(client: LibSqlClient): Promise<boolean> {
  const r = await client.execute({
    sql: `SELECT name, sql FROM sqlite_master WHERE name IN (${FTS_OBJEKTER.map(() => '?').join(',')})`,
    args: FTS_OBJEKTER,
  });
  const fundet = new Map<string, string>();
  for (const row of r.rows as unknown as Array<{ name: string; sql: string | null }>) {
    if (row.sql) fundet.set(row.name, normalisér(row.sql));
  }
  if (fundet.size !== FTS_OBJEKTER.length) return false;

  const vores = new Map<string, string>();
  for (const blok of [CREATE_DOCUMENTS_FTS, CREATE_CHUNKS_FTS, DOCUMENTS_TRIGGERS, CHUNKS_TRIGGERS]) {
    for (const sætning of blok.split(/;\s*(?=CREATE|$)/)) {
      const m = /CREATE (?:VIRTUAL TABLE|TRIGGER)\s+(\w+)/i.exec(sætning);
      if (m) vores.set(m[1]!, normalisér(sætning));
    }
  }

  for (const navn of FTS_OBJEKTER) {
    if (fundet.get(navn) !== vores.get(navn)) return false;
  }
  return true;
}

export async function initFTS(client: LibSqlClient): Promise<void> {
  const ønsket = skemaVersion();
  await client.execute(
    `CREATE TABLE IF NOT EXISTS fts_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version TEXT NOT NULL)`,
  );

  // TRAIL_FTS_REBUILD=1 tvinger en genopbygning. Findes fordi triggerne kun
  // holder indekset i takt for skrivninger der GÅR gennem dem: en gendannelse
  // fra et snapshot eller en rå tabel-kopi omgår dem, og så er indekset
  // forældet uden at skemaet har ændret sig.
  const tvunget = process.env.TRAIL_FTS_REBUILD === '1';

  if (!tvunget) {
    const nu = (await client.execute(`SELECT version FROM fts_schema WHERE id = 1`)).rows[0] as
      | unknown as { version: string } | undefined;
    // BEGGE betingelser. En version-række uden tabeller ville ellers springe
    // opbygningen over og efterlade en base hvor enhver søgning fejler.
    if (nu?.version === ønsket && (await tabellerFindes(client))) return;

    // Intet stempel, men basen bærer allerede præcis dette skema — overtag
    // det i stedet for at bygge det forfra.
    if (await skemaErAlleredeKorrekt(client)) {
      await stemplVersion(client, ønsket);
      return;
    }
  }

  await client.executeMultiple(DROP_ALL);
  await client.execute(CREATE_DOCUMENTS_FTS);
  await client.execute(CREATE_CHUNKS_FTS);
  await client.executeMultiple(DOCUMENTS_TRIGGERS);
  await client.executeMultiple(CHUNKS_TRIGGERS);
  await client.execute(`INSERT INTO documents_fts(documents_fts) VALUES('rebuild');`);
  await client.execute(`INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');`);
  await stemplVersion(client, ønsket);
}

async function stemplVersion(client: LibSqlClient, version: string): Promise<void> {
  await client.execute({
    sql: `INSERT INTO fts_schema (id, version) VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET version = excluded.version`,
    args: [version],
  });
}
