/**
 * F32.2 — scheduled "dreaming pass" over every KB.
 *
 * The reactive lint + contradiction subscriber only scans what changes
 * (candidate_approved events). Neurons that were approved BEFORE we turned
 * contradiction-lint on — or approved while the reactive runner was off —
 * never get re-scanned. A Neuron that *became* stale or orphaned after a
 * source was archived is invisible to the reactive path.
 *
 * The dreaming pass fills that gap. On a schedule (default: every 24h, run
 * once 60s after boot) we iterate every non-archived KB and:
 *
 *   1. Run orphans + stale detectors (F32.1) via `runLint`. Cheap SQL; any
 *      new findings emit as queue candidates and reach admin via broadcaster.
 *   2. Re-scan a sample of ready Neurons for contradictions against their
 *      top-K peers (F32 sampling — see runContradictions). Sequential — the
 *      checker's SerialRunner already rate-limits via its internal queue,
 *      but we call it serially per-doc to avoid holding a huge task list
 *      in memory.
 *
 * The full pass is idempotent: lintFingerprint dedupes re-emissions against
 * any pending/approved candidate with the same fingerprint.
 *
 * Controls via env:
 *   - TRAIL_LINT_SCHEDULE_HOURS (default 24; 0 disables)
 *   - TRAIL_LINT_INITIAL_DELAY_SECONDS (default 14400 = 4h; delay before first run.
 *     Was 60s but every engine restart then triggered a full dreaming pass
 *     that competed with queue-backfill for the single CLI lane. Four hours
 *     means a "normal" restart doesn't kick off a fresh LLM scan; the
 *     nightly 24h schedule carries the load as intended.)
 *   - TRAIL_LINT_SKIP_CONTRADICTIONS (default off; set to 1 to skip the
 *     LLM pass and run only orphans+stale — useful when API/CLI unavailable)
 *   - TRAIL_CONTRADICTION_SAMPLE_SIZE (default 500; cap on Neurons scanned
 *     per KB per 24h pass. At N≈8k a full pass exceeds 24h wall-clock —
 *     sampling keeps the scheduler sustainable. 0 disables the cap.)
 *   - TRAIL_CONTRADICTION_RECENT_FRACTION (default 0.6; share of the sample
 *     drawn from most-recently-updated Neurons. Remainder is uniform random
 *     over the rest of the KB so long-tail Neurons still get revisited.)
 */
import { notifyPush, distinctSubscriptionTenants } from './push.js';
import { activityLog, documents, knowledgeBases, type TrailDatabase } from '@trail/db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import pLimit from 'p-limit';
import { runLint, logActivity, type LintReport } from '@trail/core';
import { broadcaster } from './broadcast.js';
import {
  makeContradictionChecker,
  scanDocForContradictions,
} from './contradiction-lint.js';
import { rebuildAccessRollup, pruneOldAccessRows } from './access-rollup.js';
import { runFullLinkCheck } from './link-checker.js';
import { createBackupProvider, readBackupConfigFromEnv } from './backup/providers/index.js';
import { runBackupPass } from './backup/pass.js';
import { pruneRetention } from './backup/retention.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// F176 — cadence is now per-KB days (NULL falls back to global).
// `TRAIL_LINT_SCHEDULE_HOURS` retained for backward compat (and
// the `=0` disable knob); when set it wins over _DAYS for the
// global default. Default flipped from 24h → 7d (most KBs don't
// drift fast enough to need daily passes; the change cuts Haiku
// burn ~7× on idle tenants).
const SCHEDULE_DAYS_DEFAULT = Number(process.env.TRAIL_LINT_SCHEDULE_DAYS ?? 7);
const LEGACY_HOURS_RAW = process.env.TRAIL_LINT_SCHEDULE_HOURS;
const SCHEDULE_HOURS = LEGACY_HOURS_RAW !== undefined ? Number(LEGACY_HOURS_RAW) : SCHEDULE_DAYS_DEFAULT * 24;
const EFFECTIVE_DEFAULT_DAYS = LEGACY_HOURS_RAW !== undefined
  ? Number(LEGACY_HOURS_RAW) / 24
  : SCHEDULE_DAYS_DEFAULT;
