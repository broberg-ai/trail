/**
 * F263.8 — ENHEDENS TRAIL-TILLADELSE SKAL FAKTISK GÆLDE.
 *
 * Ejeren så det selv 7/9 2026: han godkendte 2 Trails ved parringen og
 * Ingest-vinduet viste alle 11. Målt i koden bagefter — `kbIds` blev gemt på
 * device-code-rækken og udleveret til Macen, og INGEN forespørgsel har
 * nogensinde kontrolleret det. Godkendelses-siden spurgte «hvilke Trails må
 * denne enhed skrive til?» og svaret var dekoration.
 *
 * En tilladelse der ikke håndhæves er værre end ingen: den ser ud som en
 * grænse, og man træffer beslutninger ud fra at den er der.
 *
 * DE NÆGTEDE STÅR FØRST. En prøve på kun de tilladte Trails ville bestå
 * fuldstændig grønt på den kode der var i går.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys } from '@trail/db';
import { createApp } from '../app.js';

const T = 't-grant', U = 'u-grant';
// RIGTIGE uuid'er, ikke 'kb-givet': resolveKbId vælger id- eller slug-kolonne
// på FORMEN af strengen, så et fixture med læsevenlige id'er ville have prøvet
// en anden kodesti end produktion kører. Første udgave gjorde netop det og gav
// 403 på en Trail enheden ER godkendt til.
const GIVET = crypto.randomUUID(), NAEGTET = crypto.randomUUID();
let app: ReturnType<typeof createApp>;

/** Godkendt til ÉN af to Trails — hele pointen. */
const ENHED = `trail_${randomBytes(32).toString('hex')}`;
/** Mintet før 7/9: ingen begrænsning optaget. Må opføre sig som hidtil. */
const ARVET = `trail_${randomBytes(32).toString('hex')}`;

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `grant-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  const trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'g', name: 'G', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'g@local.trail', displayName: 'G', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: GIVET, tenantId: T, createdBy: U, name: 'Givet', slug: 'givet', language: 'da' }).run();
  await trail.db.insert(knowledgeBases).values({ id: NAEGTET, tenantId: T, createdBy: U, name: 'Nægtet', slug: 'naegtet', language: 'da' }).run();
  const hash = (k: string) => createHash('sha256').update(k).digest('hex');
  await trail.db.insert(apiKeys).values({
    id: 'k-enhed', tenantId: T, userId: U, name: 'enhed', keyHash: hash(ENHED),
    scope: 'ambient', scopeKbIds: JSON.stringify([GIVET]),
  }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k-arvet', tenantId: T, userId: U, name: 'arvet', keyHash: hash(ARVET),
    scope: 'ambient', scopeKbIds: null,
  }).run();
  app = createApp(trail, new Map([['g', trail]]));
});

async function status(key: string, method: string, sti: string): Promise<number> {
  const res = await app.request(`http://engine.local${sti}`, {
    method, headers: { Authorization: `Bearer ${key}` },
  });
  return res.status;
}

// ── NÆGTET ──────────────────────────────────────────────────────────────────

test('NÆGTET: kildelisten i en Trail enheden ikke er godkendt til', async () => {
  expect(await status(ENHED, 'GET', `/api/v1/knowledge-bases/${NAEGTET}/documents`)).toBe(403);
});

test('NÆGTET: upload til en Trail enheden ikke er godkendt til', async () => {
  expect(await status(ENHED, 'POST', `/api/v1/knowledge-bases/${NAEGTET}/documents/upload`)).toBe(403);
});

test('NÆGTET: også via SLUG — en tilladelse på id må ikke kunne omgås med et navn', async () => {
  // Den fælde en naiv sammenligning falder i: stien bærer «naegtet», listen
  // bærer et uuid, og strengene er aldrig ens. Uden opslaget slipper den forbi.
  expect(await status(ENHED, 'GET', '/api/v1/knowledge-bases/naegtet/documents')).toBe(403);
});

test('NÆGTET: søgning i en fremmed Trail', async () => {
  expect(await status(ENHED, 'GET', `/api/v1/knowledge-bases/${NAEGTET}/search?q=x`)).toBe(403);
});

// ── TILLADT ─────────────────────────────────────────────────────────────────

test('TILLADT: den Trail enheden ER godkendt til — på id OG på slug', async () => {
  expect(await status(ENHED, 'GET', `/api/v1/knowledge-bases/${GIVET}/documents`)).toBe(200);
  expect(await status(ENHED, 'GET', '/api/v1/knowledge-bases/givet/documents')).toBe(200);
});

test('LISTEN viser KUN den godkendte Trail — det ejeren så gik galt', async () => {
  const res = await app.request('http://engine.local/api/v1/knowledge-bases', {
    headers: { Authorization: `Bearer ${ENHED}` },
  });
  expect(res.status).toBe(200);
  const rows = (await res.json()) as Array<{ id: string }>;
  expect(rows.map((r) => r.id)).toEqual([GIVET]);
});

// ── INGEN NAKEN OMLÆGNING ───────────────────────────────────────────────────

test('en nøgle UDEN optaget begrænsning opfører sig som før — begge Trails', async () => {
  // Ellers ville en allerede parret Mac holde op med at virke i det sekund
  // motoren blev udrullet, uden at nogen havde rørt den.
  expect(await status(ARVET, 'GET', `/api/v1/knowledge-bases/${GIVET}/documents`)).toBe(200);
  expect(await status(ARVET, 'GET', `/api/v1/knowledge-bases/${NAEGTET}/documents`)).toBe(200);
  const res = await app.request('http://engine.local/api/v1/knowledge-bases', {
    headers: { Authorization: `Bearer ${ARVET}` },
  });
  expect(((await res.json()) as Array<{ id: string }>).length).toBe(2);
});
