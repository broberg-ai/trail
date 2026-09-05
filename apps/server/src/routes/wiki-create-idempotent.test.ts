/**
 * F252 — én kilde-fil har ÉN side. Mod RIGTIG SQL, ikke mod en stub.
 *
 * Fejlen: `approveCreate` indsatte altid en ny række. Når broberg-ai-sitets
 * synkronisering gen-uploadede en artikel, landede kilden i køen igen, og hver
 * kompilering skrev en frisk side ved siden af den forrige. Målt 5/9 2026:
 * 39 kilde-filer som 90 sider, aidan-historien 5×.
 *
 * Og dubletterne var IKKE ens — skrevet af forskellige kørsler, af en model, på
 * forskellige tidspunkter. En søgning kunne give tre forskellige svar på samme
 * spørgsmål uden at nogen kunne se hvilket der var nyest.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  createLibsqlDatabase, tenants, users, knowledgeBases, documents,
  type TrailDatabase,
} from '@trail/db';
import { and, eq, sql } from 'drizzle-orm';
import { createCandidate } from '@trail/core';

const T = { tenant: 't-dup', user: 'u-dup', kb: 'kb-dup' };
let trail!: TrailDatabase;
const dbPath = join(process.env.TMPDIR ?? '/tmp', `wikidup-${process.pid}.db`);

/** Skriv en kilde-side præcis som en kompilering gør: create + auto-approve. */
async function compileSourcePage(title: string, content: string) {
  const { candidate, approval } = await createCandidate(
    trail,
    T.tenant,
    {
      knowledgeBaseId: T.kb,
      kind: 'ingest-summary',
      title,
      content,
      metadata: JSON.stringify({ op: 'create', filename: 'kilde.md', path: '/neurons/sources/' }),
      confidence: 1,
    },
    { kind: 'llm', id: T.user },
  );
  // confidence 1 auto-approver, så materialiseringen sker her og nu. Kræves
  // eksplicit: uden approval ville testen måle en kandidat der aldrig blev til
  // en side, og «ingen dublet» ville bestå fordi der slet ikke blev skrevet.
  if (!approval) throw new Error(`kandidat ${candidate.id} blev ikke auto-approved`);
  return approval;
}

async function sourcePages() {
  const rows = await trail.db
    .select({ id: documents.id, version: documents.version, content: documents.content })
    .from(documents)
    .where(and(
      eq(documents.tenantId, T.tenant),
      eq(documents.path, '/neurons/sources/'),
      eq(documents.filename, 'kilde.md'),
      eq(documents.archived, false),
    ))
    .all();
  return rows;
}

beforeAll(async () => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* fresh */ }
  }
  trail = await createLibsqlDatabase({ path: dbPath });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T.tenant, slug: T.tenant, name: T.tenant, plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: T.user, tenantId: T.tenant, email: 'u@test.local' }).run();
  await trail.db.insert(knowledgeBases).values({
    id: T.kb, tenantId: T.tenant, createdBy: T.user, slug: T.kb, name: T.kb,
  }).run();
});

afterAll(async () => {
  await trail.close?.();
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* fine */ }
  }
});

test('samme kilde-fil kompileret TO gange giver ÉN side, ikke to', async () => {
  await compileSourcePage('Kilde', '# Kilde\n\nFørste kørsel.\n');
  expect((await sourcePages()).length).toBe(1);

  await compileSourcePage('Kilde', '# Kilde\n\nAnden kørsel.\n');
  // TÆLLER RÆKKER I DATABASEN — ikke svaret fra andet kald, som ville
  // rapportere sin egen hensigt frem for hvad der står.
  const rows = await sourcePages();
  expect(rows.length).toBe(1);
});

test('anden kørsel OPDATERER indholdet — den ignoreres ikke', async () => {
  // Negativ kontrol mod den nemme fejlrettelse: «opdatér frem for opret» kunne
  // implementeres som «spring anden kørsel over», og så ville en RETTET artikel
  // aldrig nå vidensbasen. Testen ovenfor ville stadig være grøn.
  const rows = await sourcePages();
  expect(rows.length).toBe(1);
  expect(rows[0]!.content).toContain('Anden kørsel');
  expect(rows[0]!.content).not.toContain('Første kørsel');
  // Versionen skal være steget, ellers kan historikken ikke vise omskrivningen.
  expect(rows[0]!.version).toBeGreaterThan(1);
});

test('to FORSKELLIGE filnavne giver stadig to sider', async () => {
  // Opslaget sker på filnavn, ikke på titel: den danske og den engelske udgave
  // af samme artikel har samme emne og skal netop have hver sin side.
  const { candidate, approval } = await createCandidate(
    trail, T.tenant,
    {
      knowledgeBaseId: T.kb, kind: 'ingest-summary', title: 'Kilde',
      content: '# Kilde\n\nEngelsk udgave.\n',
      metadata: JSON.stringify({ op: 'create', filename: 'kilde-en.md', path: '/neurons/sources/' }),
      confidence: 1,
    },
    { kind: 'llm', id: T.user },
  );
  if (!approval) throw new Error(`kandidat ${candidate.id} blev ikke auto-approved`);

  const all = await trail.db
    .select({ n: sql<number>`count(*)` })
    .from(documents)
    .where(and(
      eq(documents.tenantId, T.tenant),
      eq(documents.path, '/neurons/sources/'),
      eq(documents.archived, false),
    ))
    .get();
  expect(Number(all?.n ?? 0)).toBe(2);
});
