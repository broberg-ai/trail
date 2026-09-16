/**
 * F263.1 — prøver for jobkøen.
 *
 * DEN BÆRENDE PÅSTAND ER EN SAMTIDIGHEDS-PÅSTAND, og den kan kun prøves ved at
 * køre to claims mod samme kø og se på SNITTET. En prøve der claimer én gang og
 * konstaterer at der kom et job ud, ville være grøn på præcis den kode kortet
 * findes for at erstatte — flaget uden lease giver også et job.
 *
 * Derfor er hver positiv påstand parret med en negativ kontrol i modsat retning.
 */
import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibsqlDatabase, type TrailDatabase } from '@trail/db';
import {
  claimCompileJobs, heartbeatCompileJob, compileQueueStatus,
  COMPILE_LEASE_MS,
} from './compile-queue.js';

const dir = mkdtempSync(join(tmpdir(), 'f263-'));
let db: TrailDatabase;
const A = 't-a', B = 't-b', KB = 'kb-1', KB_B = 'kb-b';
// F263.9 — en ANDEN Trail hos SAMME kunde. Tenant-akse og Trail-akse er to
// forskellige spørgsmål, og kb-b ligger hos kunde B, så den kan ikke svare på
// det andet. Uden kb-2 kunne prøven ikke skelne dem.
const KB2 = 'kb-2';

async function kilde(id: string, o: { tenant?: string; kb?: string; venter?: number; kind?: string; tid?: string } = {}) {
  await db.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, filename, file_type, path,
                            title, content, kind, archived, awaiting_local_compile, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
    [id, o.tenant ?? A, o.kb ?? KB, 'u-1', `${id}.md`, 'md', '/', id, 'krop',
     o.kind ?? 'source', o.venter ?? 1, o.tid ?? `2026-01-01T00:00:0${id.slice(-1)}Z`, '2026-01-01'],
  );
}

