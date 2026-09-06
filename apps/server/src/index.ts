import { createLibsqlDatabase, DEFAULT_DB_PATH, type TrailDatabase } from '@trail/db';
import { createApp } from './app.js';
import {
  openTenantPool,
  inferPrimarySlug,
  provisionTenant,
  remoteTenantConfig,
  openRemoteTenantDb,
} from './lib/tenant-pool.js';
import { ensureIngestUser } from './bootstrap/ingest-user.js';
import { seedTenantIdentity } from './bootstrap/seed-tenant.js';
import { recoverZombieIngests } from './bootstrap/zombie-ingest.js';
import { rewriteWikiToNeurons } from './bootstrap/rewrite-wiki-paths.js';
import { cleanupExternalOrphans } from './bootstrap/F98-cleanup-external-orphans.js';
import { seedMissingGlossaryNeurons } from './bootstrap/F102-seed-glossary-neurons.js';
import { recoverPendingSources } from './bootstrap/recover-pending-sources.js';
import { seedDevCreditsOnBoot } from './bootstrap/dev-credits.js';
import { backfillContentHash } from './bootstrap/backfill-content-hash.js';
import { backfillDocumentImages } from './bootstrap/backfill-document-images.js';
import { rerunVisionOnNull } from './bootstrap/rerun-vision.js';
import { fixImageSlash } from './bootstrap/fix-image-slash.js';
import { sweepAutoFlag } from './bootstrap/sweep-auto-flag.js';
import { recoverIngestJobs, startBackpressureScheduler } from './services/ingest.js';
import { startContradictionLint } from './services/contradiction-lint.js';
import { backfillReferences, startReferenceExtractor } from './services/reference-extractor.js';
import { backfillBacklinks, startBacklinkExtractor } from './services/backlink-extractor.js';
import { backfillLinkCheck, startLinkChecker } from './services/link-checker.js';
import { startLintScheduler } from './services/lint-scheduler.js';
import { startIndexScheduler } from './services/index-scheduler.js';
import { startConfidenceDecay } from './services/confidence-decay.js';
import { startQueueBackfill } from './services/queue-backfill.js';
import { startActionRecommender, backfillRecommendations } from './services/action-recommender.js';
import { startActivityLogger } from './services/activity-logger.js';
import { startUploadSessionGc } from './services/upload-session-gc.js';
import { initJobRunner } from './services/jobs/runner.js';
import { noopHandler } from './services/jobs/handlers/noop.js';
import { visionRerunHandler } from './services/jobs/handlers/vision-rerun.js';
import { imageTriageHandler } from './services/jobs/handlers/image-triage.js';
import { init as upInit, setTag } from '@upmetrics/sdk';
import { UPMETRICS_DSN, reportDeploy } from '@trail/shared';

// Upmetrics fleet-dogfooding — server-side error capture for every engine
// (engine-001 … N). DSN is the single source from @trail/shared, compiled in,
// so every engine — incl. F169-spawned ones — auto-reports with zero config.
// Gated on FLY_APP_NAME so it only runs on Fly. captureException is wired into
// the Hono onError in app.ts. Per-engine identity via setTag('server', …) so
// engine-001 vs engine-002 are distinguishable under the shared release.
if (process.env.FLY_APP_NAME) {
  upInit({
    dsn: UPMETRICS_DSN,
    environment: process.env.NODE_ENV,
    release: 'trail-engine',
    autoInstrument: false,
  });
  setTag('server', process.env.FLY_APP_NAME);
  setTag('machine', process.env.FLY_MACHINE_ID ?? 'unknown');
}

const PORT = Number(process.env.PORT ?? 3031);

// F40.2a-C: per-tenant boot. Each tenant DB gets the same one-shot
// treatment — migrations, FTS init, all backfills/recovery. Called
// once for the primary (boot-time `trail` below) AND for every
// secondary tenant when TRAIL_MULTI_TENANT=1 is set.
//
// Order matters here — keep parity with the historic single-tenant
// boot order. Adding a new tenant via openTenantPool() runs this
// exact sequence against the new DB.
/**
 * F259 — ET TRIN DER TAGER TID SKAL SIGE SIT NAVN.
 *
 * 6/9 stod motoren af i opstarten med 283 sekunders TAVSHED mellem «åbner
 * broberg-ai» og processens død. Loggen kunne ikke sige hvilket af de femten
 * opstartstrin der hang, så diagnosen ville have kostet ét nedbrud pr. gæt.
 * Nu koster den nul: hvert trin over et sekund skriver sit navn og sin tid.
 */
