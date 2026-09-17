/**
 * F275.6 — de fire tilfælde, målt gennem de ÆGTE upload-veje.
 *
 * AC#2: spørgsmålet stilles VED UPLOAD, aldrig i køen bagefter. Mennesket der
 * lige har trukket filen ind ved hvilket af de to det er; kuratoren tre dage
 * senere gør ikke.
 */
import { test, expect, beforeAll, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys, documents } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-fa', U = 'u-fa';
/**
 * Hver prøve får sin EGEN Brain — men vi deler database.
 *
 * Første udgave lavede en frisk database i `beforeEach`, og DET lammede hele
 * serverens suite: en chunk-delt upload udløser en kompilering (finalize ærer
 * ikke `localCompile`, se uploads.ts:1203), og jobbet blev efterladt mod en
 * database der var skiftet ud under det. Kørslen holdt så global-concurrency
 * for evigt og skrev 2.576.392 lines «[backpressure] holding job_…» uden at
 * en eneste prøve blev færdig.
 *
 * Målt: uden denne fil 402 grønne på 10,5 s; med den, uendeligt.
 */
let KB = '';
const NØGLE = 'trail_' + 'a'.repeat(64);
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

const RAPPORT = `# Årsrapport 2025

Selskabet har i regnskabsåret realiseret en omsætning på 12,4 millioner kroner mod
9,8 millioner året før. Væksten kommer primært fra nye kundeaftaler inden for
hosting og softwareudvikling. Resultatet før skat udgør 2,1 millioner kroner.
Bestyrelsen indstiller at årets resultat overføres til næste regnskabsår.
Selskabet beskæftigede i gennemsnit fire medarbejdere. Ledelsen forventer fortsat
vækst i det kommende regnskabsår, drevet af den samme kombination som hidtil.`;

const RAPPORT_NYT_AAR = RAPPORT.replace('2025', '2026');

const HELT_ANDET = `# Databehandleraftale

Aftalen regulerer behandling af personoplysninger i forbindelse med levering af
hosting. Databehandleren må alene behandle oplysninger after dokumenteret instruks
fra den dataansvarlige. Oplysningerne opbevares inden for EU og slettes ved
aftalens ophør. Parterne er enige om at tekniske og organisatoriske
sikkerhedsforanstaltninger skal afspejle risikoen ved behandlingen.`;

type Advarsel = { kind: string; sag?: string; similarity?: number | null; ligner?: { filename: string } };

