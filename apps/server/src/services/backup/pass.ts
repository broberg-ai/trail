/**
 * F153 — One end-to-end backup pass.
 *
 * Takes a fresh VACUUM-INTO snapshot of the running DB (via a DISTINCT
 * libSQL client — see the "Gotcha discovered in Phase 1" note in the
 * plan-doc), uploads the gzipped result to the configured provider, and
 * records the whole lifecycle in the manifest.
 *
 * Used from both:
 *   - `POST /api/admin/backups` (trigger='manual')
 *   - the scheduler (Phase 3, trigger='scheduled')
 *
 * Phase 2 scope: snapshot + upload + manifest. Retention pruning lands
 * with the scheduler.
 */

import { createClient } from '@libsql/client';
import { snapshotDb, type SnapshotResult } from '@trail/db';
import { createReadStream, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupProvider } from './providers/types.js';
import { appendSnapshot, updateSnapshot, type BackupSnapshot } from './manifest.js';

export interface BackupPassInput {
  /** Path to the engine's SQLite file (e.g. `trail.path`). */
  dbPath: string;
  /** Root data directory — the manifest lives under `<dataDir>/backups/`. */
  dataDir: string;
  /** Where to stage the .db.gz before upload. */
  stagingDir: string;
  /** Where the final on-disk copy lives after a successful upload. */
  localDir: string;
  provider: BackupProvider;
  trigger: 'manual' | 'scheduled';
}

export interface BackupPassResult {
  snapshot: BackupSnapshot;
  ok: boolean;
  error?: string;
}

/** Short stable id suitable for filenames + URLs. */
export function newSnapshotId(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const HH = String(now.getUTCHours()).padStart(2, '0');
  const MM = String(now.getUTCMinutes()).padStart(2, '0');
  const short = randomBytes(3).toString('hex');
  return `trail_${yyyy}-${mm}-${dd}_${HH}${MM}_${short}`;
}

