/**
 * F275.2 AC#4 — besked ved upload-navnesammenfald.
 *
 * Ejeren valgte default ON for uploads MOD rådgivningen. Prisen er at to
 * forskellige `rapport.pdf` i samme Brain ellers ville overskrive hinandens
 * viden lydløst. Denne besked — og fortrydelsen — er hele sikkerhedsnettet,
 * så den har sin egen prøve i begge retninger.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys, documents } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-nav', U = 'u-nav', KB = 'kb-nav';
const NØGLE = 'trail_' + 'n'.repeat(64);
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

type Advarsel = {
  kind: string;
  erstatter: { id: string; filename: string; uploadet: string };
  erstatterNu: boolean;
  grund: string;
  nyKildeEndpoint: string;
};

/** Indholdet varierer med vilje — ellers rammer vi dedup-spærren på contentHash. */
async function upload(navn: string, indhold: string, query = '') {
  const fd = new FormData();
  fd.append('file', new Blob([indhold], { type: 'text/markdown' }), navn);
  const res = await app.request(
    `http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload${query}`,
    { method: 'POST', headers: { Authorization: `Bearer ${NØGLE}` }, body: fd },
  );
  return { res, body: (await res.json()) as { id: string; sourceIdentity: string | null; advarsel?: Advarsel } };
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `nav-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'nav', name: 'Nav', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'n@b.dk', displayName: 'N', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Nav', slug: KB, language: 'da' }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(NØGLE).digest('hex'), scope: 'all',
  }).run();
  app = createApp(trail, new Map([['nav', trail]]));
});

test('en upload får en identitet på filnavn + Brain — ikke null', async () => {
  const { res, body } = await upload('rapport.md', '# udgave 1');
  expect(res.status).toBe(201);
  expect(body.sourceIdentity).toBe(`path:${KB}/rapport.md`);
  // Første upload: intet at erstatte, altså ingen besked.
  expect(body.advarsel).toBeUndefined();
});

test('AC#4 — samme filnavn igen: brugeren får at vide at det ERSTATTER, MED DATO', async () => {
  const { body } = await upload('rapport.md', '# udgave 2, helt andet indhold');
  const a = body.advarsel;
  expect(a?.kind).toBe('samme-kilde');
  expect(a?.erstatter.filename).toBe('rapport.md');
  // Datoen er selve pointen: «dette erstatter rapport.md fra 3. september».
  expect(typeof a?.erstatter.uploadet).toBe('string');
  expect(Number.isNaN(Date.parse(a!.erstatter.uploadet))).toBe(false);
  expect(a?.erstatterNu).toBe(true);
  expect(a?.grund).toBe('til');
});

test('beskeden siger hvad der SKER, ikke hvad der er sat op — Brain FRA ⇒ erstatterNu false', async () => {
  // En besked der påstod «dette erstatter …» mens kontakten stod på FRA ville
  // være forkert i den beroligende retning: brugeren ville tro noget skete.
  await trail.db.update(knowledgeBases).set({ newVersionIsCanon: false }).where(eq(knowledgeBases.id, KB)).run();
  const { body } = await upload('rapport.md', '# udgave 3');
  expect(body.advarsel?.erstatterNu).toBe(false);
  expect(body.advarsel?.grund).toBe('brain-fra');
  await trail.db.update(knowledgeBases).set({ newVersionIsCanon: true }).where(eq(knowledgeBases.id, KB)).run();
});

test('AC#4 fortrydelsen — «det er en ny kilde» giver filen sin EGEN identitet', async () => {
  const { body } = await upload('rapport.md', '# helt andet værk, samme navn');
  expect(body.advarsel).toBeDefined();

  const res = await app.request(`http://engine.local${body.advarsel!.nyKildeEndpoint}`, {
    method: 'POST', headers: { Authorization: `Bearer ${NØGLE}` },
  });
  expect(res.status).toBe(200);

  // LÆS TILBAGE fra databasen — ikke fra svarets eget ekko.
  const raekke = await trail.db
    .select({ id: documents.sourceIdentity }).from(documents).where(eq(documents.id, body.id)).get();
  expect(raekke?.id).toBe(`path:${KB}/${body.id}/rapport.md`);
});

test('en fil der er markeret «ny kilde» udløser ALDRIG beskeden igen', async () => {
  // Den bærende halvdel af fortrydelsen: holdt valget kun til næste upload,
  // ville brugerens beslutning forsvinde uden at nogen fik det at vide.
  const { body } = await upload('rapport.md', '# endnu en udgave', '?nyKilde=true');
  expect(body.advarsel).toBeUndefined();
  expect(body.sourceIdentity).toBe(`path:${KB}/${body.id}/rapport.md`);
});

test('NEGATIV KONTROL — et ANDET filnavn er ikke et navnesammenfald', async () => {
  // Uden den ville «advar altid» bestå lige så grønt som den rigtige regel.
  const { body } = await upload('et-andet-navn.md', '# uafhængigt værk');
  expect(body.advarsel).toBeUndefined();
});

/**
 * DEN VEJ ADMIN-PANELET FAKTISK BRUGER.
 *
 * Der er to upload-veje: enkelt-POST'en ovenfor og den chunk-delte herunder.
 * Panelet bruger KUN den chunk-delte. Prøvede vi bare den første, ville
 * beskeden bestå grønt og alligevel mangle på skærmen — og et sikkerhedsnet
 * der kun findes i prøverne er ikke et sikkerhedsnet.
 */