async function trin<T>(slug: string, navn: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - t0;
    if (ms >= 1000) console.log(`[boot] ${slug}/${navn}: ${Math.round(ms / 1000)}s`);
  }
}

/**
 * F259 — DET DER SKAL VÆRE PÅ PLADS FØR EN KUNDE KAN BETJENES.
 *
 * Kun tre ting: skemaet, søgeindekset og den bruger de andre rækker peger på.
 * Alle tre er skema-operationer der ikke skalerer med basens størrelse.
 *
 * ALT ANDET ER VEDLIGEHOLDELSE, og den hører ikke til her. Det er ikke en
 * finpudsning — det er dagens nedbrud: opstarten var ÉN sekventiel kæde, kørt
 * i en top-level await FØR Bun.serve, for HVER kunde. broberg-ai (7.217
 * Neuroner, base på den anden side af netværket) hang i 283 sekunder, kastede
 * en timeout, og en afvist top-level await afslutter processen. Tre kunder lå
 * ned fordi én kundes vedligeholdelse var langsom.
 *
 * Og F258's vagt kunne ikke redde det: den installeres EFTER Bun.serve, og
 * processen døde før den nåede dertil. En vagt der står bag ved fejlen ser
 * rigtig ud i koden og har ingen virkning i praksis.
 */
async function bootTenantEssential(db: TrailDatabase, slug: string): Promise<void> {
  await trin(slug, 'migrations', () => db.runMigrations());
  await trin(slug, 'fts', () => db.initFTS());
  await trin(slug, 'ingest-user', () => ensureIngestUser(db));
}

/**
 * F259 — VEDLIGEHOLDELSE: idempotente engangs-opgaver der må tage den tid de
 * tager, fordi ingen kunde venter på dem. Kørt EFTER Bun.serve, pr. kunde, og
 * en fejl her logges uden at stoppe betjeningen.
 *
 * Den indbyrdes rækkefølge er bevaret fra den historiske opstart.
 */
async function bootTenantMaintenance(db: TrailDatabase, slug: string): Promise<void> {
  await trin(slug, 'recoverZombieIngests', () => recoverZombieIngests(db));
  await trin(slug, 'rewriteWikiToNeurons', () => rewriteWikiToNeurons(db));
  // F98 — dismiss pending orphan-findings targeting external-originated
  // Neurons (buddy, MCP, chat, api). Their sources live outside Trail;
  // the orphan detector used to falsely flag them. Idempotent — zero
  // rows to update after the first run is the steady state.
  await trin(slug, 'cleanupExternalOrphans', () => cleanupExternalOrphans(db));
  // F102 — ensure every KB has /neurons/glossary.md. Idempotent; seeds
  // the Neuron for KBs created before F102 landed so the compile-pipeline
  // has something to str_replace into on subsequent ingests.
  await trin(slug, 'seedMissingGlossaryNeurons', () => seedMissingGlossaryNeurons(db));
  // Re-run extractor on any source stuck in `status='pending'` with a
  // supported file type (pdf/docx/pptx/xlsx). Covers two cases:
  // (1) uploads that predate the extractor for their type (e.g. a PPTX
  // uploaded before the PPTX pipeline shipped), (2) server-crashed-
  // mid-upload rows. Unsupported types stay pending — they need new
  // pipelines. Fire-and-forget: the processXAsync helpers own their
  // status transitions.
  await trin(slug, 'recoverPendingSources', () => recoverPendingSources(db));
  // F162 — populate content_hash on legacy source-rows. Idempotent;
  // once everything is hashed, re-runs are a single SELECT returning 0
  // rows. Must run BEFORE the upload route starts accepting requests
  // (which happens later in this file) so a fresh upload doesn't race
  // the backfill on the same row.
  await trin(slug, 'backfillContentHash', () => backfillContentHash(db));
  // F161 — populate document_images for legacy PDFs. Storage scan +
  // PNG-header dim parse + alt-text from compiled markdown. Idempotent;
  // docs with existing rows skipped. Same boot-window placement
  // argument as backfillContentHash.
  await trin(slug, 'backfillDocumentImages', () => backfillDocumentImages(db));
  // F161 follow-up — opt-in Vision-rerun. OFF by default; only fires
  // when TRAIL_VISION_RERUN_NULL=1 is set. See rerun-vision.ts for
  // the env-flag contract + recommended rollout.
  await trin(slug, 'rerunVisionOnNull', () => rerunVisionOnNull(db));
  // F230.1 — repair image rows whose filename starts with a slash (the old
  // LocalStorage.list double-slash). SHIPPED DARK: a data transform on a prod
  // table only runs when TRAIL_FIX_IMAGE_SLASH=1 is set deliberately.
  await trin(slug, 'fixImageSlash', () => fixImageSlash(db));
  // F163.2 Phase 5 — opt-in regex-sweep over legacy image descriptions.
  // Stamps auto_flag_signal on rows that predate the [QUALITY:]-marker
  // prompt where the description text matches the regex backstop. Gated
  // by TRAIL_VISION_AUTO_FLAG_SWEEP=1 so we don't surprise tenants on
  // the upgrade.
  await trin(slug, 'sweepAutoFlag', () => sweepAutoFlag(db));
  // F156 Phase 0 — top up every tenant to TRAIL_DEV_CREDITS if set.
  // Idempotent; only adds the delta needed to reach the target. Phase 2
  // replaces this with Stripe Checkout self-serve top-up.
  await trin(slug, 'seedDevCreditsOnBoot', () => seedDevCreditsOnBoot(db));
  // F143 — roll any `running` ingest-jobs back to `queued` and kick the
  // scheduler for each KB with work outstanding. Survives restarts without
  // dropping half a 65-file upload batch on the floor.
  await trin(slug, 'recoverIngestJobs', () => recoverIngestJobs(db));
}