export async function runBackupPass(input: BackupPassInput): Promise<BackupPassResult> {
  const { dbPath, dataDir, stagingDir, localDir, provider, trigger } = input;

  // F222.3 — a REMOTE tenant (trail.path is an sqld URL, not a file) cannot
  // be VACUUM'ed from here: the copy would land on the DB machine's disk,
  // unreachable to this process. Refuse loudly instead of producing a
  // zero-byte "backup" that looks green. The DB machine's backup sidecar
  // owns this rung of the ladder for remote tenants (apps/db/backup.sh →
  // object storage, daily).
  if (!dbPath.startsWith('/')) {
    return {
      snapshot: {
        id: 'remote-tenant',
        snappedAt: new Date().toISOString(),
        trigger,
        uncompressedBytes: 0,
        compressedBytes: 0,
        sha256: '',
        localPath: null,
        remoteUrl: null,
        status: 'failed',
        error: `remote tenant (${dbPath}) — backups run on the DB machine's sidecar, not the engine`,
      },
      ok: false,
      error: 'remote_tenant_backup_runs_on_db_machine',
    };
  }

  const id = newSnapshotId();
  const snappedAtIso = new Date().toISOString();
  const filename = `${id}.db.gz`;

  const snapshot: BackupSnapshot = {
    id,
    snappedAt: snappedAtIso,
    trigger,
    uncompressedBytes: 0,
    compressedBytes: 0,
    sha256: '',
    localPath: null,
    remoteUrl: null,
    status: 'snapping',
  };
  await appendSnapshot(dataDir, snapshot);

  // ── Snapshot ────────────────────────────────────────────────────
  // MUST use a distinct libSQL client — taking VACUUM INTO through the
  // engine's own connection hangs when there's concurrent write traffic.
  const backupClient = createClient({ url: `file:${dbPath}` });
  let snap: SnapshotResult;
  try {
    snap = await snapshotDb(backupClient, stagingDir, { basename: id });
  } catch (err) {
    const msg = stringifyErr(err);
    await updateSnapshot(dataDir, id, { status: 'failed', error: `snapshot: ${msg}` });
    return { snapshot: { ...snapshot, status: 'failed', error: `snapshot: ${msg}` }, ok: false, error: msg };
  } finally {
    backupClient.close();
  }

  await updateSnapshot(dataDir, id, {
    status: 'uploading',
    uncompressedBytes: snap.uncompressedBytes,
    compressedBytes: snap.compressedBytes,
    sha256: snap.sha256,
  });

  // ── Upload ──────────────────────────────────────────────────────
  //
  // THE STREAM IS OWNED HERE, NOT BY THE PROVIDER. `createReadStream` opens
  // the file LAZILY — nothing touches the disk until something reads it. A
  // provider that resolves without consuming the stream therefore leaves an
  // unopened handle behind, and the `rename` below moves the file out from
  // under it. The lazy open then fires on a path that no longer exists and
  // emits ENOENT as an UNHANDLED error event on the Readable.
  //
  // MEASURED 20/9 2026: green on macOS, red in CI on Linux —
  //   ENOENT: no such file or directory, open
  //   '/tmp/f212-2-pass-VjIhhZ/data/backups/staging/trail_…_5127e2.db.gz'
  // It is a scheduling race, so "it passes on my machine" was never evidence.
  //
  // It is not only a test artefact: a real provider that rejects early (auth,
  // network, a 4xx before it reads the body) hits the same path, and the
  // ENOENT would then surface AFTER we have already handled the upload
  // failure — an unhandled error on top of a handled one.
  //
  // So: attach an error handler before anything can open the file, and
  // destroy the stream once the upload has finished with it either way.
  let uploadKey: string;
  let stream: ReturnType<typeof createReadStream> | null = null;
  try {
    stream = createReadStream(snap.path);
    // Swallowing is correct here and only here: a read error on this handle
    // is either the race above (the file is already safely moved) or a real
    // read failure, which `provider.upload` reports on its own rejection.
    // Left unhandled it would take the process down.
    stream.on('error', (err) => {
      console.warn('[backup/pass] staged-file stream error:', stringifyErr(err));
    });
    const result = await provider.upload(filename, stream, snap.compressedBytes);
    uploadKey = result.key;
  } catch (err) {
    const msg = stringifyErr(err);
    // Leave the staged .db.gz on disk — the admin can retry manually.
    await updateSnapshot(dataDir, id, { status: 'failed', error: `upload: ${msg}` });
    return {
      snapshot: {
        ...snapshot,
        status: 'failed',
        error: `upload: ${msg}`,
        uncompressedBytes: snap.uncompressedBytes,
        compressedBytes: snap.compressedBytes,
        sha256: snap.sha256,
      },
      ok: false,
      error: msg,
    };
  } finally {
    // Closes an unconsumed handle so the rename below cannot race its open.
    stream?.destroy();
  }

  // ── Move staged -> local keep-dir ───────────────────────────────
  // The local copy is useful for quick restore (no re-download) and
  // survives until retention prunes it. Rename is O(1) on the same FS.
  const localPath = join(localDir, filename);
  try {
    await rename(snap.path, localPath);
  } catch (err) {
    // If rename fails (cross-device, permissions), keep the staging
    // path and let the manifest point to it.
    console.warn('[backup/pass] rename staging→local failed:', stringifyErr(err));
  }
  const finalLocalPath = statSyncSafe(localPath) ? localPath : snap.path;

  const final = await updateSnapshot(dataDir, id, {
    status: 'uploaded',
    localPath: finalLocalPath,
    remoteUrl: `r2://${bucketFromKey(provider, uploadKey)}`,
  });

  return { snapshot: final ?? snapshot, ok: true };
}

function stringifyErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statSyncSafe(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Build a user-readable r2://bucket/key URL. We don't have the bucket
 * name on `BackupProvider`, so we reconstruct from the key (the provider
 * already prefixed it).
 */
function bucketFromKey(provider: BackupProvider, key: string): string {
  // Provider `name` is of the form "R2 (trail-backups)" — extract inside.
  const match = /\(([^)]+)\)/.exec(provider.name);
  const bucket = match?.[1] ?? 'unknown';
  return `${bucket}/${key}`;
}

/** Helper exported for tests + the /delete endpoint (Phase 3). */
export async function unlinkQuietly(path: string): Promise<void> {
  await unlink(path).catch(() => {});
}
