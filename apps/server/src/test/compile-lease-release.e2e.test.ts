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

test('F263.3 — SVARET er læst tilbage fra rækken, ikke bygget af forespørgslen', async () => {
  // Fundet 8/9 under en afstemning med upmetrics. Svaret var
  //   { id: doc.id, awaitingLocalCompile: false, failed: !!body.failed }
  // altså kalderens egne ord spejlet tilbage, med `false` som en KONSTANT. En
  // skrivning der landede og en der gjorde ingenting gav identiske svar — i det
  // ene endepunkt hvis opgave er at melde arbejde færdigt.
  //
  // DERFOR ASSERTERES DER PÅ `updatedAt` — men med et ærligt forbehold om HVAD
  // prøven kan og ikke kan, målt frem for antaget:
  //
  //   mutation = præcis den gamle form (intet updatedAt i svaret)  → RØD
  //   mutation = en handler der FABRIKERER new Date().toISOString() → GRØN
  //
  // Den anden er ikke dækket, og det skyldes at begge tidsstempler skrives
  // inden for samme millisekund, så ISO-strengene bliver ens. Jeg lod først
  // den grønne kørsel stå som «mutations-bevist» — den beviste kun at to ure
  // aflæses samtidig.
  //
  // Prøven vogter altså REGRESSIONEN (svaret mister sin tilbagelæsning), ikke
  // den bredere klasse (en handler der finder på et plausibelt svar). At skærpe
  // den ville kræve et felt kun rækken kan kende, og det findes ikke i dette
  // svar. Det står skrevet her frem for at blive opdaget af den næste der
  // stoler på ordet «mutations-bevist».
  await parker();
  const foer = await trail.db
    .select({ updatedAt: documents.updatedAt }).from(documents)
    .where(eq(documents.id, DOC)).get();

  const res = await kald(`/documents/${DOC}/local-compiled`);
  expect(res.status).toBe(200);
  const krop = (await res.json()) as { updatedAt?: string; awaitingLocalCompile?: boolean };

  const efter = await trail.db
    .select({ updatedAt: documents.updatedAt }).from(documents)
    .where(eq(documents.id, DOC)).get();

  // Svarets tidsstempel er RÆKKENS tidsstempel — ikke «et tidspunkt», rækkens.
  expect(krop.updatedAt).toBe(efter!.updatedAt!);
  // Og rækken har faktisk flyttet sig, så vi ikke sammenligner to uændrede felter.
  expect(efter!.updatedAt).not.toBe(foer!.updatedAt);
  expect(krop.awaitingLocalCompile).toBe(false);
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

// ── F263.16 AC#2 + AC#3 — kun indehaveren må melde færdig ──────────────────

/** Færdigmelding MED et worker-navn. */
const meldFaerdig = (worker?: string) =>
  kald(`/documents/${DOC}/local-compiled`, worker ? { worker } : {});

/**
 * Frisk udgangspunkt: parkeret OG uden reservation.
 *
 * `parker()` ovenfor rydder kun flaget. Prøverne under her blev først skrevet
 * med den alene og var røde af en grund der intet havde med koden at gøre — en
 * tidligere prøve i filen havde efterladt «mac-4» på leasen. En prøve der
 * arver en tilstand måler ikke det den siger den måler.
 */
async function friskKilde(): Promise<void> {
  await trail.db.update(documents)
    .set({
      awaitingLocalCompile: true, status: 'ready',
      compileClaimedBy: null, compileLeaseUntil: null,
    })
    .where(eq(documents.id, DOC)).run();
}

test('AC#2 DEN BÆRENDE: arbejder B kan ikke melde A\'s kilde færdig', async () => {
  await friskKilde();
  expect(await claim('mac-A')).toEqual([DOC]);

  const res = await meldFaerdig('mac-B');
  expect(res.status).toBe(409);
  const b = (await res.json()) as { error: string; heldBy: string };
  expect(b.error).toBe('compile-lease-held');
  expect(b.heldBy).toBe('mac-A');

  // LÆST TILBAGE FRA BASEN: flaget står stadig, arbejdet er ikke tabt.
  const r = await trail.db
    .select({ venter: documents.awaitingLocalCompile })
    .from(documents).where(eq(documents.id, DOC)).get();
  expect(r?.venter).toBe(true);
  expect((await lease()).by).toBe('mac-A');   // A holder den stadig
});

test('AC#3 NEGATIV KONTROL: A\'s EGET kald lykkes — porten rammer ikke ægte arbejde', async () => {
  // Uden denne ville «afvis alle» bestå lige så grønt som en port der virker.
  expect((await lease()).by).toBe('mac-A');
  const res = await meldFaerdig('mac-A');
  expect(res.status).toBe(200);
  const efter = await lease();
  expect(efter.by).toBeNull();
});

test('AC#3 en kilde INGEN holder kan meldes færdig af hvem som helst', async () => {
  // Den håndkørte vej har aldrig claimet. En port der krævede en lease ville
  // brække hver eksisterende kalder — kortets egen betingelse.
  await friskKilde();
  expect((await lease()).by).toBeNull();
  expect((await meldFaerdig('en-tilfaeldig')).status).toBe(200);
});

test('UDEN worker-navn: accepteret, men svaret SIGER at det ikke kunne afgøres', async () => {
  // To-trins udrulningen. Målt før porten blev skrevet: hverken skillet eller
  // den eksisterende prøve sendte et navn. En hård port ville have afvist den
  // eneste vej der findes i drift.
  await friskKilde();
  expect(await claim('mac-A')).toEqual([DOC]);

  const res = await meldFaerdig();               // intet navn
  expect(res.status).toBe(200);
  const b = (await res.json()) as { warning?: string; heldBy?: string };
  expect(b.warning).toContain('kunne derfor ikke afgøres');
  expect(b.heldBy).toBe('mac-A');
});

test('NEGATIV KONTROL på advarslen: den udebliver når ingen holder kilden', async () => {
  // Uden den ville «advar altid» bestå, og advarslen blive til støj man overser.
  await friskKilde();
  const res = await meldFaerdig();
  expect(res.status).toBe(200);
  expect((await res.json() as { warning?: string }).warning).toBeUndefined();
});

test('en UDLØBET lease spærrer ikke — den døde arbejder holder ikke kilden', async () => {
  await friskKilde();
  await claim('mac-A');
  await trail.db.update(documents)
    .set({ compileLeaseUntil: new Date(Date.now() - 1000).toISOString() })
    .where(eq(documents.id, DOC)).run();

  expect((await meldFaerdig('mac-B')).status).toBe(200);
});

// ── F263.16 AC#4 — wiki-write skal SIGE at en anden arbejder i Brainen ─────

// `resolveKbId` slår et ikke-UUID op på SLUG, ikke på id. Prøve-Brainen har
// id «kb-lease» og slug «kb» — første udgave sendte id'et og fik 404. Det er en
// fikstur-fejl, ikke en kode-fejl, og den står her så den næste ikke gentager den.
const KB_SLUG = 'kb';

const skriv = (worker?: string) =>
  kald(`/knowledge-bases/${KB_SLUG}/wiki-write`, {
    command: 'create',
    path: '/neurons/proever/',
    title: `F263.16 samtidig skrivning ${Date.now()}`,
    content: 'En Neuron skrevet mens en anden arbejder holder en kilde.',
    ...(worker ? { worker } : {}),
  });

test('AC#4 DEN BÆRENDE: B skriver mens A holder en kilde → svaret NAVNGIVER A', async () => {
  // Målt 15./16. september: to sessioner kompilerede samme kilde. Svaret på hver
  // af mine skrivninger var `{ok:true}` — identisk med en skrivning ingen rørte.
  await friskKilde();
  expect(await claim('mac-A')).toEqual([DOC]);

  const res = await skriv('mac-B');
  expect(res.status).toBe(200);
  const b = (await res.json()) as {
    ok: boolean;
    warning?: string;
    heldBy?: Array<{ worker: string; filename: string }>;
  };
  expect(b.ok).toBe(true);                       // skrivningen lykkes STADIG
  expect(b.warning).toContain('mac-A');
  expect(b.warning).toContain('kilde.md');
  expect(b.heldBy?.[0]?.worker).toBe('mac-A');
});

test('AC#4 ingen sourceDocumentId kræves — den kigger på HELE Brainen', async () => {
  // Netop dét felt manglede i alle mine kald den nat. En kontrol der krævede
  // det ville have været tavs i præcis den sag den findes for.
  expect((await lease()).by).toBe('mac-A');
  const b = (await (await skriv('mac-B')).json()) as { warning?: string };
  expect(b.warning).toBeDefined();               // uden sourceDocumentId i kaldet
});

test('NEGATIV KONTROL: INGEN advarsel når ingen holder noget', async () => {
  // Uden den ville «advar altid» bestå lige så grønt, og advarslen blive til
  // støj man holder op med at læse.
  await friskKilde();
  const b = (await (await skriv('mac-B')).json()) as { ok: boolean; warning?: string };
  expect(b.ok).toBe(true);
  expect(b.warning).toBeUndefined();
});

test('INDEHAVEREN selv advares ikke om sit eget arbejde', async () => {
  await friskKilde();
  await claim('mac-A');
  const b = (await (await skriv('mac-A')).json()) as { warning?: string };
  expect(b.warning).toBeUndefined();
});

// ── F263.16 AC#5 — vagten mod en port der kun findes i et modul ────────────

import { readFileSync } from 'node:fs';

test('AC#5 INTEGRATION: lease-tjekket er MONTERET, ikke kun skrevet', async () => {
  // En port kan være perfekt og have nul kaldesteder. Denne prøve læser
  // KILDEN til den rute `/local-ingest` faktisk rammer, og kræver at
  // betingelsen står dér — ikke i en hjælpefunktion ingen kalder.
  const kilde = readFileSync(
    new URL('../routes/documents.ts', import.meta.url), 'utf8',
  );

  // POSITIV KONTROL FØRST: kan vi overhovedet læse filen og finde ruten?
  // Uden den ville en flyttet fil give en tom streng, og hver fraværs-påstand
  // nedenfor ville bestå grønt på ingenting.
  expect(kilde.length).toBeGreaterThan(1000);
  expect(kilde).toContain("documentRoutes.post('/documents/:docId/local-compiled'");
  expect(kilde).toContain("documentRoutes.post('/knowledge-bases/:kbId/wiki-write'");

  // Selve påstanden: begge ruter læser lease-felterne.
  expect(kilde).toContain('compile-lease-held');
  expect(kilde).toContain('documents.compileClaimedBy');
  expect(kilde).toContain('documents.compileLeaseUntil');
});

test('AC#5 NEGATIV KONTROL: prøven kan faktisk sige NEJ', async () => {
  // En fraværs-påstand beviser intet før instrumentet er vist at kunne fejle.
  const kilde = readFileSync(
    new URL('../routes/documents.ts', import.meta.url), 'utf8',
  );
  expect(kilde).not.toContain('en-streng-der-med-sikkerhed-ikke-staar-i-filen');
});

// ── F263.16 AC#8/#9 — «færdig» skal binde til et INDHOLD ───────────────────

/** Sæt kildens indhold + hash, som en site-sync eller en ny upload ville. */
async function skrivKilde(indhold: string, hash: string): Promise<void> {
  await trail.db.update(documents)
    .set({ content: indhold, contentHash: hash })
    .where(eq(documents.id, DOC)).run();
}

/** Er kilden i kø? Læst gennem den RIGTIGE rute, ikke fra kolonnen. */
async function iKoe(): Promise<boolean> {
  const res = await app.request(
    `http://engine.local/api/v1/documents?awaitingLocalCompile=true`,
    { headers: { Cookie: 'session=sess-lease' } },
  );
  const b = (await res.json()) as { documents?: Array<{ id: string }> };
  return (b.documents ?? []).some((d) => d.id === DOC);
}

test('AC#8 DEN BÆRENDE: en kilde der REDIGERES efter kompilering venter igen', async () => {
  await friskKilde();
  await skrivKilde('version 1', 'hash-v1');
  expect(await iKoe()).toBe(true);

  await claim('mac-A');
  expect((await meldFaerdig('mac-A')).status).toBe(200);
  expect(await iKoe()).toBe(false);              // kompileret, ude af køen

  // Kilden skrives om — præcis som broberg.ai-siden gjorde v5→v14 i nat.
  await skrivKilde('version 2', 'hash-v2');
  expect(await iKoe()).toBe(true);               // ← den genåbner sig selv
});

test('AC#8 NEGATIV KONTROL: en UÆNDRET kilde genåbnes IKKE', async () => {
  // Uden den ville «genåbn altid» bestå lige så grønt, og køen aldrig tømmes.
  await friskKilde();
  await skrivKilde('uændret', 'hash-samme');
  await claim('mac-A');
  await meldFaerdig('mac-A');
  expect(await iKoe()).toBe(false);
  expect(await iKoe()).toBe(false);              // og bliver ved med at være det
});

test('DEN TREDJE TILSTAND: localCompiledHash = NULL genåbner ingenting', async () => {
  // Hver eksisterende række i basen har NULL efter migreringen. Blev NULL læst
  // som «afviger», ville HELE basen genåbne sig selv i det sekund den kørte.
  await friskKilde();
  await skrivKilde('aldrig kompileret', 'hash-x');
  await trail.db.update(documents)
    .set({ awaitingLocalCompile: false, localCompiledHash: null })
    .where(eq(documents.id, DOC)).run();
  expect(await iKoe()).toBe(false);
});

test('AC#9: en færdigmelding på en FORÆLDET version afvises', async () => {
  await friskKilde();
  await skrivKilde('den nye tekst', 'hash-ny');
  await claim('mac-A');

  const res = await kald(`/documents/${DOC}/local-compiled`, {
    worker: 'mac-A', contentHash: 'hash-gammel',
  });
  expect(res.status).toBe(409);
  const b = (await res.json()) as { error: string; currentHash: string };
  expect(b.error).toBe('source-changed-under-you');
  expect(b.currentHash).toBe('hash-ny');

  // FRISK LÆSNING FRA BASEN: flaget står stadig — arbejdet er ikke meldt færdigt.
  //
  // Bemærk at der IKKE asserteres på «er den i køen». `kanTagesNu` spørger om
  // kilden er LEDIG, og mac-A holder stadig sin lease — så den er ventende og
  // ikke-ledig på én gang. To forskellige spørgsmål, og AC#9 stiller det første.
  const r = await trail.db
    .select({ venter: documents.awaitingLocalCompile, kompileret: documents.localCompiledHash })
    .from(documents).where(eq(documents.id, DOC)).get();
  expect(r?.venter).toBe(true);
  expect(r?.kompileret).toBeNull();      // intet blev bogført som kompileret
});

test('AC#9 NEGATIV KONTROL: den RIGTIGE hash slipper igennem', async () => {
  const res = await kald(`/documents/${DOC}/local-compiled`, {
    worker: 'mac-A', contentHash: 'hash-ny',
  });
  expect(res.status).toBe(200);
  expect(await iKoe()).toBe(false);
});

test('VAGT: hvert skrivested der ændrer en KILDES indhold flytter også hash\'en', () => {
  // Fundet af en live-kontrol EFTER udrulning: genåbningen var inert på
  // local-vision, fordi `contentHash` stod uændret. En forældet hash er værre
  // end ingen — den siger «uændret» med selvtillid.
  //
  // Vagten læser kilden og kræver at hvert `.set({ content` på documents i
  // denne fil også bærer `contentHash`. Et tredje skrivested kan så ikke
  // glemme den i stilhed.
  const kilde = readFileSync(
    new URL('../routes/documents.ts', import.meta.url), 'utf8',
  );

  // POSITIV KONTROL: kan vagten overhovedet finde et skrivested?
  const skrivninger = [...kilde.matchAll(/\.set\(\{\s*content[,\s]/g)];
  expect(skrivninger.length).toBeGreaterThan(0);

  for (const m of skrivninger) {
    const uddrag = kilde.slice(m.index!, m.index! + 220);
    expect(uddrag, `skrivested uden contentHash:\n${uddrag.slice(0, 160)}`)
      .toContain('contentHash');
  }
});

test('VAGT NEGATIV KONTROL: mønsteret matcher faktisk noget', () => {
  // En fraværs-påstand beviser intet før instrumentet er vist at kunne finde.
  const kilde = readFileSync(
    new URL('../routes/documents.ts', import.meta.url), 'utf8',
  );
  expect([...kilde.matchAll(/\.set\(\{\s*content[,\s]/g)].length).toBe(1);
});
