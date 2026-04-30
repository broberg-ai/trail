/**
 * F168 — Beam: copy a single KB from local Trail to a remote engine.
 *
 * Source: local data/trail.db + data/uploads/{tenant_id}/{kb_id}/...
 * Destination: a Fly engine app's /data/{slug}/ directory.
 *
 * The source KB lives under tenant_id='t-christian' (Christian's dev
 * workbench). The destination becomes a NEW tenant 't-sanne-andersen'
 * with two users (Sanne + Christian). This script does the rewrite at
 * export time so the engine's import is just an atomic file rename.
 *
 * Subcommands:
 *   prepare-export — produce /tmp/{slug}-{ts}.beam.tar (no remote calls)
 *   ship           — prepare-export + sftp upload + ssh-trigger import
 *                    + fly machine restart + remote smoke-test
 *
 * Run with: bun run apps/server/scripts/beam.ts <subcommand> ...
 */

import { mkdirSync, rmSync, statSync, copyFileSync, existsSync, readdirSync, createReadStream } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createLibsqlDatabase } from '@trail/db';

// ── Hard-coded for tonight's Sanne onboard. Future commits will accept
//    these as CLI flags so the script handles arbitrary tenants.
const SOURCE_DB = join(homedir(), 'Apps/broberg/trail/data/trail.db');
const SOURCE_UPLOADS_ROOT = join(homedir(), 'Apps/broberg/trail/data/uploads');

const SOURCE_TENANT_ID = 't-christian';
const SOURCE_KB_SLUG = 'sanne-andersen';
const SOURCE_KB_ID = '6aa52746-d235-464c-b038-d7e1965e3622';

const DEST_TENANT_ID = 't-sanne-andersen';
const DEST_TENANT_SLUG = 'sanne-andersen';
const DEST_TENANT_NAME = 'Sanne Andersen';

const DEST_USERS = [
  { id: 'u-sanne',        email: 'mail@sanneandersen.dk', display_name: 'Sanne Andersen',     role: 'owner' as const },
  { id: 'u-cb-webhouse',  email: 'cb@webhouse.dk',        display_name: 'Christian Broberg',  role: 'admin' as const },
  // service-ingest is the F143 ingest-pipeline service user; keep stable id
  // so existing documents.user_id='service-ingest' rows don't get orphaned.
  { id: 'service-ingest', email: 'service-ingest@trail.local', display_name: 'Ingest Service', role: 'service' as const },
];
const SOURCE_USER_REMAP: Record<string, string> = {
  'u-christian': 'u-cb-webhouse',
  'service-ingest': 'service-ingest',
};

const FLY_APP = 'trail-engine-001';
const REMOTE_BEAM_IMPORT = '/usr/local/bin/beam-import.sh';
const REMOTE_INCOMING_DIR = '/data/_incoming';

// ── Helpers ───────────────────────────────────────────────────────────

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sha256File(path: string): string {
  const h = createHash('sha256');
  const buf = require('node:fs').readFileSync(path) as Buffer;
  h.update(buf);
  return h.digest('hex');
}