// Tick-frequency: how often the scheduler-loop EVALUATES each KB's
// nextDueAt. Every hour is plenty — cadences are days.
const TICK_INTERVAL_MS = 60 * 60 * 1000;
// Boot-delay was 4h to avoid noise on dev-restarts. With per-KB
// nextDueAt now sourced from activity_log (F97), a fresh boot
// won't re-fire a KB that just lint'ed — so the safety-margin is
// no longer needed. 5 min is enough for the engine to settle.
const INITIAL_DELAY_MS =
  Number(process.env.TRAIL_LINT_INITIAL_DELAY_SECONDS ?? 300) * 1000;
const SKIP_CONTRADICTIONS = process.env.TRAIL_LINT_SKIP_CONTRADICTIONS === '1';
const SAMPLE_SIZE = Number(process.env.TRAIL_CONTRADICTION_SAMPLE_SIZE ?? 500);
const RECENT_FRACTION = clamp01(
  Number(process.env.TRAIL_CONTRADICTION_RECENT_FRACTION ?? 0.6),
);
// F119 — parallelism cap for contradiction-scan. Default 2 keeps Haiku
// rate-limit-safe on Anthropic's per-account quota; Pro+ tenants can
// raise via env (or per-tenant column when F122 lands). 1 = pre-F119
// serial behaviour for debugging.
const CONTRADICTION_PARALLELISM = Math.max(
  1,
  Number(process.env.TRAIL_CONTRADICTION_PARALLELISM ?? 2),
);

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.6;
  return Math.max(0, Math.min(1, n));
}

type ScannedKB = {
  id: string;
  tenantId: string;
  name: string;
  lintScheduleDays: number | null;
  createdAt: string;
};

export function startLintScheduler(trail: TrailDatabase): () => void {
  if (SCHEDULE_HOURS <= 0 || EFFECTIVE_DEFAULT_DAYS <= 0) {
    console.log('  lint-scheduler: disabled (TRAIL_LINT_SCHEDULE_DAYS=0)');
    return () => {};
  }

  let stopped = false;

  // F176 — tick at fixed cadence (hourly), but only run a KB whose
  // own `nextDueAt` (lastPassAt + cadenceDays) has passed. Engine
  // restart no longer resets the timer because lastPassAt is sourced
  // from activity_log, not memory.
  const first = setTimeout(() => {
    if (stopped) return;
    void runTick(trail);
  }, INITIAL_DELAY_MS);

  const interval = setInterval(() => {
    if (stopped) return;
    void runTick(trail);
  }, TICK_INTERVAL_MS);

  console.log(
    `  lint-scheduler: tick every ${TICK_INTERVAL_MS / 60_000}min, ` +
      `default cadence ${EFFECTIVE_DEFAULT_DAYS}d, ` +
      `first tick in ${Math.round(INITIAL_DELAY_MS / 1000)}s, ` +
      `skip_contradictions=${SKIP_CONTRADICTIONS}`,
  );

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(interval);
  };
}

/**
 * F176 — single tick of the per-KB scheduler.
 *
 * Runs every `TICK_INTERVAL_MS`. For each KB:
 *   1. Compute cadenceDays = kb.lintScheduleDays ?? EFFECTIVE_DEFAULT_DAYS
 *   2. Query activity_log for the most recent `lint.completed` with
 *      metadata.trigger='scheduled' (manual passes don't reset the
 *      cadence — curator can run `lint now` without postponing the
 *      automatic schedule).
 *   3. nextDueAt = lastScheduledPassAt + cadenceDays. If never run,
 *      use kb.createdAt as the anchor.
 *   4. If now >= nextDueAt: run a pass for this KB.
 *
 * Pure SQL on the gating path — only KBs that are actually overdue
 * touch the LLM-bound parts.
 */
