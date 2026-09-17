/**
 * F275.1 — backfill af NEURON-siden.
 *
 * Målt 17/9 i broberg.ai: 66 af 66 kilder bar en identitet, og 0 af 247
 * Neuroner gjorde. Featuren var altså inert for hele den eksisterende base —
 * og det så præcis ud som om den virkede, fordi den sikre standard gjorde det
 * harmløst.
 */
import { test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  createLibsqlDatabase, tenants, users, knowledgeBases, documents, documentReferences, apiKeys,
} from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-nib', U = 'u-nib', KB = 'kb-nib';
const NØGLE = 'trail_' + 'b'.repeat(64);
const URL_A = 'url:https://broberg.ai/a';
const URL_B = 'url:https://broberg.ai/b';
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

type Svar = { neuroner: number; foer: number; fik: number; havdeAllerede: number; ingenKilde: number; flereKilder: number; efter: number; applied: boolean };

async function backfill(apply: boolean): Promise<Svar> {
  const res = await app.request('http://engine.local/api/v1/maintenance/backfill-neuron-identity', {
    method: 'POST',
    headers: { Authorization: `Bearer ${NØGLE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ apply }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Svar;
}

async function kilde(id: string, identitet: string | null) {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/sources/', filename: `${id}.md`, content: 'x', fileType: 'md', sourceIdentity: identitet,
  }).run();
}
async function neuron(id: string) {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/', filename: `${id}.md`, title: id, content: 'x', fileType: 'md',
  }).run();
}
async function citerer(n: string, k: string, anker = 'a1') {
  await trail.db.insert(documentReferences).values({
    id: `r-${n}-${k}-${anker}`, tenantId: T, knowledgeBaseId: KB,
    wikiDocumentId: n, sourceDocumentId: k, claimAnchor: anker,
  }).run();
}
async function identitetenPaa(id: string) {
  const r = await trail.db.select({ i: documents.sourceIdentity }).from(documents).where(eq(documents.id, id)).get();
  return r?.i ?? null;
}

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `nib-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'nib', name: 'Nib', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'n@i.dk', displayName: 'N', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Nib', slug: KB, language: 'da' }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(NØGLE).digest('hex'), scope: 'all',
  }).run();
  app = createApp(trail, new Map([['nib', trail]]));
});

test('TØRLØB ER STANDARD — den tæller, men skriver ikke', async () => {
  // Et backfill der kun kan køres for alvor er et backfill man ikke tør køre.
  await kilde('k1', URL_A);
  await neuron('n1'); await citerer('n1', 'k1');
  const t = await backfill(false);
  expect([t.fik, t.efter, t.applied]).toEqual([1, 0, false]);
  expect(await identitetenPaa('n1')).toBeNull();
});

test('DEN BÆRENDE: en Neuron med ÉN kilde arver kildens identitet — og tallet læses tilbage', async () => {
  await kilde('k1', URL_A);
  await neuron('n1'); await citerer('n1', 'k1');
  const r = await backfill(true);
  expect([r.foer, r.fik, r.efter]).toEqual([0, 1, 1]);
  expect(await identitetenPaa('n1')).toBe(URL_A);
});

test('samme kilde citeret TRE gange er ÉN kilde, ikke tre', async () => {
  // Uden DISTINCT ville hver Neuron med flere citater til samme side lande i
  // «flere kilder» og blive sprunget over — altså netop de grundigste sider.
  await kilde('k1', URL_A);
  await neuron('n1');
  for (const a of ['a1', 'a2', 'a3']) await citerer('n1', 'k1', a);
  expect((await backfill(true)).fik).toBe(1);
  expect(await identitetenPaa('n1')).toBe(URL_A);
});

test('DEN BEVIDSTE UNDLADELSE: en Neuron med TO kilder får INGEN identitet', async () => {
  // «Hvilken kilde er denne side en udgave AF» har intet entydigt svar når den
  // hviler på to. Gættede vi på den første, ville en ny udgave af DEN afløse en
  // side der også hvilede på den anden — altså tage gyldig viden væk, tavst.
  await kilde('k1', URL_A); await kilde('k2', URL_B);
  await neuron('n1'); await citerer('n1', 'k1'); await citerer('n1', 'k2');
  const r = await backfill(true);
  expect([r.fik, r.flereKilder]).toEqual([0, 1]);
  expect(await identitetenPaa('n1')).toBeNull();
});

test('en Neuron UDEN citat-kanter tælles som «ingen kilde», ikke som behandlet', async () => {
  // Blandes de to, ser rapporten bedre ud end virkeligheden.
  await neuron('n1');
  const r = await backfill(true);
  expect([r.fik, r.ingenKilde]).toEqual([0, 1]);
});

test('en kilde UDEN identitet giver ingen arv — ikke en tom identitet', async () => {
  await kilde('k1', null);
  await neuron('n1'); await citerer('n1', 'k1');
  const r = await backfill(true);
  expect([r.fik, r.ingenKilde]).toEqual([0, 1]);
  expect(await identitetenPaa('n1')).toBeNull();
});

test('IDEMPOTENT: anden kørsel ændrer intet og påstår intet', async () => {
  await kilde('k1', URL_A);
  await neuron('n1'); await citerer('n1', 'k1');
  await backfill(true);
  const igen = await backfill(true);
  expect([igen.fik, igen.havdeAllerede, igen.efter]).toEqual([0, 1, 1]);
});

test('arkiverede Neuroner røres ikke — de svarer ikke på noget', async () => {
  await kilde('k1', URL_A);
  await neuron('n1'); await citerer('n1', 'k1');
  await trail.db.update(documents).set({ archived: true }).where(eq(documents.id, 'n1')).run();
  expect((await backfill(true)).neuroner).toBe(0);
});