function run(cmd: string, args: string[], opts: { silent?: boolean } = {}): { code: number; out: string; err: string } {
  if (!opts.silent) console.log(`  $ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// ── prepare-export ─────────────────────────────────────────────────────

async function prepareExport(): Promise<{ tarPath: string; sha256: string; manifest: object }> {
  console.log(`\n=== F168 Beam — prepare-export ===\n`);

  const ts = timestamp();
  const stagingDir = `/tmp/beam-${DEST_TENANT_SLUG}-${ts}`;
  const stagingDb = join(stagingDir, 'trail.db');
  const stagingUploads = join(stagingDir, 'uploads');
  const tarPath = `/tmp/${DEST_TENANT_SLUG}-${ts}.beam.tar`;

  mkdirSync(stagingDir, { recursive: true });

  // [1] VACUUM INTO snapshot of source DB. SQLite does not accept
  //     parameter bindings on VACUUM INTO — must inline the path.
  //     We control stagingDb (timestamped /tmp path) so injection isn't a
  //     real risk, but escape single quotes anyway.
  console.log('[1] Snapshot source trail.db');
  const srcDb = await createLibsqlDatabase({ path: SOURCE_DB });
  const escapedDest = stagingDb.replace(/'/g, "''");
  await srcDb.execute(`VACUUM INTO '${escapedDest}'`);
  console.log(`    → ${stagingDb} (${(statSync(stagingDb).size / 1024 / 1024).toFixed(1)} MB)`);

  // [2] Open snapshot, run rewrite
  console.log('[2] Filter to KB + rewrite tenant/users');
  const stage = await createLibsqlDatabase({ path: stagingDb });

  // Phase A: with FKs ON, let cascade do the orphan-cleanup work.
  await stage.execute(`PRAGMA foreign_keys = ON`);
  await stage.execute(`BEGIN`);
  // Drop every tenant except source — cascade removes their entire trees.
  await stage.execute(`DELETE FROM tenants WHERE id != ?`, [SOURCE_TENANT_ID]);
  // Drop other KBs inside source tenant — cascade removes their docs etc.
  await stage.execute(
    `DELETE FROM knowledge_bases WHERE id != ? AND tenant_id = ?`,
    [SOURCE_KB_ID, SOURCE_TENANT_ID],
  );
  await stage.execute(`COMMIT`);

  // Phase B: rewrite tenant_id with FKs OFF (we're swapping the parent
  // PK and all child FKs in one transactional block; FK enforcement
  // would block individual updates mid-flight).
  await stage.execute(`PRAGMA foreign_keys = OFF`);
  await stage.execute(`BEGIN`);

  // (a) tenants row first — change PK
  await stage.execute(
    `UPDATE tenants SET id = ?, slug = ?, name = ?, plan = 'hobby' WHERE id = ?`,
    [DEST_TENANT_ID, DEST_TENANT_SLUG, DEST_TENANT_NAME, SOURCE_TENANT_ID],
  );

  // (b) every child table with a tenant_id column. Discovered dynamically
  //     so a future schema-add doesn't silently leave rows with the old
  //     tenant_id (e.g. document_access_rollup which we'd otherwise have
  //     listed wrongly).
  const tenantChildTables = await stage.execute(`
    SELECT m.name AS tbl
      FROM sqlite_master m
      JOIN pragma_table_info(m.name) p ON p.name = 'tenant_id'
     WHERE m.type = 'table' AND m.name != 'tenants'
  `);
  for (const row of tenantChildTables.rows as Array<{ tbl: string }>) {
    await stage.execute(
      `UPDATE ${row.tbl} SET tenant_id = ? WHERE tenant_id = ?`,
      [DEST_TENANT_ID, SOURCE_TENANT_ID],
    );
  }

  // (c) user_id remap — every (table, column) pair that FKs to users.id.
  //     Discovered dynamically from pragma_foreign_key_list so we can't
  //     miss a column (api_keys.user_id, knowledge_bases.created_by,
  //     queue_candidates.created_by/reviewed_by, wiki_events.actor_id, …).
  //     Tables we wipe (api_keys, sessions) are skipped — no point
  //     remapping rows we're about to DELETE.
  const skipUserRemap = new Set(['api_keys', 'sessions']);
  const userFks = await stage.execute(`
    SELECT m.name AS tbl, fk."from" AS col
      FROM sqlite_master m, pragma_foreign_key_list(m.name) fk
     WHERE m.type = 'table' AND fk."table" = 'users'
  `);
  for (const row of userFks.rows as Array<{ tbl: string; col: string }>) {
    if (skipUserRemap.has(row.tbl)) continue;
    for (const [oldId, newId] of Object.entries(SOURCE_USER_REMAP)) {
      await stage.execute(
        `UPDATE ${row.tbl} SET ${row.col} = ? WHERE ${row.col} = ?`,
        [newId, oldId],
      );
    }
  }

  // (d) Wipe + reseed users
  await stage.execute(`DELETE FROM users`);
  for (const u of DEST_USERS) {
    await stage.execute(
      `INSERT INTO users (id, tenant_id, email, display_name, role, onboarded) VALUES (?, ?, ?, ?, ?, 1)`,
      [u.id, DEST_TENANT_ID, u.email, u.display_name, u.role],
    );
  }

  // (e) Reset credits + clear secrets/keys/sessions
  await stage.execute(`DELETE FROM api_keys`);
  await stage.execute(`DELETE FROM tenant_secrets`);
  await stage.execute(`DELETE FROM credit_transactions`);
  await stage.execute(`DELETE FROM tenant_credits`);
  await stage.execute(
    `INSERT INTO tenant_credits (tenant_id, balance, monthly_included) VALUES (?, 0, 0)`,
    [DEST_TENANT_ID],
  );
  await stage.execute(`DELETE FROM sessions`);

  await stage.execute(`COMMIT`);

  // Reassert FK integrity
  console.log('[3] Verify FK integrity');
  await stage.execute(`PRAGMA foreign_keys = ON`);
  const fkCheck = await stage.execute(`PRAGMA foreign_key_check`);
  if ((fkCheck.rows as Array<unknown>).length > 0) {
    console.error('    ✗ FK violations after rewrite:');
    console.error(fkCheck.rows);
    throw new Error('FK integrity check failed — aborting export');
  }
  console.log('    ✓ no FK violations');

  // (j) Rebuild contentless FTS5 indexes (their internal rowids are stale
  //     after our DELETEs; cleanest is to rebuild from source rows)
  await stage.execute(`INSERT INTO documents_fts(documents_fts) VALUES('rebuild')`);
  await stage.execute(`INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')`);
  await stage.execute(`INSERT INTO document_images_fts(document_images_fts) VALUES('rebuild')`);

  // (k) VACUUM to compact, then checkpoint+truncate WAL so the .db file
  //     is self-contained. Without this, trail.db-wal sidecar holds
  //     uncommitted state and sha256(trail.db) won't match what the
  //     engine sees after import (engine has no -wal sidecar to apply).
  await stage.execute(`PRAGMA foreign_keys = ON`);
  await stage.execute(`VACUUM`);
  await stage.execute(`PRAGMA wal_checkpoint(TRUNCATE)`);
  // Drop the now-zero-length sidecars so they don't end up in the tar.
  for (const ext of ['-wal', '-shm']) {
    const p = `${stagingDb}${ext}`;
    if (existsSync(p)) rmSync(p);
  }

  // (l) Snapshot row counts for manifest
  const counts: Record<string, number> = {};
  for (const tbl of ['tenants', 'users', 'knowledge_bases', 'documents', 'document_chunks', 'document_images', 'tenant_credits', 'api_keys']) {
    const r = await stage.execute(`SELECT COUNT(*) AS n FROM ${tbl}`);
    counts[tbl] = Number((r.rows[0] as { n: number }).n);
  }

  const stagedDbBytes = statSync(stagingDb).size;
  const stagedDbSha = sha256File(stagingDb);

  // [4] Copy upload blobs
  console.log('[4] Copy upload blobs to staging');
  const sourceBlobsDir = join(SOURCE_UPLOADS_ROOT, SOURCE_TENANT_ID, SOURCE_KB_ID);
  const destBlobsDir = join(stagingUploads, DEST_TENANT_ID, SOURCE_KB_ID);
  if (!existsSync(sourceBlobsDir)) {
    throw new Error(`Source blobs not found: ${sourceBlobsDir}`);
  }
  // Use cp -a for fast, structure-preserving copy (handles 100s of dirs/files)
  mkdirSync(destBlobsDir, { recursive: true });
  const cp = run('cp', ['-a', `${sourceBlobsDir}/.`, destBlobsDir], { silent: true });
  if (cp.code !== 0) throw new Error(`cp failed: ${cp.err}`);
  const blobsDu = run('du', ['-sh', stagingUploads], { silent: true });
  console.log(`    → ${stagingUploads} (${blobsDu.out.split('\t')[0]})`);

  // [5] Write manifest
  const manifest = {
    beam_version: 1,
    exported_at: new Date().toISOString(),
    exported_by: process.env.USER ?? 'unknown',
    source: {
      tenant_id: SOURCE_TENANT_ID,
      kb_id: SOURCE_KB_ID,
      kb_slug: SOURCE_KB_SLUG,
    },
    destination: {
      tenant_id: DEST_TENANT_ID,
      tenant_slug: DEST_TENANT_SLUG,
      tenant_name: DEST_TENANT_NAME,
      users: DEST_USERS.map(({ id, email, role }) => ({ id, email, role })),
    },
    trail_db_bytes: stagedDbBytes,
    trail_db_sha256: stagedDbSha,
    row_counts: counts,
  };
  await writeFile(join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // [6] Tar (no gzip — PDFs/PNGs already compressed)
  console.log('[5] Tar staging dir → ' + tarPath);
  const tar = run('tar', ['-cf', tarPath, '-C', stagingDir, '.']);
  if (tar.code !== 0) throw new Error(`tar failed: ${tar.err}`);
  const tarBytes = statSync(tarPath).size;
  console.log(`    → ${tarPath} (${(tarBytes / 1024 / 1024).toFixed(1)} MB)`);

  // [7] Cleanup staging
  rmSync(stagingDir, { recursive: true, force: true });

  console.log('\n--- Manifest ---');
  console.log(JSON.stringify(manifest, null, 2));

  return { tarPath, sha256: stagedDbSha, manifest };
}

// ── ship ───────────────────────────────────────────────────────────────

async function ship(): Promise<void> {
  const { tarPath, sha256, manifest } = await prepareExport();

  const engineUrl = process.env.TRAIL_BEAM_ENGINE_URL ?? 'https://engine.trailmem.com';
  const beamToken = process.env.BEAM_TOKEN;
  if (!beamToken) {
    throw new Error(
      'BEAM_TOKEN env var not set locally. Read it from `fly secrets list --app ' +
      FLY_APP + '` or generate fresh + push via `fly secrets set`.',
    );
  }

  console.log(`\n=== F168 Beam — ship to ${engineUrl} ===\n`);

  // [a] HTTP POST tar to /api/internal/beam/import.
  //     We use Bun's fetch with a streaming Body so we don't load 331 MB
  //     into RAM. The engine streams body to disk, runs beam-import.sh,
  //     returns JSON.
  const tarBytes = statSync(tarPath).size;
  const tarStream = createReadStream(tarPath);

  console.log(`[a] POST tar (${(tarBytes / 1024 / 1024).toFixed(1)} MB) to ${engineUrl}/api/internal/beam/import`);
  const start = Date.now();

  // Node's fetch via undici accepts a stream as body. Bun's fetch does too.
  const res = await fetch(`${engineUrl}/api/internal/beam/import`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${beamToken}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(tarBytes),
      'X-Beam-Slug': DEST_TENANT_SLUG,
      'X-Beam-Sha256': sha256,
      'X-Beam-Filename': basename(tarPath),
    },
    body: tarStream as unknown as ReadableStream,
    // Bun-specific opt-in: required for streaming uploads
    // @ts-expect-error duplex is not in the lib.dom.d.ts fetch type yet
    duplex: 'half',
  });

  const elapsedMs = Date.now() - start;
  const mbps = (tarBytes / 1024 / 1024) / (elapsedMs / 1000);
  console.log(`    → uploaded in ${(elapsedMs / 1000).toFixed(1)}s (${mbps.toFixed(1)} MB/s)`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`beam import failed: HTTP ${res.status}\n${text}`);
  }
  const body = await res.json() as { ok: boolean; slug: string; import_stdout?: string };
  console.log('[b] Server response:', body);

  // [c] restart engine machine to pick up new DB (existing process has
  //     trail.db open; libsql holds an exclusive WAL lock until restart).
  console.log('[c] Restart engine machine');
  const machineList = run('fly', ['machine', 'list', '--app', FLY_APP, '--json']);
  const machines = JSON.parse(machineList.out) as Array<{ id: string; state: string }>;
  if (machines.length === 0) throw new Error('no machines on app');
  for (const m of machines) {
    const restart = run('fly', ['machine', 'restart', m.id, '--app', FLY_APP]);
    if (restart.code !== 0) throw new Error(`restart of ${m.id} failed: ${restart.err}`);
  }

  // [d] smoke test
  console.log('[d] Smoke-test /api/health');
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  for (let i = 0; i < 10; i++) {
    const probe = run('curl', ['-fsS', '-m', '5', `${engineUrl}/api/health`], { silent: true });
    if (probe.code === 0) {
      console.log(`    → ${probe.out}`);
      break;
    }
    if (i === 9) throw new Error('smoke test failed after 10 attempts');
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  console.log(`\n=== Sanne beamed to ${FLY_APP}. ===\n`);
  console.log(`Tenant: ${DEST_TENANT_ID} (${DEST_TENANT_SLUG})`);
  console.log(`Documents: ${manifest.row_counts.documents}`);
  console.log(`Images: ${manifest.row_counts.document_images}`);
}

// ── main ───────────────────────────────────────────────────────────────

const subcommand = process.argv[2];
switch (subcommand) {
  case 'prepare-export':
    await prepareExport();
    break;
  case 'ship':
    await ship();
    break;
  default:
    console.error('Usage: bun run apps/server/scripts/beam.ts {prepare-export|ship}');
    process.exit(1);
}
