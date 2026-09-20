/**
 * F212.2 — a failed backup pass must reach a channel that HAS a reader.
 *
 * Measured on prod 2026-08-27: 68 consecutive failures over three months
 * raised ZERO issues. Every one of them was reported — to `console.error`,
 * and to a `status: 'failed'` field in a manifest nobody queried. The
 * epic's own sentence for it: reporting a failure into a channel with no
 * reader is the same as not reporting it.
 *
 * Kept as its own module rather than inline in the scheduler for one
 * reason: the DECISION (which failures alarm, and what the message says)
 * is the part worth testing, and `runBackupStep` is private to the
 * scheduler and needs a tenant DB plus env to reach. A small pure
 * function here can be driven directly, in both directions.
 */
import { captureException } from '@upmetrics/sdk';
import type { BackupPassResult } from './pass.js';

/**
 * The one error that is NOT a failure. Since F222.3 every tenant is served
 * from the DB machine, whose sidecar owns the backup; `runBackupPass`
 * refuses such a tenant by design. Alarming on it would fire on every
 * scheduler tick for every tenant, forever — the fastest way to make
 * someone mute the channel this card exists to fill.
 */
export const BENIGN_REFUSAL = 'remote_tenant_backup_runs_on_db_machine';

/** Which rung failed, read from the manifest row's own error prefix. */
export type BackupStage = 'snapshot' | 'upload' | 'unknown';

export function backupStageOf(result: BackupPassResult): BackupStage {
  const err = result.snapshot.error ?? '';
  if (err.startsWith('snapshot:')) return 'snapshot';
  if (err.startsWith('upload:')) return 'upload';
  return 'unknown';
}

export interface BackupAlarm {
  message: string;
  stage: BackupStage;
  snapshotId: string;
}

/**
 * Decide whether this result deserves an alarm, and what it should say.
 * Returns null when it does not — separating the decision from the
 * sending is what makes both halves testable without a network.
 *
 * The message carries the manifest id and the error's FIRST LINE only.
 * The full text can be a 100-element `integrity_check` array, and
 * Upmetrics groups by fingerprint: a message that varies per event would
 * scatter one fault across many issues, which is the failure mode we
 * reported to them on 2026-09-19 (three of three issue titles described
 * only their first event).
 */
export function backupAlarmFor(result: BackupPassResult): BackupAlarm | null {
  if (result.ok) return null;
  if (result.error === BENIGN_REFUSAL) return null;

  const stage = backupStageOf(result);
  const raw = result.snapshot.error ?? result.error ?? 'unknown';
  const firstLine = raw.split('\n')[0] ?? 'unknown';
  return {
    message: `[F212.2] backup pass failed at ${stage} (${result.snapshot.id}): ${firstLine}`,
    stage,
    snapshotId: result.snapshot.id,
  };
}

/**
 * Send the alarm, if there is one. Returns what was sent so a caller (or
 * a verify script) can assert on it rather than on the absence of a throw.
 * A no-op when Upmetrics is not initialised — that is the local-dev case,
 * and it must not turn a backup failure into a crash.
 */
export function reportBackupFailure(result: BackupPassResult): BackupAlarm | null {
  const alarm = backupAlarmFor(result);
  if (!alarm) return null;
  captureException(new Error(alarm.message), {
    tags: { feature: 'F212.2', stage: alarm.stage, snapshot: alarm.snapshotId },
  });
  return alarm;
}