async function runTick(trail: TrailDatabase): Promise<void> {
  try {
    const kbs = await listKBs(trail);
    if (kbs.length === 0) return;

    const now = Date.now();
    const overdue: ScannedKB[] = [];
    for (const kb of kbs) {
      const cadenceDays = kb.lintScheduleDays ?? EFFECTIVE_DEFAULT_DAYS;
      const lastPass = await lastScheduledPassFor(trail, kb.id);
      const anchor = lastPass ?? kb.createdAt;
      const nextDueAt = parseIso(anchor) + cadenceDays * 24 * 3600 * 1000;
      if (now >= nextDueAt) overdue.push(kb);
    }
    if (overdue.length === 0) return;

    console.log(
      `[lint-scheduler] tick: ${overdue.length}/${kbs.length} KB(s) overdue`,
    );

    let totalFindings = 0;
    let contradictionsScanned = 0;
    for (const kb of overdue) {
      const r = await runLintPassForKb(trail, kb, 'scheduled');
      totalFindings += r.findings;
      contradictionsScanned += r.contradictionsScanned;
    }

    // F141 + F153 maintenance — only fire once per tick AFTER per-KB
    // work, and only if at least one KB ran (avoids access-rollup
    // churn on a quiet tick where nothing was overdue).
    try {
      const rollup = await rebuildAccessRollup(trail);
      if (rollup.documentsRolledUp > 0) {
        console.log(
          `[lint-scheduler] access rollup: ${rollup.documentsRolledUp} docs across ${rollup.kbsProcessed} KB(s), ${rollup.elapsedMs}ms`,
        );
      }
      const pruned = await pruneOldAccessRows(trail);
      if (pruned > 0) {
        console.log(`[lint-scheduler] access rollup: pruned ${pruned} row(s) older than 180d`);
      }
    } catch (err) {
      console.error('[lint-scheduler] access-rollup failed:', err instanceof Error ? err.message : err);
    }
    await runBackupStep(trail);

    console.log(
      `[lint-scheduler] tick complete: ${overdue.length} KB(s), ${totalFindings} new findings, ${contradictionsScanned} Neurons scanned for contradictions`,
    );
  } catch (err) {
    console.error('[lint-scheduler] tick failed:', err);
  }
}

function parseIso(s: string): number {
  // Drizzle stores timestamps as ISO strings. SQLite's `datetime('now')`
  // emits `YYYY-MM-DD HH:MM:SS` (no T, no Z). Both shapes parse fine
  // when normalised to ISO 8601.
  const normalised = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
  const t = Date.parse(normalised);
  return Number.isFinite(t) ? t : 0;
}

/**
 * F176 — find the timestamp of this KB's most recent scheduled
 * lint.completed event in activity_log. Returns null if none ever
 * fired (new KB, or no scheduled run yet).
 */
async function lastScheduledPassFor(
  trail: TrailDatabase,
  kbId: string,
): Promise<string | null> {
  const row = await trail.db
    .select({ createdAt: activityLog.createdAt, metadata: activityLog.metadata })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.knowledgeBaseId, kbId),
        eq(activityLog.kind, 'lint.completed'),
      ),
    )
    .orderBy(desc(activityLog.createdAt))
    .all();
  // Filter for trigger='scheduled' in JS — metadata is a JSON string,
  // and a partial-trigger index would force every lint.completed write
  // to redundantly include `trigger` as a top-level column. Most KBs
  // have <100 lint.completed rows total, so the JS filter is cheap.
  for (const r of row) {
    if (!r.metadata) continue;
    try {
      const meta = JSON.parse(r.metadata) as { trigger?: string };
      if (meta.trigger === 'scheduled' || meta.trigger === undefined) {
        // Pre-F176 lint.completed rows have no trigger; treat them as
        // scheduled (the only path that wrote them was the scheduler).
        return r.createdAt;
      }
    } catch {
      // ignore malformed metadata — they're not valid scheduled stamps
    }
  }
  return null;
}

/**
 * F176 — single per-KB lint pass. Called by the per-KB scheduler tick
 * for KBs whose nextDueAt has elapsed, and by the legacy `runFullPass`
 * shim during transitions. Returns aggregate counters so the caller
 * can roll them up across multiple KBs in one tick.
 */
