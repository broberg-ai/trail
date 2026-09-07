/**
 * F263.7 — HVAD EN AMBIENT-NØGLE MÅ, OG HVAD DEN IKKE MÅ.
 *
 * `AMBIENT_ALLOWED` er en sikkerheds-allowlist for den nøgle en parret Mac
 * bærer i sin Keychain — og den havde INGEN prøve. Målt 7/9 2026: nul filer i
 * repoet nævnte den. En allowlist uden prøve er den der udvides stille: hver
 * tilføjelse ser lille ud i en diff, og ingenting bliver rødt når en for bred
 * ét-linjes regex slipper hele admin-fladen ind.
 *
 * Prøven kører gennem den RIGTIGE app (createApp) med en RIGTIG ambient-nøgle,
 * så det er porten der prøves — ikke en kopi af listen.
 *
 * DEN NEGATIVE HALVDEL ER DEN VIGTIGE. En prøve på kun de tilladte ruter ville
 * bestå fuldstændig grønt på `scopeAllows = () => ({allowed:true})`, altså på
 * en port der er slået helt fra. Derfor står de forbudte først.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys } from '@trail/db';
import { createApp } from '../app.js';

const T = 't-amb', U = 'u-amb', KB = 'kb-amb', SLUG = 'kb';
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;
const AMBIENT = `trail_${randomBytes(32).toString('hex')}`;
const FULD = `trail_${randomBytes(32).toString('hex')}`;

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `amb-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'amb', name: 'Amb', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'a@local.trail', displayName: 'A', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'KB', slug: 'kb', language: 'da' }).run();
  const hash = (k: string) => createHash('sha256').update(k).digest('hex');
  await trail.db.insert(apiKeys).values({ id: 'k-amb', tenantId: T, userId: U, name: 'ambient', keyHash: hash(AMBIENT), scope: 'ambient' }).run();
  await trail.db.insert(apiKeys).values({ id: 'k-fuld', tenantId: T, userId: U, name: 'fuld', keyHash: hash(FULD), scope: 'full' }).run();
  app = createApp(trail, new Map([['amb', trail]]));
});

async function kald(key: string, method: string, sti: string): Promise<number> {
  const res = await app.request(`http://engine.local${sti}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  return res.status;
}

/** Blev kaldet afvist AF SCOPET (403 med scope-begrundelsen), eller nåede det ruten? */
async function afvistAfScope(key: string, method: string, sti: string): Promise<boolean> {
  const res = await app.request(`http://engine.local${sti}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  if (res.status !== 403) return false;
  const b = (await res.json().catch(() => ({}))) as { error?: string };
  // Præcis begrundelsen, ikke bare «403» — en rute kan 403'e af egne grunde,
  // og så ville prøven bestå på den forkerte spærre.
  return typeof b.error === 'string' && b.error.includes('ambient key scope');
}

// ── DEN NEGATIVE HALVDEL FØRST ────────────────────────────────────────────
// Uden disse ville alt nedenfor bestå på en port der var slået helt fra.

const FORBUDT: Array<[string, string, string]> = [
  ['admin-fladen: alle nøgler',        'GET',    '/api/v1/api-keys'],
  ['admin-fladen: brugere',            'GET',    '/api/v1/users'],
  ['hele KB-rækken med indstillinger', 'GET',    `/api/v1/knowledge-bases/${KB}`],
  ['slet et dokument',                 'DELETE', '/api/v1/documents/d-1'],
  ['kø-gennemgang',                    'GET',    '/api/v1/queue'],
  ['TAG et kompilerings-job',          'POST',   '/api/v1/compile-jobs/claim'],
  ['vedligehold: dræn lint',           'POST',   '/api/v1/maintenance/drain-lint-candidates'],
];

for (const [navn, method, sti] of FORBUDT) {
  test(`FORBUDT for en ambient-nøgle: ${navn}`, async () => {
    expect(await afvistAfScope(AMBIENT, method, sti)).toBe(true);
  });
}

test('KONTROL: en full-nøgle afvises IKKE af scopet på de samme ruter', async () => {
  // Beviser at 403'erne ovenfor kommer fra SCOPET og ikke fra ruten selv.
  for (const [, method, sti] of FORBUDT) {
    expect(await afvistAfScope(FULD, method, sti)).toBe(false);
  }
});

// ── DE TILLADTE ───────────────────────────────────────────────────────────

const TILLADT: Array<[string, string, string]> = [
  ['søgning',                  'GET',  `/api/v1/knowledge-bases/${SLUG}/search?q=x`],
  ['KB-navnet',                'GET',  `/api/v1/knowledge-bases/${SLUG}/name`],
  ['skriv en kandidat',        'POST', '/api/v1/queue/candidates'],
  ['F263.7 KB-listen',         'GET',  '/api/v1/knowledge-bases'],
  ['F263.7 kildelisten',       'GET',  `/api/v1/knowledge-bases/${SLUG}/documents`],
  ['F263.7 ventende kilder',   'GET',  '/api/v1/documents?awaitingLocalCompile=true'],
  ['F263.7 upload',            'POST', `/api/v1/knowledge-bases/${SLUG}/documents/upload`],
  ['F263.7 motor-status',      'GET',  '/api/v1/compile-jobs/status'],
];

for (const [navn, method, sti] of TILLADT) {
  test(`TILLADT for en ambient-nøgle: ${navn}`, async () => {
    // Ruten må svare hvad den vil (200/400/404) — den må bare ikke afvises af scopet.
    expect(await afvistAfScope(AMBIENT, method, sti)).toBe(false);
  });
}

test('en ambient-nøgle når faktisk IGENNEM til motor-status og får tal', async () => {
  // Ikke bare «ikke afvist» — den skal kunne bruges. Et 403 fra en anden
  // spærre ville ellers se ud som en bestået prøve ovenfor.
  const res = await app.request('http://engine.local/api/v1/compile-jobs/status', {
    headers: { Authorization: `Bearer ${AMBIENT}` },
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ waiting: 0, working: 0, workers: [] });
});

test('en UKENDT rute er forbudt — allowlist, ikke denylist', async () => {
  // Den egenskab der gør listen sikker at udvide: en rute nogen tilføjer i
  // morgen er LUKKET for enheden indtil den bevidst åbnes.
  expect(await afvistAfScope(AMBIENT, 'GET', '/api/v1/en-rute-der-ikke-findes-endnu')).toBe(true);
});

test('en ambient-nøgle kan ikke nå en ANDEN kundes data gennem en tilladt rute', async () => {
  // Scopet er ikke tenant-isolationen — den er separat, og skal stadig holde.
  const res = await app.request(`http://engine.local/api/v1/knowledge-bases`, {
    headers: { Authorization: `Bearer ${AMBIENT}`, 'X-Trail-Tenant': 'en-anden-kunde' },
  });
  const rows = (await res.json().catch(() => [])) as Array<{ id?: string }>;
  if (Array.isArray(rows)) {
    for (const r of rows) expect(r.id).toBe(KB);   // kun vores egen
  }
});

test('de nye LÆSE-ruter svarer 200 — ikke bare «ikke afvist af scopet»', async () => {
  // Uden den her ville en allowlist-linje der peger på en sti der IKKE FINDES
  // bestå fuldstændig grønt ovenfor: 404 er heller ikke en scope-afvisning.
  // Målt netop det undervejs — to ruter svarede 404 fordi prøvens KB-id ikke
  // kunne slås op, og prøven var stadig grøn.
  for (const sti of [
    '/api/v1/knowledge-bases',
    `/api/v1/knowledge-bases/${SLUG}/documents`,
    '/api/v1/documents?awaitingLocalCompile=true',
    '/api/v1/compile-jobs/status',
  ]) {
    const res = await app.request(`http://engine.local${sti}`, {
      headers: { Authorization: `Bearer ${AMBIENT}` },
    });
    expect({ sti, status: res.status }).toEqual({ sti, status: 200 });
  }
});