beforeAll(async () => {
  db = await createLibsqlDatabase({ path: join(dir, 'f263.db') });
  await db.runMigrations();
  for (const [t, s] of [[A, 'ta'], [B, 'tb']] as const)
    await db.execute(`INSERT INTO tenants (id, slug, name) VALUES (?,?,?)`, [t, s, s]);
  await db.execute(`INSERT INTO users (id, tenant_id, email, role) VALUES (?,?,?,?)`, ['u-1', A, 'a@b.dk', 'owner']);
  await db.execute(`INSERT INTO users (id, tenant_id, email, role) VALUES (?,?,?,?)`, ['u-2', B, 'b@b.dk', 'owner']);
  await db.execute(`INSERT INTO knowledge_bases (id, tenant_id, created_by, slug, name) VALUES (?,?,?,?,?)`, [KB, A, 'u-1', 'kb1', 'KB1']);
  await db.execute(`INSERT INTO knowledge_bases (id, tenant_id, created_by, slug, name) VALUES (?,?,?,?,?)`, [KB_B, B, 'u-2', 'kbb', 'KBB']);
  await db.execute(`INSERT INTO knowledge_bases (id, tenant_id, created_by, slug, name) VALUES (?,?,?,?,?)`, [KB2, A, 'u-1', 'kb2', 'KB2']);
});
afterAll(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

beforeEach(async () => {
  await db.execute(`DELETE FROM documents`);
});

test('MIGRATIONEN LANDEDE: lease-kolonnerne findes', async () => {
  // Uden den er alt nedenfor grønt af den forkerte grund — en manglende
  // kolonne ville få claim til at kaste, ikke til at svare forkert, men
  // påstanden hører alligevel eksplicit hjemme her.
  const kol = (await db.execute(`SELECT name FROM pragma_table_info('documents')`))
    .rows.map((r: { name?: unknown }) => String(r.name));
  expect(kol).toContain('compile_claimed_by');
  expect(kol).toContain('compile_lease_until');
});

test('to arbejdere der claimer får DISJUNKTE jobs', async () => {
  for (const i of [1, 2, 3, 4]) await kilde(`s${i}`);
  const a = await claimCompileJobs(db, A, { worker: 'mac-1', limit: 2 });
  const b = await claimCompileJobs(db, A, { worker: 'mac-2', limit: 2 });
  const ida = a.map((j) => j.id), idb = b.map((j) => j.id);
  expect(ida).toHaveLength(2);
  expect(idb).toHaveLength(2);
  const snit = ida.filter((x) => idb.includes(x));
  expect(snit).toEqual([]);            // ← hele kortets eksistensberettigelse
});

test('NEGATIV KONTROL: en tom kø giver ingen jobs, ikke en fejl', async () => {
  // Uden den ville «snittet er tomt» bestå på to claims der begge fik nul.
  expect(await claimCompileJobs(db, A, { worker: 'mac-1', limit: 2 })).toEqual([]);
});

test('et job med LEVENDE lease kan ikke tages af en anden', async () => {
  await kilde('s1');
  const a = await claimCompileJobs(db, A, { worker: 'mac-1' });
  expect(a).toHaveLength(1);
  expect(await claimCompileJobs(db, A, { worker: 'mac-2' })).toEqual([]);
});

test('et job med UDLØBET lease bliver ledigt igen', async () => {
  await kilde('s1');
  await claimCompileJobs(db, A, { worker: 'mac-1', leaseMs: -1000 }); // allerede udløbet
  const b = await claimCompileJobs(db, A, { worker: 'mac-2' });
  expect(b.map((j) => j.id)).toEqual(['s1']);
});

test('heartbeat forlænger leasen — jobbet bliver IKKE ledigt', async () => {
  await kilde('s1');
  await claimCompileJobs(db, A, { worker: 'mac-1', leaseMs: -1000 });
  const hb = await heartbeatCompileJob(db, A, { docId: 's1', worker: 'mac-1' });
  expect(hb.ok).toBe(true);
  expect(await claimCompileJobs(db, A, { worker: 'mac-2' })).toEqual([]);
});

test('heartbeat fra en ANDEN arbejder afvises', async () => {
  // Ellers kunne en arbejder holde liv i et job en anden havde overtaget, og
  // så ville to være i gang med samme kilde med systemets velsignelse.
  await kilde('s1');
  await claimCompileJobs(db, A, { worker: 'mac-1' });
  const hb = await heartbeatCompileJob(db, A, { docId: 's1', worker: 'mac-2' });
  expect(hb.ok).toBe(false);
});

test('TENANT-ISOLATION: kunde A kan aldrig claime kunde B\'s job', async () => {
  await kilde('a1', { tenant: A, kb: KB });
  await kilde('b1', { tenant: B, kb: KB_B });
  const a = await claimCompileJobs(db, A, { worker: 'mac-1', limit: 10 });
  expect(a.map((j) => j.id)).toEqual(['a1']);
  const b = await claimCompileJobs(db, B, { worker: 'mac-1', limit: 10 });
  expect(b.map((j) => j.id)).toEqual(['b1']);
});

test('kun kilder der VENTER, og kun kind=source', async () => {
  await kilde('venter');
  await kilde('faerdig', { venter: 0 });
  await kilde('neuron', { kind: 'wiki' });
  const a = await claimCompileJobs(db, A, { worker: 'mac-1', limit: 10 });
  expect(a.map((j) => j.id)).toEqual(['venter']);
});

test('status skelner VENTENDE fra I ARBEJDE og navngiver arbejderen', async () => {
  await kilde('s1'); await kilde('s2');
  await claimCompileJobs(db, A, { worker: 'christians-macbook' });
  const s = await compileQueueStatus(db, A);
  expect(s).toEqual({ waiting: 1, working: 1, workers: ['christians-macbook'] });
});

test('leasen er ÉN navngiven konstant, ikke et tal i koden', () => {
  // F263.16 — denne fastholdt tidligere tallet ORDRET (5 * 60_000). Et
  // literal-pin skal redigeres hver gang værdien lovligt ændres, og lærer
  // dermed den næste at rette prøven uden at tænke. Den fastholder nu
  // BEGRUNDELSEN i stedet — se «fristen er ÉT tal» nedenfor, som binder
  // værdien til de målte varigheder frem for til et ciffer.
  expect(typeof COMPILE_LEASE_MS).toBe('number');
  expect(COMPILE_LEASE_MS).toBeGreaterThan(0);
});

// ── Regression: den HÅNDKØRTE vej må ikke ændre sig ────────────────────────
//
// Køen er ship dark. `/local-ingest` skal kunne køre uændret ved siden af,
// indtil en klient beviseligt drænner køen i drift. En naken omlægning — at
// slukke den gamle vej før afløseren er bevist — er præcis det repoets
// harness-kontrakt forbyder.

test('REGRESSION: en claimet kilde er STADIG i den gamle awaiting-liste', async () => {
  // Det gamle GET ?awaitingLocalCompile=true filtrerer kun på flaget. En
  // reservation må ikke skjule kilden for den håndkørte vej — så ville den nye
  // kø have slukket den gamle uden at nogen besluttede det.
  await kilde('s1');
  await claimCompileJobs(db, A, { worker: 'mac-1' });
  const r = (await db.execute(
    `SELECT COUNT(*) AS n FROM documents
      WHERE tenant_id = ? AND awaiting_local_compile = 1`, [A])).rows[0] as { n: unknown };
  expect(Number(r.n)).toBe(1);
});

test('REGRESSION: lease-kolonnerne er TOMME på en kilde ingen har claimet', async () => {
  // Migrationen må ikke give eksisterende rækker en værdi der får dem til at
  // se reserverede ud — 132 rå kilder ligger i produktionsbasen i forvejen.
  await kilde('s1');
  const r = (await db.execute(
    `SELECT compile_claimed_by AS w, compile_lease_until AS l FROM documents WHERE id='s1'`)).rows[0] as
    { w: unknown; l: unknown };
  expect(r.w).toBeNull();
  expect(r.l).toBeNull();
  // …og den er dermed ledig for den allerførste arbejder.
  expect((await claimCompileJobs(db, A, { worker: 'mac-1' })).map((j) => j.id)).toEqual(['s1']);
});

/**
 * F263.9 — KØ-LINJEN STÅR PÅ ÉN TRAILS SIDE, SÅ DEN SKAL SVARE OM DEN TRAIL.
 *
 * Fejlen den erstatter: endepunktet svarede tenant-bredt, mens svaret blev vist
 * på én Trails Kilder-side. Målt på prod havde kunden ELLEVE Trails, så
 * «1 compiling» kunne være arbejde i en helt anden. Den der læser står på en
 * bestemt Trail og konkluderer rimeligvis at det er DEN der kompilerer.
 *
 * De to påstande her kan ikke bestå af samme grund: den ene kræver at det
 * fremmede IKKE tælles med, den anden at det brede svar stadig tæller det.
 * Uden nummer to ville «kbId returnerer altid nul» bestå.
 */
test('F263.9 kbId TÆLLER KUN sin egen Trail — nabo-Trailen hos samme kunde holdes ude', async () => {
  await kilde('d1', { kb: KB });     // hjemme
  await kilde('d2', { kb: KB2 });    // nabo, SAMME kunde
  await kilde('d3', { kb: KB2 });    // nabo

  const kun = await compileQueueStatus(db, A, new Date(), KB);
  expect(kun.waiting).toBe(1);
  expect(kun.working).toBe(0);

  const nabo = await compileQueueStatus(db, A, new Date(), KB2);
  expect(nabo.waiting).toBe(2);
});

test('F263.9 NEGATIV KONTROL: uden kbId er svaret stadig tenant-bredt', async () => {
  // Ambients vagt og /local-ingest arbejder tenant-bredt — én maskine tømmer
  // hele kunden. Snævredes det brede svar også ind, ville de holde op med at
  // se arbejde de skal tage. Så den her prøve beskytter den ANDEN kaldevej.
  await kilde('d1', { kb: KB });
  await kilde('d2', { kb: KB2 });
  await kilde('d3', { kb: KB2 });

  const bredt = await compileQueueStatus(db, A);
  expect(bredt.waiting).toBe(3);
});

test('F263.9 arbejderen navngives kun for den Trail der faktisk kompilerer', async () => {
  // «Hvem arbejder» led af nøjagtig samme fejl som tallene: maskinnavnet blev
  // hentet tenant-bredt, så en Trail uden arbejde kunne vise en maskine.
  await kilde('d1', { kb: KB });
  await kilde('d2', { kb: KB2 });
  const fremtid = new Date(Date.now() + 60_000).toISOString();
  await db.execute(
    `UPDATE documents SET compile_claimed_by = ?, compile_lease_until = ? WHERE id = ?`,
    ['nabo-maskine', fremtid, 'd2'],
  );

  const hjemme = await compileQueueStatus(db, A, new Date(), KB);
  expect(hjemme.workers).toEqual([]);        // ingen maskine HER
  expect(hjemme.working).toBe(0);

  const nabo = await compileQueueStatus(db, A, new Date(), KB2);
  expect(nabo.workers).toEqual(['nabo-maskine']);
  expect(nabo.working).toBe(1);
});

// ── F263.16 AC#1 — leasen skal holde et ÆGTE stykke arbejde ────────────────

const MIN = 60_000;

test('F263.16 DEN BÆRENDE: leasen overlever 300 s UDEN hjerteslag', async () => {
  // Den gamle frist var 300 s, sat efter en SKY-kompilering på 10–90 sekunder.
  // Den lokale arbejder er en cc-session. Målt på hændelsen kortet blev skrevet
  // om: trail-ingest claimede ≈22:01:31Z med lease til 22:06:31Z og meldte
  // færdig 22:07:37Z — leasen udløb MENS de arbejdede.
  await kilde('lease-1');
  const t0 = new Date('2026-09-16T10:00:00Z');
  const a = await claimCompileJobs(db, A, { worker: 'arbejder-A', now: t0 });
  expect(a.map((j) => j.id)).toContain('lease-1');

  // 301 sekunder senere, uden ét eneste hjerteslag: kilden er STADIG A's.
  const efterGammelFrist = new Date(t0.getTime() + 301_000);
  const b = await claimCompileJobs(db, A, { worker: 'arbejder-B', now: efterGammelFrist });
  expect(b.map((j) => j.id)).not.toContain('lease-1');

  // Og efter et helt normalt 20-minutters arbejde er den det stadig.
  const efterTyveMin = new Date(t0.getTime() + 20 * MIN);
  const c = await claimCompileJobs(db, A, { worker: 'arbejder-B', now: efterTyveMin });
  expect(c.map((j) => j.id)).not.toContain('lease-1');
});

test('NEGATIV KONTROL: leasen kan stadig udløbe — en død arbejder spærrer ikke for evigt', async () => {
  // Uden denne ville «leasen udløber aldrig» bestå lige så grønt som en
  // rigtig frist, og en arbejder der dør ville låse kilden permanent.
  await kilde('lease-2');
  const t0 = new Date('2026-09-16T11:00:00Z');
  await claimCompileJobs(db, A, { worker: 'arbejder-A', now: t0 });

  const efterFristen = new Date(t0.getTime() + COMPILE_LEASE_MS + 1_000);
  const b = await claimCompileJobs(db, A, { worker: 'arbejder-B', now: efterFristen });
  expect(b.map((j) => j.id)).toContain('lease-2');
});

test('fristen er ÉT tal, og det dækker den målte virkelighed', async () => {
  // En prøve på konstanten selv, så en «oprydning» der sætter den tilbage til
  // fem minutter ikke kan ske i stilhed. Nedre grænse er den målte 20-minutters
  // kompilering; øvre grænse er at en død arbejder ikke må spærre en aften.
  expect(COMPILE_LEASE_MS).toBeGreaterThanOrEqual(20 * MIN);
  expect(COMPILE_LEASE_MS).toBeLessThanOrEqual(60 * MIN);
});