async function runLintPassForKb(
  trail: TrailDatabase,
  kb: ScannedKB,
  trigger: 'scheduled' | 'manual',
): Promise<{ findings: number; contradictionsScanned: number; elapsedMs: number }> {
  const kbStart = Date.now();
  let findings = 0;
  let contradictionsScanned = 0;

  await logActivity(trail, {
    tenantId: kb.tenantId,
    knowledgeBaseId: kb.id,
    actorKind: 'system',
    kind: 'lint.scheduled',
    subjectType: 'knowledge_base',
    subjectId: kb.id,
    summary: `Lint pass started for "${kb.name}"`,
    metadata: { skipContradictions: SKIP_CONTRADICTIONS, trigger },
  });

  try {
    const report = await runOrphansStale(trail, kb);
    findings += report.totalEmitted;
  } catch (err) {
    console.error(
      `[lint-scheduler] orphans-stale failed for KB "${kb.name}":`,
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const linkSummary = await runFullLinkCheck(trail, kb.tenantId, kb.id);
    if (linkSummary.openRecorded > 0) {
      console.log(
        `[lint-scheduler] KB "${kb.name}" — link-check: ${linkSummary.openRecorded} broken / ${linkSummary.resolved} resolved across ${linkSummary.docsScanned} Neuron(s)`,
      );
    }
  } catch (err) {
    console.error(
      `[lint-scheduler] link-check failed for KB "${kb.name}":`,
      err instanceof Error ? err.message : err,
    );
  }

  if (!SKIP_CONTRADICTIONS) {
    try {
      contradictionsScanned += await runContradictions(trail, kb);
    } catch (err) {
      console.error(
        `[lint-scheduler] contradictions failed for KB "${kb.name}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const elapsedMs = Date.now() - kbStart;
  // F247.3 — push kun når der faktisk ER nye fund (0 fund er støj).
  if (findings > 0) {
    void notifyPush(trail, kb.tenantId, 'lint', {
      title: 'Trail — nye lint-fund',
      body: `${findings} nye fund i "${kb.name}"`,
      navigate: `/kb/${kb.id}/queue`,
      icon: '/icon-192.png',
      tag: 'trail-lint',
    });
  }

  await logActivity(trail, {
    tenantId: kb.tenantId,
    knowledgeBaseId: kb.id,
    actorKind: 'system',
    kind: 'lint.completed',
    subjectType: 'knowledge_base',
    subjectId: kb.id,
    summary: `Lint pass completed for "${kb.name}" (${findings} findings)`,
    metadata: {
      findings,
      elapsedMs,
      skipContradictions: SKIP_CONTRADICTIONS,
      trigger,
    },
  });

  return { findings, contradictionsScanned, elapsedMs };
}

async function listKBs(trail: TrailDatabase): Promise<ScannedKB[]> {
  return trail.db
    .select({
      id: knowledgeBases.id,
      tenantId: knowledgeBases.tenantId,
      name: knowledgeBases.name,
      lintScheduleDays: knowledgeBases.lintScheduleDays,
      createdAt: knowledgeBases.createdAt,
    })
    .from(knowledgeBases)
    .all();
}

/**
 * F153 — run the backup pass + retention prune as part of the scheduler.
 * No-op when TRAIL_BACKUP_R2_* env vars are unset.
 */
async function runBackupStep(trail: TrailDatabase): Promise<void> {
  const config = readBackupConfigFromEnv();
  if (config.type === 'off') return;

  const dataDir = process.env.TRAIL_DATA_DIR ?? join(process.cwd(), 'data');
  const root = join(dataDir, 'backups');
  const stagingDir = join(root, 'staging');
  const localDir = join(root, 'local');
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(localDir, { recursive: true });

  let provider;
  try {
    provider = await createBackupProvider(config);
  } catch (err) {
    console.error(
      '[lint-scheduler] backup provider init failed:',
      err instanceof Error ? err.message : err,
    );
    return;
  }

  // ── Snapshot + upload ───────────────────────────────────────────
  try {
    const t0 = Date.now();
    const result = await runBackupPass({
      dbPath: trail.path,
      dataDir,
      stagingDir,
      localDir,
      provider,
      trigger: 'scheduled',
    });
    const elapsed = Math.round((Date.now() - t0) / 1000);
    if (result.ok) {
      console.log(
        `[lint-scheduler] backup uploaded: ${result.snapshot.id} (${result.snapshot.compressedBytes}B, ${elapsed}s)`,
      );
    } else {
      console.error(`[lint-scheduler] backup failed: ${result.error ?? 'unknown'}`);
      // F247.3 — system-push ved ÆGTE backup-fejl. Den forventede afvisning
      // på fjern-tenants (backup ejes af DB-maskinens sidecar efter F222.3)
      // er ikke en fejl og må ikke pinge nogen hvert kvarter.
      if (result.error !== 'remote_tenant_backup_runs_on_db_machine') {
        for (const t of await distinctSubscriptionTenants(trail)) {
          void notifyPush(trail, t, 'system', {
            title: 'Trail — backup fejlede',
            body: (result.error ?? 'ukendt fejl').slice(0, 160),
            navigate: '/settings',
            icon: '/icon-192.png',
            tag: 'trail-system',
          });
        }
      }
    }
  } catch (err) {
    console.error('[lint-scheduler] backup pass threw:', err instanceof Error ? err.message : err);
  }

  // ── Retention prune (runs even if the current pass failed — old
  // uploaded snapshots from previous passes can still be pruned). ──
  try {
    const localKeep = Number(process.env.TRAIL_BACKUP_LOCAL_KEEP ?? 3);
    const retainDays = Number(process.env.TRAIL_BACKUP_RETAIN_DAYS ?? 30);
    const pruned = await pruneRetention({
      dataDir,
      provider,
      localKeep,
      retainDays,
    });
    if (pruned.prunedRemoteObjects > 0 || pruned.prunedLocalFiles > 0) {
      console.log(
        `[lint-scheduler] backup retention: ${pruned.prunedRemoteObjects} R2 object(s) older than ${retainDays}d, ${pruned.prunedLocalFiles} local file(s) beyond keep=${localKeep}`,
      );
    }
    for (const err of pruned.errors) {
      console.error(`[lint-scheduler] backup retention error: ${err}`);
    }
  } catch (err) {
    console.error(
      '[lint-scheduler] backup retention threw:',
      err instanceof Error ? err.message : err,
    );
  }
}

async function runOrphansStale(trail: TrailDatabase, kb: ScannedKB): Promise<LintReport> {
  // The scheduler is a 'system' actor — same as bearer-auth ingest writes.
  // Lint candidates with system actor can auto-approve through policy if
  // their kind is trusted (orphans/stale are NOT trusted, so they'll land
  // pending for curator review — exactly what we want for a dreaming pass).
  const actor = { id: 'system:lint-scheduler', kind: 'system' as const };
  return runLint(
    trail,
    kb.id,
    kb.tenantId,
    actor,
    {},
    ({ candidate, autoApproved, documentId }) => {
      broadcaster.emit({
        type: 'candidate_created',
        tenantId: candidate.tenantId,
        kbId: candidate.knowledgeBaseId,
        candidateId: candidate.id,
        kind: candidate.kind,
        title: candidate.title,
        status: autoApproved ? 'approved' : 'pending',
        autoApproved,
        confidence: candidate.confidence,
        createdBy: candidate.createdBy,
      });
      if (autoApproved) {
        broadcaster.emit({
          type: 'candidate_resolved',
          tenantId: candidate.tenantId,
          kbId: candidate.knowledgeBaseId,
          candidateId: candidate.id,
          actionId: 'approve',
          effect: 'approve',
          documentId,
          autoApproved: true,
        });
      }
      if (autoApproved && documentId) {
        broadcaster.emit({
          type: 'candidate_approved',
          tenantId: candidate.tenantId,
          kbId: candidate.knowledgeBaseId,
          candidateId: candidate.id,
          documentId,
          autoApproved: true,
        });
      }
    },
  );
}

async function runContradictions(trail: TrailDatabase, kb: ScannedKB): Promise<number> {
  // F118 — round-robin coverage via `last_contradiction_scan_at`.
  // Order ASC NULLS FIRST so never-scanned + oldest-scanned Neurons
  // come first; SAMPLE_SIZE caps how many we scan this pass. Across
  // multiple 24h passes every Neuron eventually gets coverage instead
  // of the same recent-edit hot-set every time.
  //
  // F119 — parallelise scanDocForContradictions via p-limit. Each
  // scan is top-K × Haiku-call (~1-3s each); without parallelism a
  // 500-Neuron pass takes ~25 min serial. With CONTRADICTION_PARALLELISM=2
  // it's ~12 min; raise the env knob for Pro+ tenants on dedicated nodes.
  // p-limit guarantees we never exceed the cap so Anthropic's per-key
  // rate-limit isn't tripped.
  const neurons = await trail.db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.knowledgeBaseId, kb.id),
        eq(documents.tenantId, kb.tenantId),
        eq(documents.kind, 'wiki'),
        eq(documents.archived, false),
        eq(documents.status, 'ready'),
      ),
    )
    // ASC NULLS FIRST — SQLite default for ASC sort is NULLS-first;
    // explicit clause so we don't depend on default behaviour.
    .orderBy(sql`${documents.lastContradictionScanAt} ASC NULLS FIRST`)
    .limit(SAMPLE_SIZE > 0 ? SAMPLE_SIZE : 100_000)
    .all();

  if (neurons.length === 0) return 0;

  const sampleIds = neurons.map((n) => n.id);
  if (SAMPLE_SIZE > 0 && sampleIds.length === SAMPLE_SIZE) {
    console.log(
      `[lint-scheduler] KB "${kb.name}" — round-robin scanning ${sampleIds.length} oldest Neurons (parallelism=${CONTRADICTION_PARALLELISM})`,
    );
  } else {
    console.log(
      `[lint-scheduler] KB "${kb.name}" — scanning all ${sampleIds.length} Neurons (parallelism=${CONTRADICTION_PARALLELISM})`,
    );
  }

  const checker = makeContradictionChecker();
  const limit = pLimit(CONTRADICTION_PARALLELISM);
  let completed = 0;
  await Promise.all(
    sampleIds.map((id) =>
      limit(async () => {
        try {
          await scanDocForContradictions(trail, id, checker);
        } catch (err) {
          console.error(`[lint-scheduler] contradiction scan failed for ${id}:`, err);
        } finally {
          // Always stamp — even on error — so a flaky Neuron doesn't
          // monopolise the next pass via NULLS-FIRST ordering. Errors
          // are still logged above for diagnosis.
          await trail.db
            .update(documents)
            .set({ lastContradictionScanAt: new Date().toISOString() })
            .where(eq(documents.id, id))
            .run();
          completed++;
        }
      }),
    ),
  );
  return completed;
}

/**
 * Pick up to `cap` Neurons from the ordered-by-updatedAt-desc list.
 * Strategy:
 *   1. Take the top `cap * recentFraction` most-recently-updated.
 *   2. Fill the rest with a uniform random sample from the remainder.
 *
 * This mirrors the SCALING-ANALYSIS §5 recommendation: recent edits have
 * the highest contradiction yield (they were just merged against a growing
 * corpus), while the random tail guarantees every Neuron is eventually
 * re-scanned even if it hasn't been touched in years. cap=0 disables.
 *
 * Exported for testability.
 */
export function sampleNeurons(
  ids: string[],
  cap: number,
  recentFraction: number,
): string[] {
  if (cap <= 0 || ids.length <= cap) return ids;
  const recentCount = Math.min(ids.length, Math.floor(cap * recentFraction));
  const randomCount = cap - recentCount;
  const recent = ids.slice(0, recentCount);
  const tail = ids.slice(recentCount);
  if (randomCount <= 0 || tail.length === 0) return recent;
  // Fisher-Yates partial shuffle — only pick the first `randomCount`.
  const pool = tail.slice();
  const picked: string[] = [];
  const take = Math.min(randomCount, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
    picked.push(pool[i]!);
  }
  return [...recent, ...picked];
}