// Hele sekvensen under ét. Bruges KUN af provisionTenant, hvor basen er
// splinterny og tom — dér er vedligeholdelsen øjeblikkelig, og en ny kunde må
// gerne vente på at hans egen base er helt klar.
async function bootTenant(db: TrailDatabase): Promise<void> {
  await bootTenantEssential(db, 'ny');
  await bootTenantMaintenance(db, 'ny');
}

// F222.3 — the three link/reference sweeps are OUT of the serving path.
// Measured 5/9 07:39–07:47 (dansk tid 09:39): with a remote tenant DB the
// reference/backlink/link-check backfills walk every wiki doc over the
// network (broberg-ai: 7,217 docs), and with them inside bootTenant the
// engine answered 502 to ALL customers for 8 minutes while it swept.
// They are idempotent maintenance, not serving prerequisites — so they
// run AFTER Bun.serve, per tenant, and a failure is logged, never fatal.
async function bootTenantDeferred(slug: string, db: TrailDatabase): Promise<void> {
  const t0 = Date.now();
  // F259 — kundens egen vedligeholdelse først: den lå i serverings-vejen og
  // var dét der væltede motoren.
  await bootTenantMaintenance(db, slug);
  await backfillReferences(db);
  await backfillBacklinks(db);
  // F148 — populate broken_links so the admin link-report panel surfaces
  // unresolvable [[wiki-link]]s. Runs after backfillBacklinks so the fresh
  // backlinks table reflects the fold-enabled resolution.
  await backfillLinkCheck(db);
  console.log(`[boot-deferred] ${slug}: link/reference sweeps done in ${Math.round((Date.now() - t0) / 1000)}s`);
}

// F222.3 — the PRIMARY tenant can be remote too (sanne-andersen is the
// primary and moves last). The explicit TRAIL_DB_REMOTE map decides —
// never token-presence, never file-absence.
const primaryRemoteUrl = remoteTenantConfig()[inferPrimarySlug(DEFAULT_DB_PATH)];
const trail = primaryRemoteUrl
  ? await openRemoteTenantDb(inferPrimarySlug(DEFAULT_DB_PATH), primaryRemoteUrl)
  : await createLibsqlDatabase({ path: DEFAULT_DB_PATH });
await bootTenantEssential(trail, inferPrimarySlug(DEFAULT_DB_PATH));

// F40.2a-C: build the tenant pool. With TRAIL_MULTI_TENANT off the pool
// has only the primary — engine behaves exactly like F40.1. With the
// flag on, every other /data/<slug>/trail.db is discovered, opened,
// migrated, and added to the pool. Services in milestone E iterate
// over this pool; auth-middleware in milestone D selects from it.
const primarySlug = inferPrimarySlug(DEFAULT_DB_PATH);
const tenantPool = await openTenantPool({
  primarySlug,
  primaryDb: trail,
  bootSecondary: async (slug, db) => bootTenantEssential(db, slug),
});

// F40.2a-E: every background service runs for every tenant in the pool.
// With TRAIL_MULTI_TENANT off, pool = { primary }, so the iteration is
// a no-op and behaviour matches F40.1. With the flag on, broberg-ai
// (or any other secondary tenant) gets the same lint scheduler,
// contradiction lint, queue-backfill, action recommender, etc.
// Collected stop-fns are torn down in shutdown below.
const serviceStops: Array<() => void> = [];
const jobRunners: Array<{ start(): Promise<void>; stop?: () => void | Promise<void> }> = [];

