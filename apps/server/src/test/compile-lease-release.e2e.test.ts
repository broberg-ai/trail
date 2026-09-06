/**
 * F263.1 — EN GENPARKERET KILDE SKAL VÆRE LEDIG MED DET SAMME.
 *
 * Fundet i reviewet af F263.1, ikke i drift: claim satte `compile_lease_until`
 * fem minutter frem, og INGEN af de to ruter der ejer flaget nulstillede det
 * igen. Rækkefølgen der gør ondt er hverdag i Ingest Station:
 *
 *   1. en arbejder tager kilden        → reservation til kl. X+5
 *   2. den bliver færdig               → flaget ryddes, reservationen står
 *   3. kilden parkeres igen (ny udgave af filen, eller «Prøv igen»)
 *   4. næste arbejder claimer          → INTET, i op til fem minutter
 *
 * Køen ser tom ud mens der ligger arbejde i den. Det er samme fejlform som
 * resten af aftenen: et svar der ser rigtigt ud (nul jobs) og ikke kan skelnes
 * fra det ægte (der ER nul jobs).
 *
 * Prøven kører gennem de RIGTIGE ruter via createApp — det er rutens skrivning
 * der er fejlen, så en prøve på tjenestelaget ville have været grøn hele vejen
 * igennem fejlen.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, documents } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-lease', U = 'u-lease', KB = 'kb-lease', DOC = 'doc-lease';
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

const H = { Cookie: 'session=sess-lease', 'Content-Type': 'application/json' };
const kald = (sti: string, body: unknown = {}) =>
  app.request(`http://engine.local/api/v1${sti}`, { method: 'POST', headers: H, body: JSON.stringify(body) });

/** Claim gennem den rigtige rute — returnerer id'erne arbejderen fik. */
async function claim(worker: string): Promise<string[]> {
  const res = await kald('/compile-jobs/claim', { worker, limit: 10 });
  const b = (await res.json()) as { jobs?: Array<{ id: string }> };
  return (b.jobs ?? []).map((j) => j.id);
}

/** Lease-felterne LÆST TILBAGE fra basen, ikke fra rutens eget svar. */
async function lease(): Promise<{ by: string | null; until: string | null }> {
  const r = await trail.db
    .select({ by: documents.compileClaimedBy, until: documents.compileLeaseUntil })
    .from(documents).where(eq(documents.id, DOC)).get();
  return { by: r?.by ?? null, until: r?.until ?? null };
}

async function parker(): Promise<void> {
  await trail.db.update(documents)
    .set({ awaitingLocalCompile: true, status: 'ready' }).where(eq(documents.id, DOC)).run();
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `lease-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'lease', name: 'Lease', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'l@local.trail', displayName: 'L', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'KB', slug: 'kb', language: 'da' }).run();
  await trail.db.insert(sessions).values({ id: 'sess-lease', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();
  await trail.db.insert(documents).values({
    id: DOC, tenantId: T, knowledgeBaseId: KB, userId: U, kind: 'source',
    filename: 'kilde.md', fileType: 'md', status: 'ready', awaitingLocalCompile: true,
  }).run();
  app = createApp(trail, new Map([['lease', trail]]));
});

test('færdigmelding SLIPPER reservationen — læst tilbage fra basen', async () => {
  expect(await claim('mac-1')).toEqual([DOC]);
  expect((await lease()).by).toBe('mac-1');           // den blev faktisk taget

  const res = await kald(`/documents/${DOC}/local-compiled`);
  expect(res.status).toBe(200);

  const efter = await lease();
  expect(efter.by).toBeNull();
  expect(efter.until).toBeNull();
});

test('DEN ÆGTE RÆKKEFØLGE: kompileret → parkeret igen → straks ledig for næste arbejder', async () => {
  await parker();
  expect(await claim('mac-2')).toEqual([DOC]);
});

test('NEGATIV KONTROL: en reservation der IKKE er sluppet, skjuler kilden', async () => {
  // Uden den ville prøven ovenfor bestå selv hvis claim slet ikke reserverede
  // noget — «ledig» ville da være normaltilstanden frem for resultatet af fixet.
  expect(await claim('mac-3')).toEqual([]);            // mac-2 har den stadig
});

test('«Prøv igen» giver også en ledig kilde, uanset hvad der stod før', async () => {
  // Bæltet: sæt en reservation langt ude i fremtiden med vilje, og lad ruten
  // rydde den. Uden nulstillingen i local-recompile ville kilden være usynlig
  // en hel time.
  await trail.db.update(documents).set({
    awaitingLocalCompile: false,
    compileClaimedBy: 'spøgelse',
    compileLeaseUntil: new Date(Date.now() + 3_600_000).toISOString(),
  }).where(eq(documents.id, DOC)).run();

  const res = await kald(`/documents/${DOC}/local-recompile`);
  expect(res.status).toBe(200);
  expect(await lease()).toEqual({ by: null, until: null });
  expect(await claim('mac-4')).toEqual([DOC]);
});
