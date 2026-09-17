/**
 * F281.1 — et tilbageholdt kompileringsjob må ALDRIG kalde sig selv i ring.
 *
 * Når kapaciteten er fuld, skal jobbet blive liggende i køen og vente på den
 * periodiske planlægger. Det gjorde det ikke: dræningsblokken i `claimAndRun`
 * fandt præcis det job vi lige havde lagt fra os, og kaldte sig selv igen med
 * det samme — i ring, uden pause.
 *
 * MÅLT 17/9 2026 på serverens egen prøvesuite: 686.041 lines
 * «[backpressure] holding job_… — global-concurrency» og en logfil på 62 MB
 * på få sekunder. Suiten nåede aldrig at blive færdig.
 *
 * Presset skabes med TENANT-RATEN og ikke med det globale cap, fordi
 * `runningLocally` er delt modul-tilstand: en tidligere prøvefil kan have
 * efterladt Brains i den, og så ville prøven bestå eller fejle af en anden
 * grund end sin egen. 60 rækker rammer standardloftet uanset rækkefølge.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import {
  createLibsqlDatabase,
  tenants,
  users,
  knowledgeBases,
  documents,
  ingestJobs,
} from '@trail/db';
import { triggerIngest } from './ingest.js';
import { DEFAULT_BACKPRESSURE } from '@trail/shared';

const T = 't-ring', U = 'u-ring', KB = 'kb-ring';
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;
let heldJobId: string | undefined;

/** Fylder tenantens time-vindue helt op. */
async function fillHourlyWindow(): Promise<void> {
  const nu = new Date().toISOString();
  for (let i = 0; i < DEFAULT_BACKPRESSURE.maxPerHourPerTenant; i++) {
    await trail.db.insert(ingestJobs).values({
      id: `job-fyld-${i}`, tenantId: T, knowledgeBaseId: KB,
      documentId: 'doc-ring', status: 'done', startedAt: nu,
    }).run();
  }
}

async function clearHourlyWindow(): Promise<void> {
  for (let i = 0; i < DEFAULT_BACKPRESSURE.maxPerHourPerTenant; i++)
    await trail.db.delete(ingestJobs).where(eq(ingestJobs.id, `job-fyld-${i}`)).run();
}

/**
 * Kører `fn` og tæller hvor mange «holding»-lines den skrev.
 *
 * NØDBREMSEN er ikke pynt. Ringen er en kæde af await'ede DB-kald, altså rene
 * mikro-opgaver — den sulter timerne, så en `setTimeout`-ventetid aldrig
 * udløses. Uden bremsen HÆNGER prøven i stedet for at fejle, og en prøve der
 * hænger rapporterer ingenting. Målt: prøven blev dræbt after 120 sekunder
 * med en tom log, fordi `console.log` var opsnappet.
 *
 * Bremsen arkiverer kilden. Næste runde i ringen ser en arkiveret source,
 * annullerer jobbet og stopper — uden at starte en real kompilering.
 */
async function countHoldingLines(fn: () => void, waitMs: number, cap = 200): Promise<number> {
  const real = console.log;
  let n = 0;
  let braked = false;
  console.log = (...a: unknown[]) => {
    if (typeof a[0] !== 'string' || !a[0].includes('[backpressure] holding')) return;
    n++;
    if (n >= cap && !braked) {
      braked = true;
      void trail.db.update(documents).set({ archived: true })
        .where(eq(documents.id, 'doc-ring')).run();
    }
  };
  try {
    fn();
    await new Promise((r) => setTimeout(r, waitMs));
  } finally {
    console.log = real;
  }
  return n;
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `ring-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'ring', name: 'Ring', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'r@ring.dk', displayName: 'R', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Ring', slug: KB, language: 'da' }).run();
  await trail.db.insert(documents).values({
    id: 'doc-ring', tenantId: T, knowledgeBaseId: KB, userId: U, kind: 'source',
    filename: 'r.md', fileType: 'md', fileSize: 10, status: 'pending',
  }).run();
});

afterAll(() => { try { trail?.close?.(); } catch { /* lukket */ } });

test('DEN BÆRENDE: et tilbageholdt job skriver ÉN holding-linje, ikke tusinder', async () => {
  await fillHourlyWindow();

  const lines = await countHoldingLines(
    () => triggerIngest({ trail, docId: 'doc-ring', kbId: KB, tenantId: T, userId: U }),
    400,
  );

  // Før rettelsen: titusinder på 400 ms. Loftet er sat lavt nok til at en
  // ring ikke kan snige sig under det, og højt nok til at en enkelt ekstra
  // periodisk tik ikke gør prøven flaky.
  expect(lines).toBeLessThanOrEqual(3);
  expect(lines).toBeGreaterThanOrEqual(1);   // POSITIV KONTROL: presset virkede

  const holdt = await trail.db.select().from(ingestJobs)
    .where(eq(ingestJobs.documentId, 'doc-ring')).all();
  heldJobId = holdt.find((j) => j.status === 'queued')?.id;
  expect(heldJobId).toBeString();
});

test('JOBBET BLIVER IKKE HÆNGENDE: det ligger stadig i kø og bliver pickedUp af næste tik', async () => {
  const afterHold = await trail.db.select().from(ingestJobs)
    .where(eq(ingestJobs.id, heldJobId!)).get();
  expect(afterHold?.status).toBe('queued');   // ikke tabt, ikke fejlet

  // Frigiv kapaciteten og tik Brain'en igen — nøjagtig det samme
  // `tickScheduler`-kald som den periodiske planlægger laver hvert 30. sekund.
  //
  // Kilden arkiveres først, så jobbet afsluttes på den udgang der IKKE
  // starter en real — og betalt — kompilering. Prøven beviser altså at det
  // tilbageholdte job bliver TAGET op igen af et senere tik; den beviser
  // ikke en fuld kompilering, og det påstår den heller ikke.
  await clearHourlyWindow();
  await trail.db.update(documents).set({ archived: true })
    .where(eq(documents.id, 'doc-ring')).run();
  triggerIngest({ trail, docId: 'doc-ring', kbId: KB, tenantId: T, userId: U });
  await new Promise((r) => setTimeout(r, 400));

  const pickedUp = await trail.db.select().from(ingestJobs)
    .where(eq(ingestJobs.id, heldJobId!)).get();
  expect(pickedUp?.status).not.toBe('queued');   // planlæggeren tog det
});