for (const [slug, db] of tenantPool) {
  // F21 — periodic backpressure scheduler. Re-ticks queued ingest
  // work every 30s; one timer per tenant so jobs in tenant A never
  // wait on tenant B's rate cap.
  startBackpressureScheduler(db);

  // F15 — reference extractor subscribes to candidate_approved.
  serviceStops.push(startReferenceExtractor(db));

  // F15 iter 2 — wiki-wiki backlink extractor subscribes to the same event.
  serviceStops.push(startBacklinkExtractor(db));

  // F148 — link-checker subscribes to candidate_approved too. Re-scans the
  // committed doc's [[wiki-link]]s against the KB pool; unresolved links
  // land in broken_links for the curator.
  serviceStops.push(startLinkChecker(db));

  // F19 axis 3 — contradiction detection subscribes to candidate_approved.
  serviceStops.push(startContradictionLint(db));

  // F32.2 — scheduled dreaming pass (orphans+stale + contradictions).
  serviceStops.push(startLintScheduler(db));

  // F254.1 — hold vektorerne i takt med teksten. Kun for videnbaser med
  // hybrid slået til, så et slukket flag også betyder ingen regning.
  serviceStops.push(startIndexScheduler(db));

  // F182.3 — nightly confidence-decay pass (pure math, no LLM).
  serviceStops.push(startConfidenceDecay(db));

  // F90 — queue-backfill + locale pre-translation.
  serviceStops.push(startQueueBackfill(db));

  // F96 — action recommender per candidate.
  serviceStops.push(startActionRecommender(db));

  // F97 — activity-log subscriber.
  serviceStops.push(startActivityLogger(db));

  // F180 — upload-session GC.
  serviceStops.push(startUploadSessionGc(db));

  // F96 — recommender backfill for legacy pending candidates. Staggered
  // by 60s + 30s-per-tenant so multi-tenant boots don't all hit the
  // claude CLI at the same moment.
  const backfillDelayMs = 60_000 + 30_000 * jobRunners.length;
  setTimeout(() => {
    void backfillRecommendations(db).catch((err) => {
      console.error(`[action-recommender][${slug}] backfill failed:`, err);
    });
  }, backfillDelayMs);

  // F164 — per-tenant background-job runner. Each tenant has its own
  // job queue (queue_candidates + jobs tables live in the tenant DB),
  // so the runner instance is also per-tenant.
  const jobRunner = initJobRunner(db);
  if (process.env.TRAIL_JOBS_NOOP_HANDLER === '1') {
    jobRunner.register('noop', noopHandler);
  }
  jobRunner.register('vision-rerun', visionRerunHandler);
  jobRunner.register('image-triage', imageTriageHandler);
  await jobRunner.start();
  jobRunners.push(jobRunner);
}

const app = createApp(trail, tenantPool);

