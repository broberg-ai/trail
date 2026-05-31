import { createLibsqlDatabase, DEFAULT_DB_PATH, type TrailDatabase } from '@trail/db';
import { createApp } from './app.js';
import { openTenantPool, inferPrimarySlug } from './lib/tenant-pool.js';
import { ensureIngestUser } from './bootstrap/ingest-user.js';
import { recoverZombieIngests } from './bootstrap/zombie-ingest.js';
import { rewriteWikiToNeurons } from './bootstrap/rewrite-wiki-paths.js';
import { cleanupExternalOrphans } from './bootstrap/F98-cleanup-external-orphans.js';
import { seedMissingGlossaryNeurons } from './bootstrap/F102-seed-glossary-neurons.js';
import { recoverPendingSources } from './bootstrap/recover-pending-sources.js';
import { seedDevCreditsOnBoot } from './bootstrap/dev-credits.js';
import { backfillContentHash } from './bootstrap/backfill-content-hash.js';
import { backfillDocumentImages } from './bootstrap/backfill-document-images.js';
import { rerunVisionOnNull } from './bootstrap/rerun-vision.js';
import { sweepAutoFlag } from './bootstrap/sweep-auto-flag.js';
import { recoverIngestJobs, startBackpressureScheduler } from './services/ingest.js';
import { startContradictionLint } from './services/contradiction-lint.js';
import { backfillReferences, startReferenceExtractor } from './services/reference-extractor.js';
import { backfillBacklinks, startBacklinkExtractor } from './services/backlink-extractor.js';
import { backfillLinkCheck, startLinkChecker } from './services/link-checker.js';
import { startLintScheduler } from './services/lint-scheduler.js';
import { startQueueBackfill } from './services/queue-backfill.js';
import { startActionRecommender, backfillRecommendations } from './services/action-recommender.js';
import { startActivityLogger } from './services/activity-logger.js';
import { startUploadSessionGc } from './services/upload-session-gc.js';
import { initJobRunner } from './services/jobs/runner.js';
import { noopHandler } from './services/jobs/handlers/noop.js';
import { visionRerunHandler } from './services/jobs/handlers/vision-rerun.js';
import { init as upInit, setTag } from '@upmetrics/sdk';

// Upmetrics fleet-dogfooding — server-side error capture for every engine
// (engine-001 … N). DSN comes from fly.toml [env] UPMETRICS_DSN. No-op when
// unset (local dev). captureException is wired into the Hono onError in app.ts.
// Per-engine identity via setTag('server', …) so engine-001 vs engine-002 are
// distinguishable under the shared 'trail-engine' release (upmetrics #1955).
if (process.env.UPMETRICS_DSN) {
  upInit({
    dsn: process.env.UPMETRICS_DSN,
    environment: process.env.NODE_ENV,
    release: 'trail-engine',
    autoInstrument: false,
  });
  setTag('server', process.env.FLY_APP_NAME ?? 'local');
  setTag('machine', process.env.FLY_MACHINE_ID ?? 'local');
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
async function bootTenant(db: TrailDatabase): Promise<void> {
  await db.runMigrations();
  await db.initFTS();
  await ensureIngestUser(db);
  await recoverZombieIngests(db);
  await rewriteWikiToNeurons(db);
  // F98 — dismiss pending orphan-findings targeting external-originated
  // Neurons (buddy, MCP, chat, api). Their sources live outside Trail;
  // the orphan detector used to falsely flag them. Idempotent — zero
  // rows to update after the first run is the steady state.
  await cleanupExternalOrphans(db);
  // F102 — ensure every KB has /neurons/glossary.md. Idempotent; seeds
  // the Neuron for KBs created before F102 landed so the compile-pipeline
  // has something to str_replace into on subsequent ingests.
  await seedMissingGlossaryNeurons(db);
  // Re-run extractor on any source stuck in `status='pending'` with a
  // supported file type (pdf/docx/pptx/xlsx). Covers two cases:
  // (1) uploads that predate the extractor for their type (e.g. a PPTX
  // uploaded before the PPTX pipeline shipped), (2) server-crashed-
  // mid-upload rows. Unsupported types stay pending — they need new
  // pipelines. Fire-and-forget: the processXAsync helpers own their
  // status transitions.
  await recoverPendingSources(db);
  // F162 — populate content_hash on legacy source-rows. Idempotent;
  // once everything is hashed, re-runs are a single SELECT returning 0
  // rows. Must run BEFORE the upload route starts accepting requests
  // (which happens later in this file) so a fresh upload doesn't race
  // the backfill on the same row.
  await backfillContentHash(db);
  // F161 — populate document_images for legacy PDFs. Storage scan +
  // PNG-header dim parse + alt-text from compiled markdown. Idempotent;
  // docs with existing rows skipped. Same boot-window placement
  // argument as backfillContentHash.
  await backfillDocumentImages(db);
  // F161 follow-up — opt-in Vision-rerun. OFF by default; only fires
  // when TRAIL_VISION_RERUN_NULL=1 is set. See rerun-vision.ts for
  // the env-flag contract + recommended rollout.
  await rerunVisionOnNull(db);
  // F163.2 Phase 5 — opt-in regex-sweep over legacy image descriptions.
  // Stamps auto_flag_signal on rows that predate the [QUALITY:]-marker
  // prompt where the description text matches the regex backstop. Gated
  // by TRAIL_VISION_AUTO_FLAG_SWEEP=1 so we don't surprise tenants on
  // the upgrade.
  await sweepAutoFlag(db);
  // F156 Phase 0 — top up every tenant to TRAIL_DEV_CREDITS if set.
  // Idempotent; only adds the delta needed to reach the target. Phase 2
  // replaces this with Stripe Checkout self-serve top-up.
  await seedDevCreditsOnBoot(db);
  // F143 — roll any `running` ingest-jobs back to `queued` and kick the
  // scheduler for each KB with work outstanding. Survives restarts without
  // dropping half a 65-file upload batch on the floor.
  await recoverIngestJobs(db);
  await backfillReferences(db);
  await backfillBacklinks(db);
  // F148 — populate broken_links table so the admin link-report panel
  // surfaces any unresolvable [[wiki-link]]s immediately on first deploy.
  // Idempotent; runs after backfillBacklinks so the fresh backlinks table
  // reflects the fold-enabled resolution.
  await backfillLinkCheck(db);
}

const trail = await createLibsqlDatabase({ path: DEFAULT_DB_PATH });
await bootTenant(trail);

// F40.2a-C: build the tenant pool. With TRAIL_MULTI_TENANT off the pool
// has only the primary — engine behaves exactly like F40.1. With the
// flag on, every other /data/<slug>/trail.db is discovered, opened,
// migrated, and added to the pool. Services in milestone E iterate
// over this pool; auth-middleware in milestone D selects from it.
const primarySlug = inferPrimarySlug(DEFAULT_DB_PATH);
const tenantPool = await openTenantPool({
  primarySlug,
  primaryDb: trail,
  bootSecondary: async (_slug, db) => bootTenant(db),
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
  await jobRunner.start();
  jobRunners.push(jobRunner);
}

const app = createApp(trail, tenantPool);

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