async function upload(navn: string, indhold: string) {
  const fd = new FormData();
  fd.append('file', new Blob([indhold], { type: 'text/markdown' }), navn);
  const res = await app.request(`http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload?localCompile=true`, {
    method: 'POST', headers: { Authorization: `Bearer ${NØGLE}` }, body: fd,
  });
  return { res, body: (await res.json()) as { id: string; advarsel?: Advarsel } };
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `fa-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'fa', name: 'Fa', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f@a.dk', displayName: 'F', role: 'owner', onboarded: true }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(NØGLE).digest('hex'), scope: 'all',
  }).run();
  app = createApp(trail, new Map([['fa', trail]]));
});

let n = 0;
beforeEach(async () => {
  // En frisk BRAIN pr. prøve giver den isolation hver sag kræver — similarity slås
  // kun op inden for én Brain — uden at rive databasen væk under et kørende job.
  // slug == id: resolveKbId slår et ikke-UUID op på SLUG, ikke på id.
  KB = `kb-fa-${n++}`;
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: KB, slug: KB, language: 'da' }).run();
});

test('aftrykket sættes ved upload — og NULL når teksten er for kort til at måle', async () => {
  const { body } = await upload('rapport.md', RAPPORT);
  const r = await trail.db
    .select({ a: documents.contentFingerprint }).from(documents).where(eq(documents.id, body.id)).get();
  expect(typeof r!.a).toBe('string');
  expect(r!.a!.length).toBe(64 * 8);

  const kort = await upload('kort.md', '# Side 1 af 4');
  const rk = await trail.db
    .select({ a: documents.contentFingerprint }).from(documents).where(eq(documents.id, kort.body.id)).get();
  // «Kunne ikke måles» — ikke «ny source», og ikke et falsk aftryk over tre ord.
  expect(rk!.a).toBeNull();
});

test('AC#3 SAG 1 — høj similarity + SAMME navn = ny udgave, med lighedsgraden i beskeden', async () => {
  await upload('rapport.md', RAPPORT);
  const { body } = await upload('rapport.md', RAPPORT_NYT_AAR);
  expect(body.advarsel?.kind).toBe('samme-source');
  expect(body.advarsel?.sag).toBe('new-edition');
  expect(body.advarsel!.similarity!).toBeGreaterThan(0.85);
});

test('AC#3 SAG 2 — høj similarity + ANDET navn = samme værk under nyt navn', async () => {
  // Den sag filnavn-identiteten IKKE kan se: navnene er jo forskellige.
  await upload('rapport.md', RAPPORT);
  const { body } = await upload('rapport-endelig.md', RAPPORT_NYT_AAR);
  expect(body.advarsel?.kind).toBe('same-work-new-name');
  expect(body.advarsel?.ligner?.filename).toBe('rapport.md');
  expect(body.advarsel!.similarity!).toBeGreaterThan(0.85);
});

test('AC#3 SAG 3 — LAV similarity + SAMME navn = NAVNEKOLLISION, den højeste alarm', async () => {
  // To værker slås om ét navn. Med filnavn+Brain som identitet er det NETOP her
  // en lydløs overskrivning ville ske, og den er usynlig bagefter.
  await upload('bilag.md', RAPPORT);
  const { body } = await upload('bilag.md', HELT_ANDET);
  expect(body.advarsel?.kind).toBe('samme-source');
  expect(body.advarsel?.sag).toBe('name-collision');
  expect(body.advarsel!.similarity!).toBeLessThan(0.85);
});

test('AC#3 SAG 4 — lav similarity + andet navn = ny source, og vi siger INTET', async () => {
  // Uden denne ville «advar altid» bestå lige så grønt — og en besked ved hver
  // eneste upload er ingen besked.
  await upload('rapport.md', RAPPORT);
  const { body } = await upload('aftale.md', HELT_ANDET);
  expect(body.advarsel).toBeUndefined();
});

test('AC#5 — en fil vi IKKE kan måle udløser ikke «samme værk»', async () => {
  // En scannet PDF uden tekstlag har intet aftryk. «Kunne ikke måle» må aldrig
  // blive til en påstand om similarity — hverken for eller imod.
  await upload('rapport.md', RAPPORT);
  const { body } = await upload('scannet.md', '# 1');
  expect(body.advarsel).toBeUndefined();
});

test('AC#5 — navnesammenfald UDEN aftryk melder stadig, men siger «kan ikke afgøres»', async () => {
  // Beskeden må ikke udeblive bare fordi vi ikke kunne måle ligheden: identiteten
  // siger allerede at det er samme source. Det er GRADEN vi ikke kender.
  await upload('scannet.md', '# 1');
  const { body } = await upload('scannet.md', '# 2');
  expect(body.advarsel?.kind).toBe('samme-source');
  expect(body.advarsel?.sag).toBe('undecidable');
  expect(body.advarsel?.similarity).toBeNull();
});

/**
 * DEN VEJ ADMIN-PANELET FAKTISK BRUGER.
 *
 * Skrevet fordi mutationen «fjern aftrykket fra den chunk-delte vej» forblev
 * GRØN: alle prøverne ovenfor går gennem enkelt-POST'en, og panelet bruger kun
 * den chunk-delte. Et aftryk der kun sættes på den ene vej er grønt i prøverne
 * og fraværende på skærmen — samme fælde som i F275.2, og den kostede allerede
 * én gang.
 */
async function uploadChunket(navn: string, indhold: string) {
  const bytes = new TextEncoder().encode(indhold);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const H = { Authorization: `Bearer ${NØGLE}`, 'Content-Type': 'application/json' };

  const init = await app.request(`http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload/init?localCompile=true`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ filename: navn, contentLength: bytes.length, contentHash: hash }),
  });
  expect(init.status).toBe(201);
  const { uploadId } = (await init.json()) as { uploadId: string };

  const chunk = await app.request(`http://engine.local/api/v1/uploads/${uploadId}/chunk`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NØGLE}`,
      'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
  });
  expect(chunk.status).toBe(200);

  const fin = await app.request(`http://engine.local/api/v1/uploads/${uploadId}/finalize`, {
    method: 'POST', headers: H, body: JSON.stringify({ contentHash: hash }),
  });
  expect(fin.status).toBe(201);
  return (await fin.json()) as { doc: { id: string }; advarsel?: Advarsel };
}

test('DEN CHUNK-DELTE VEJ sætter aftrykket — ellers er featuren usynlig i panelet', async () => {
  const r = await uploadChunket('chunket.md', RAPPORT);
  const row = await trail.db
    .select({ a: documents.contentFingerprint }).from(documents).where(eq(documents.id, r.doc.id)).get();
  expect(typeof row!.a).toBe('string');
  expect(row!.a!.length).toBe(64 * 8);
});

test('… og de fire sager effective DÉR OGSÅ: samme værk under nyt navn', async () => {
  await uploadChunket('rapport.md', RAPPORT);
  const r = await uploadChunket('rapport-endelig.md', RAPPORT_NYT_AAR);
  expect(r.advarsel?.kind).toBe('same-work-new-name');
  expect(r.advarsel?.ligner?.filename).toBe('rapport.md');
});

test('… og de to veje er ENIGE: en fil uploadet chunk-delt genkendes af enkelt-POST', async () => {
  // Var de uenige om aftrykket, ville «samme værk» afhænge af hvilken klient
  // der uploadede — altså af noget der intet har med indholdet at gøre.
  await uploadChunket('rapport.md', RAPPORT);
  const { body } = await upload('rapport-kopi.md', RAPPORT_NYT_AAR);
  expect(body.advarsel?.kind).toBe('same-work-new-name');
  expect(body.advarsel?.ligner?.filename).toBe('rapport.md');
});