// F210.2 — provision a brand-new tenant and make it live WITHOUT a restart.
//
// Called by the control plane right after it writes the control_tenants row.
// Before this existed the pool was frozen at boot, so a tenant created in the
// admin answered 401 to every request until someone restarted the engine —
// and nothing on screen said why.
//
// Ships dark: with TRAIL_PROVISION_SECRET unset the route refuses everything
// with 503, so an engine that has not been given the secret cannot have
// directories created on its volume by anyone who can reach it.
app.post('/api/admin/tenants', async (c) => {
  const secret = process.env.TRAIL_PROVISION_SECRET;
  if (!secret) {
    return c.json({ error: 'provisioning not configured' }, 503);
  }
  const auth = c.req.header('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // Length-independent compare would be better; Bun has no timingSafeEqual on
  // strings, and this secret is machine-to-machine over the private network.
  if (presented !== secret) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: {
    slug?: string;
    name?: string;
    ownerEmail?: string;
    keyHash?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    /* validated below */
  }
  const slug = body.slug?.trim();
  if (!slug) return c.json({ error: 'slug required' }, 400);
  const name = body.name?.trim() || slug;
  const ownerEmail = body.ownerEmail?.trim().toLowerCase();
  const keyHash = body.keyHash?.trim();

  /**
   * F210.5 — a provisioned tenant must be REACHABLE.
   *
   * `keyHash` is the sha256 of the bearer the control plane minted and will
   * forward on this tenant's behalf. The raw key never crosses this wire —
   * the engine only ever stores hashes, so sending the hash is both
   * sufficient and the smaller thing to leak.
   *
   * Refused when absent rather than provisioning a tenant that cannot be
   * reached: the failure this replaces was a database that existed, migrated
   * cleanly, reported 201, and answered every subsequent request with
   * "Invalid or revoked API key".
   */
  if (!keyHash || !ownerEmail) {
    return c.json({ error: 'keyHash and ownerEmail are required to provision a reachable tenant' }, 400);
  }

  try {
    const result = await provisionTenant({
      pool: tenantPool,
      slug,
      boot: bootTenant,
      seed: (db) => seedTenantIdentity(db, { slug, name, ownerEmail, keyHash }),
    });
    return c.json({ ok: true, slug: result.slug, live: tenantPool.has(result.slug) }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "already exists" is a conflict, not a server fault — the caller can
    // tell a name clash from a broken engine.
    const conflict = /already (exists|live)/.test(msg);
    console.error(`[provision] ${slug}: ${msg}`);
    return c.json({ error: msg }, conflict ? 409 : 400);
  }
});

const server = Bun.serve({
  port: PORT,
  // Disable the 10-second default idle timeout: it killed SSE streams mid-
  // flight (pings are 30s apart) and EventSource reconnected every ~10s,
  // dropping any candidate_* event that fired inside the gap. That silent
  // drop was the root cause of the "badge is stuck on N" symptom — the
  // client never saw the decrement. SSE connections live as long as the
  // client keeps them; stream.onAbort handles real disconnects.
  idleTimeout: 0,
  fetch: app.fetch,
});

console.log(`trail server running on http://localhost:${server.port}`);
console.log(`  database: ${trail.path}`);

/**
 * F258 — EN BAGGRUNDS-FEJNING MÅ ALDRIG VÆLTE BETJENINGEN.
 *
 * MÅLT 6/9 2026, produktionen NEDE i et nedbruds-loop:
 *
 *     TimeoutError: The operation timed out.
 *     Main child exited normally with code: 1
 *     [  308.349265] reboot: Restarting system
 *
 * Motoren kørte 308 sekunder, styrtede, genstartede, styrtede igen. Alt
 * autentificeret svarede 503 efter 35 sekunder; kun admin-serverens eget
 * /api/health svarede hurtigt — og DEN rører aldrig motoren, så hver «0,2s
 * health»-måling den dag målte den forkerte proces.
 *
 * Fejningerne nedenfor ER pakket i try/catch. Det hjalp ikke: libsql-klientens
 * timeout ankommer som en AFVIST PROMISE uden for det await der blev fanget,
 * og Bun afslutter processen ved en ubehandlet afvisning. En catch dækker den
 * kode den står om — ikke alt det arbejde kaldet satte i gang.
 *
 * Vagten er derfor på PROCESSEN, ikke på kaldestedet. En fejning er
 * vedligeholdelse; den må fejle, larme og prøve igen senere. Den må aldrig
 * lukke butikken for tre kunder.
 *
 * BEVIDST IKKE FOR uncaughtException: dér kan tilstanden være korrupt, og at
 * køre videre er værre end at genstarte. En afvist promise fra et
 * baggrundskald er en anden sag — der er intet korrupt, der er bare noget der
 * ikke blev færdigt.
 */
process.on('unhandledRejection', (grund) => {
  console.error(
    '[unhandled] en baggrunds-opgave fejlede — motoren kører videre:',
    grund instanceof Error ? `${grund.name}: ${grund.message}` : grund,
  );
});

// F222.3 — deferred maintenance sweeps run now that customers are served.
// Sequential per tenant (one sweep at a time keeps the DB machine calm).
void (async () => {
  for (const [slug, db] of tenantPool) {
    try {
      await bootTenantDeferred(slug, db);
    } catch (err) {
      console.error(`[boot-deferred] ${slug} failed:`, err instanceof Error ? err.message : err);
    }
  }
})();

// F196 — self-report this deploy to upmetrics (one success POST on boot,
// fail-soft + no-op unless UPMETRICS_API_KEY + UPMETRICS_SITE are set).
void reportDeploy();

// Graceful shutdown: tear down background subscribers first so no async
// handler can race an event against a closing libSQL client, then stop
// the HTTP server, then close every tenant DB so each WAL checkpoints
// cleanly.
const shutdown = async () => {
  console.log('\nshutting down…');
  for (const stop of serviceStops) {
    try { stop(); } catch (err) { console.error('service stop failed:', err); }
  }
  for (const runner of jobRunners) {
    try { await runner.stop?.(); } catch (err) { console.error('job runner stop failed:', err); }
  }
  server.stop();
  for (const [slug, db] of tenantPool) {
    try {
      await db.close();
    } catch (err) {
      console.error(`tenant ${slug} close failed:`, err);
    }
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
