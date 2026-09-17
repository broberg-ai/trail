/**
 * F275.5 — afløsningen skal forplante sig.
 *
 * DEN MÅLTE SAG, 15./16. september: fem sider sagde «bygges nu» after kilden
 * sagde «lanceret» — overview.md, glossary.md, flagskib.md, source-Neuronen og
 * entitets-Neuronen. Kun ÉN af dem bærer kildens URL som sin egen identitet.
 * Opsætningen herunder er netop den form.
 */
import { test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  createLibsqlDatabase, tenants, users, knowledgeBases, documents, documentReferences,
} from '@trail/db';
import { eq } from 'drizzle-orm';
import { dependentsOf, markDependents, clearSourceMark } from './source-propagation.js';

const T = 't-fp', U = 'u-fp', KB = 'kb-fp';
const URL_A = 'url:https://broberg.ai/flagskibe/bid';
const URL_B = 'url:https://broberg.ai/andet';
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

async function source(id: string, identitet: string | null) {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/sources/', filename: `${id}.md`, content: 'kildetekst', fileType: 'md',
    sourceIdentity: identitet,
  }).run();
}

async function neuron(id: string, identitet: string | null) {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/', filename: `${id}.md`, title: id, content: 'sidetekst', fileType: 'md',
    sourceIdentity: identitet,
  }).run();
}

/** En citat-kant — dét led ingen anden mekanisme finder. */
async function citerer(neuronId: string, kildeId: string) {
  await trail.db.insert(documentReferences).values({
    id: `r-${neuronId}-${kildeId}`, tenantId: T, knowledgeBaseId: KB,
    wikiDocumentId: neuronId, sourceDocumentId: kildeId, claimAnchor: `c-${neuronId}`,
  }).run();
}

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `fp-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'fp', name: 'Fp', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f@p.dk', displayName: 'F', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Fp', slug: KB, language: 'da' }).run();
});

test('AC#0 DEN MÅLTE SAG: alle fem sider findes — ikke kun den der bærer kildens identitet', async () => {
  await source('source-bid', URL_A);
  await neuron('bid', URL_A);              // kompileret AF kilden
  await neuron('entitet', URL_A);          // ligeså
  for (const n of ['overview', 'glossary', 'flagskib']) {
    await neuron(n, null);                 // egen identitet er IKKE kildens URL
    await citerer(n, 'source-bid');
  }

  // 'bid' er den der netop blev kompileret om — den er ajour og undtages.
  const fundne = await dependentsOf(trail, T, KB, URL_A, 'bid');
  expect(fundne.map((f) => f.documentId).sort()).toEqual(['entitet', 'flagskib', 'glossary', 'overview']);
  expect(fundne.find((f) => f.documentId === 'entitet')?.link).toBe('compiled-from');
  expect(fundne.find((f) => f.documentId === 'overview')?.link).toBe('cites');
});

test('AC#3 AFHÆNGIGHEDEN SLÅS OP — en side der bare NÆVNER de samme ord røres ikke', async () => {
  await source('source-bid', URL_A);
  await neuron('bid', URL_A);
  await neuron('tilfaeldig', null);   // ingen identitet, ingen citat-kant
  await neuron('anden-source', URL_B); // anden source
  expect(await dependentsOf(trail, T, KB, URL_A, 'bid')).toEqual([]);
});

test('AC#3 — INGEN identitet trækker ikke tilfældige sider med', async () => {
  // «Vi ved ikke hvilken source det er» må aldrig matche en anden ukendt. Ellers
  // ville en enkelt genkompilering markere hele den ikke-backfill'ede base.
  await neuron('uden-1', null);
  await neuron('uden-2', null);
  expect(await dependentsOf(trail, T, KB, null)).toEqual([]);

  // Og en TOM streng i kolonnen må ikke kunne matche et tomt opslag. Uden den
  // her bestod prøven med spærren fjernet — fordi SQL alligevel ikke matcher
  // noget når ingen række er tom. Så beviste den, at der ikke fandtes sådan en
  // række, ikke at spærren virkede. Målt: mutationen var GRØN før denne linje.
  await source('source-tom', '');
  await neuron('tom', '');
  await citerer('tom', 'source-tom');
  expect(await dependentsOf(trail, T, KB, '')).toEqual([]);
});

test('arkiverede sider meldes ikke — de svarer ikke på noget', async () => {
  await source('source-bid', URL_A);
  await neuron('arkiveret', URL_A);
  await trail.db.update(documents).set({ archived: true }).where(eq(documents.id, 'arkiveret')).run();
  expect(await dependentsOf(trail, T, KB, URL_A)).toEqual([]);
});

test('en side der BÅDE er kompileret af kilden og citerer den tælles ÉN gang', async () => {
  await source('source-bid', URL_A);
  await neuron('begge', URL_A);
  await citerer('begge', 'source-bid');
  const f = await dependentsOf(trail, T, KB, URL_A);
  expect(f.length).toBe(1);
  // Den stærkere kobling vinder, så beskeden til kuratoren er den rigtige.
  expect(f[0]!.link).toBe('compiled-from');
});

test('flere UDGAVER af samme source: en citat-kant til den GAMLE række tæller med', async () => {
  // Hver upload er sin egen række. Slog vi kun op på den nyeste, ville sider der
  // citerer den forrige udgave forsvinde — altså præcis de ældste og mest
  // forældede sider, som er dem der betyder mest.
  await source('source-v1', URL_A);
  await source('source-v2', URL_A);
  await neuron('overview', null);
  await citerer('overview', 'source-v1');
  expect((await dependentsOf(trail, T, KB, URL_A)).map((f) => f.documentId)).toEqual(['overview']);
});

test('MÆRKET skrives og LÆSES TILBAGE — antallet er målt, ikke antaget', async () => {
  await source('source-bid', URL_A);
  await neuron('overview', null);
  await citerer('overview', 'source-bid');
  const nu = Date.now();
  const afh = await dependentsOf(trail, T, KB, URL_A);
  expect(await markDependents(trail, afh, nu)).toBe(1);
  const raekke = await trail.db
    .select({ t: documents.sourceChangedAt }).from(documents).where(eq(documents.id, 'overview')).get();
  expect(raekke!.t).toBe(nu);
});

test('mærket RYDDES når siden selv skrives om — ellers melder den sig bagefter for evigt', async () => {
  await neuron('overview', null);
  await trail.db.update(documents).set({ sourceChangedAt: 123 }).where(eq(documents.id, 'overview')).run();
  await clearSourceMark(trail, 'overview');
  const r = await trail.db
    .select({ t: documents.sourceChangedAt }).from(documents).where(eq(documents.id, 'overview')).get();
  expect(r!.t).toBeNull();
});

test('tom liste mærker intet og påstår intet', async () => {
  expect(await markDependents(trail, [], Date.now())).toBe(0);
});
