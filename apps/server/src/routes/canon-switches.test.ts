/**
 * F275.2 — de to kontakter, målt gennem endpointet.
 *
 * Prøverne er skrevet mod acceptkriterierne: default TIL (AC#2), hierarkiet
 * (AC#3), GEM-BEVIS ved en FRISK hentning (AC#5) og negativ kontrol på både en
 * anden Brain og en anden konnektor (AC#6).
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys, documents } from '@trail/db';
import { createApp } from '../app.js';

const T = 't-kan', U = 'u-kan', A = 'kb-a', B = 'kb-b';
const NØGLE = 'trail_' + 'k'.repeat(64);
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

type Svar = {
  brain: boolean;
  disabledConnectors: string[];
  konnektorer: { id: string; label: string; antalKilder: number; ownSwitch: boolean; overriddenByBrain: boolean; effective: boolean }[];
};

/** FRISK hentning — aldrig PATCH-svarets eget ekko. Det er hele pointen i AC#5. */
async function hent(kb: string): Promise<Svar> {
  const res = await app.request(`http://engine.local/api/v1/knowledge-bases/${kb}/canon-settings`, {
    headers: { Authorization: `Bearer ${NØGLE}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Svar;
}

async function saet(kb: string, body: unknown) {
  return app.request(`http://engine.local/api/v1/knowledge-bases/${kb}/canon-settings`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${NØGLE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function konnektor(s: Svar, id: string) {
  return s.konnektorer.find((k) => k.id === id);
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `kanon-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'kan', name: 'Kan', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'k@b.dk', displayName: 'K', role: 'owner', onboarded: true }).run();
  // slug == id: resolveKbId slår et ikke-UUID op på SLUG, ikke på id.
  for (const id of [A, B])
    await trail.db.insert(knowledgeBases).values({ id, tenantId: T, createdBy: U, name: id, slug: id, language: 'da' }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(NØGLE).digest('hex'), scope: 'all',
  }).run();
  // To konnektorer på A's kilder, så listen er MÅLT og ikke pickedUp fra registret.
  // `broberg-ai-site-sync` står IKKE i @trail/shared's register — den er netop
  // derfor med her: en liste fra registret ville mangle den kontakt ejeren skal bruge.
  let n = 0;
  for (const [c, antal] of [['broberg-ai-site-sync', 3], ['upload', 1]] as const)
    for (let i = 0; i < antal; i++)
      await trail.db.insert(documents).values({
        id: `d${n++}`, tenantId: T, userId: U, knowledgeBaseId: A, path: '/sources/', filename: `f${n}.md`,
        content: 'x', kind: 'source', fileType: 'md', metadata: JSON.stringify({ connector: c }),
      }).run();
  app = createApp(trail, new Map([['kan', trail]]));
});

test('AC#2 — en frisk Brain: BEGGE kontakter står TIL uden at nogen har rørt dem', async () => {
  const s = await hent(A);
  expect(s.brain).toBe(true);
  expect(s.disabledConnectors).toEqual([]);
  expect(s.konnektorer.length).toBe(2);
  for (const k of s.konnektorer) expect([k.ownSwitch, k.effective, k.overriddenByBrain]).toEqual([true, true, false]);
});

test('konnektor-listen er MÅLT på Brainens egne kilder — ikke pickedUp fra registret', async () => {
  const s = await hent(A);
  const site = konnektor(s, 'broberg-ai-site-sync');
  expect(site?.antalKilder).toBe(3);
  // Uden for registret ⇒ id'et er sit eget mærkat frem for at forsvinde.
  expect(site?.label).toBe('broberg-ai-site-sync');
  expect(konnektor(s, 'upload')?.label).toBe('Upload');
});

test('AC#5 GEM-BEVIS — slå konnektoren fra, hent PÅ NY, den står stadig fra', async () => {
  expect((await saet(A, { konnektor: { id: 'upload', kanon: false } })).status).toBe(200);
  const frisk = await hent(A);
  expect(frisk.disabledConnectors).toEqual(['upload']);
  expect(konnektor(frisk, 'upload')?.effective).toBe(false);
  // Den anden konnektor i SAMME Brain er urørt — ellers gemte vi på Brainen
  // i stedet for på konnektoren, og det ville bestå AC#5 ved et tilfælde.
  expect(konnektor(frisk, 'broberg-ai-site-sync')?.effective).toBe(true);
});

test('AC#5 negativ vej — slå til igen, hent PÅ NY, den står til', async () => {
  // En kontakt der kun kan SÆTTES ser identisk ud med en der effective, indtil
  // nogen prøver at rydde den. Derfor har vejen tilbage sin egen prøve.
  expect((await saet(A, { konnektor: { id: 'upload', kanon: true } })).status).toBe(200);
  const frisk = await hent(A);
  expect(frisk.disabledConnectors).toEqual([]);
  expect(konnektor(frisk, 'upload')?.effective).toBe(true);
});

test('AC#3 — Brain FRA slår ALT fra, og konnektoren vises som SAT UD AF KRAFT', async () => {
  expect((await saet(A, { brain: false })).status).toBe(200);
  const frisk = await hent(A);
  expect(frisk.brain).toBe(false);
  for (const k of frisk.konnektorer) {
    expect(k.ownSwitch).toBe(true);   // kontakten står stadig på TIL …
    expect(k.overriddenByBrain).toBe(true);  // … men den er sat ud af kraft, og det kan SES
    expect(k.effective).toBe(false);
  }
});

test('AC#3 — en konnektor der SELV er fra er ikke «sat ud af kraft», den er bare fra', async () => {
  await saet(A, { konnektor: { id: 'upload', kanon: false } });
  const frisk = await hent(A);
  const k = konnektor(frisk, 'upload');
  expect([k?.ownSwitch, k?.overriddenByBrain, k?.effective]).toEqual([false, false, false]);
});

test('en kontakt brugeren har slået FRA forsvinder ikke selv om ingen source bærer konnektoren', async () => {
  // Ellers kan han ikke slå den til igen — kontakten ville være væk fra skærmen
  // mens den stadig virkede i databasen.
  await saet(A, { konnektor: { id: 'en-konnektor-uden-kilder', kanon: false } });
  expect(konnektor(await hent(A), 'en-konnektor-uden-kilder')?.antalKilder).toBe(0);
});

test('AC#6 NEGATIV KONTROL — Brain B er fuldstændig urørt af alt ovenstående', async () => {
  const b = await hent(B);
  expect(b.brain).toBe(true);
  expect(b.disabledConnectors).toEqual([]);
  // Beviser at værdien gemmes på den rigtige RÆKKE og ikke globalt.
});

test('AC#3 tilbage — slå Brainen til igen: konnektorernes egne kontakter huskes', async () => {
  expect((await saet(A, { brain: true })).status).toBe(200);
  const frisk = await hent(A);
  expect(frisk.brain).toBe(true);
  expect(konnektor(frisk, 'upload')?.effective).toBe(false);                 // var slået fra før
  expect(konnektor(frisk, 'broberg-ai-site-sync')?.effective).toBe(true);    // var ikke
});

test('en tom krop afvises frem for at gemme ingenting og melde succes', async () => {
  expect((await saet(A, {})).status).toBe(400);
  expect((await saet(A, { ukendt: true })).status).toBe(400);
});

test('en ukendt Brain giver 404 — ikke en tavs 200 på den forkerte række', async () => {
  const res = await app.request('http://engine.local/api/v1/knowledge-bases/findes-ikke/canon-settings', {
    headers: { Authorization: `Bearer ${NØGLE}` },
  });
  expect(res.status).toBe(404);
});