async function uploadChunket(navn: string, indhold: string, query = '') {
  const bytes = new TextEncoder().encode(indhold);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const H = { Authorization: `Bearer ${NØGLE}`, 'Content-Type': 'application/json' };

  const init = await app.request(
    `http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload/init${query}`,
    { method: 'POST', headers: H, body: JSON.stringify({ filename: navn, contentLength: bytes.length, contentHash: hash }) },
  );
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
  return { res: fin, body: (await fin.json()) as { doc?: { id: string; sourceIdentity: string | null }; advarsel?: Advarsel } };
}

test('den CHUNK-DELTE vej giver samme identitet som enkelt-POST\'en', async () => {
  const { res, body } = await uploadChunket('chunket.md', '# chunket udgave 1');
  expect(res.status).toBe(201);
  expect(body.doc?.sourceIdentity).toBe(`path:${KB}/chunket.md`);
  expect(body.advarsel).toBeUndefined();
});

test('AC#4 på den vej ADMIN bruger: samme navn igen ⇒ besked med dato', async () => {
  const { body } = await uploadChunket('chunket.md', '# chunket udgave 2, andet indhold');
  expect(body.advarsel?.kind).toBe('samme-kilde');
  expect(body.advarsel?.erstatter.filename).toBe('chunket.md');
  expect(Number.isNaN(Date.parse(body.advarsel!.erstatter.uploadet))).toBe(false);
  expect(body.advarsel?.erstatterNu).toBe(true);
});

test('de to veje er enige om identiteten — ellers afhang «samme kilde» af klienten', async () => {
  // En fil uploadet med den ene vej skal kunne genkendes af den anden.
  const { body } = await upload('chunket.md', '# nu via enkelt-POST');
  expect(body.sourceIdentity).toBe(`path:${KB}/chunket.md`);
  expect(body.advarsel?.erstatter.filename).toBe('chunket.md');
});

/**
 * F263.8 — afgrænsningen gælder OGSÅ fortrydelses-ruten.
 *
 * Fundet i sikkerhedsgennemgangen af mit eget endepunkt: en `ambient`-afgrænset
 * nøgle kunne ændre kilde-identiteten på ETHVERT dokument i lejemålet, også i en
 * Brain den aldrig har fået adgang til. Konsekvensen er stille — en kilde hvis
 * identitet er skiftet, genkendes ikke længere som en tidligere udgave, så
 * afløsningen springer den over uden at noget fejler.
 */
import { apiKeys as nøgleTabel, knowledgeBases as brainTabel } from '@trail/db';

const AFGRÆNSET = 'trail_' + 'g'.repeat(64);
const ANDEN_KB = 'kb-anden';

test('SIKKERHED: en AFGRÆNSET nøgle kan IKKE flytte identiteten — og afvisningen er fuldstændig', async () => {
  // Nøglen er bevilget til en ANDEN Brain end den filen ligger i.
  await trail.db.insert(brainTabel).values({
    id: ANDEN_KB, tenantId: T, createdBy: U, name: 'Anden', slug: ANDEN_KB, language: 'da', isSandbox: true,
  }).run();
  await trail.db.insert(nøgleTabel).values({
    id: 'k-graense', tenantId: T, userId: U, name: 'graense',
    keyHash: createHash('sha256').update(AFGRÆNSET).digest('hex'),
    scope: 'ambient', scopeKbIds: JSON.stringify([ANDEN_KB]),
  }).run();

  const { body } = await upload('afgraenset.md', '# en fil i KB');
  const res = await app.request(`http://engine.local/api/v1/documents/${body.id}/ny-kilde`, {
    method: 'POST', headers: { Authorization: `Bearer ${AFGRÆNSET}` },
  });
  expect(res.status).toBe(403);
  // MÅLT, ikke antaget: afvisningen kommer fra den ØVERSTE spærre — sti-
  // allowlisten i middleware/auth.ts, hvor denne rute ikke står. Min første
  // formodning var at ruten selv skulle stoppe den; den holdt ikke, og prøven
  // asserter derfor på det der FAKTISK sker. Rutens egen kontrol er anden dør:
  // den dag nogen udvider allowlisten, er den forskellen på en åbning og en
  // stille åbning.
  expect((await res.json() as { error: string }).error).toContain('ambient key scope');

  // Og identiteten står URØRT — afvisningen må ikke være halvt gennemført.
  const efter = await trail.db
    .select({ i: documents.sourceIdentity }).from(documents).where(eq(documents.id, body.id)).get();
  expect(efter!.i).toBe(`path:${KB}/afgraenset.md`);
});

test('NEGATIV KONTROL: en UAFGRÆNSET nøgle kan stadig fortryde', async () => {
  // Uden den ville «afvis alle» bestå lige så grønt — og kuratoren ville have
  // mistet det ene valg der er hele sikkerhedsnettet bag default ON.
  const { body } = await upload('uafgraenset.md', '# en anden fil');
  const res = await app.request(`http://engine.local/api/v1/documents/${body.id}/ny-kilde`, {
    method: 'POST', headers: { Authorization: `Bearer ${NØGLE}` },
  });
  expect(res.status).toBe(200);
});
