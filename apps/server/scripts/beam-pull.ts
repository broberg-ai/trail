/**
 * F168 Phase 3 — Beam pull (engine → local dev sync).
 *
 * Reverse of `apps/server/scripts/beam.ts` (push). Pulls one
 * tenant's KB slice from a remote engine into the local
 * single-file dev DB without disturbing other tenants/KBs that
 * already live there.
 *
 * Use case: Christian uploaded sources via app.trailmem.com,
 * compile produced new Neurons on prod, now he wants to keep
 * working on the same KB locally with Max-plan claude-cli ingest.
 *
 * Usage:
 *   bun run apps/server/scripts/beam-pull.ts \
 *     --app trail-engine-001 \
 *     --tenant-slug sanne-andersen \
 *     --kb-id 6aa52746-d235-464c-b038-d7e1965e3622 \
 *     [--target-tenant t-christian] \
 *     [--skip-uploads] \
 *     [--dry-run]
 */

import { mkdirSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createLibsqlDatabase } from '@trail/db';

interface Args {
  app: string;
  tenantSlug: string;
  kbId: string;
  targetTenant: string;
  skipUploads: boolean;
  dryRun: boolean;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  function get(name: string, fallback?: string): string {
    const i = a.findIndex((x) => x === `--${name}`);
    if (i === -1) {
      if (fallback !== undefined) return fallback;
      throw new Error(`missing --${name}`);
    }
    return a[i + 1] ?? '';
  }
  return {
    app: get('app', 'trail-engine-001'),
    tenantSlug: get('tenant-slug'),
    kbId: get('kb-id'),
    targetTenant: get('target-tenant', 't-christian'),
    skipUploads: a.includes('--skip-uploads'),
    dryRun: a.includes('--dry-run'),
  };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function run(cmd: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

const LOCAL_DB = join(homedir(), 'Apps/broberg/trail/data/trail.db');
const LOCAL_UPLOADS_ROOT = join(homedir(), 'Apps/broberg/trail/data/uploads');
const INGEST_USER_ID = 'service-ingest';

// MERGE-eligible: knowledge_base_id-scoped tables. INSERT OR REPLACE
// on each row (id-keyed). Schema-discovered at runtime so a future
// table added by a migration just works.
const KB_SCOPED_TABLES = [
  'documents',
  'document_images',
  'wiki_backlinks',
  'document_references',
  'broken_links',
  'activity_log',
];

// Document-scoped tables — filter by document_id IN (kb's docs).
// `chunks`, `wiki_events` don't carry knowledge_base_id directly
// but are unambiguously KB-scoped via their parent document.
//
// vision_quality_ratings is image-scoped (image_id) AND represents
// per-curator thumbs-up/down votes — those are environment-personal
// (Christian's local votes shouldn't be overwritten by prod votes
// from another curator's session). Skipped.
const DOC_SCOPED_TABLES = [
  'document_chunks',
  'wiki_events',
];

// Never sync — operational / per-environment.
// (Listed for self-documenting; we just skip them.)
// 'queue_candidates', 'queue_actions',
// 'sessions', 'api_keys',
// 'ingest_jobs',
// 'chat_sessions', 'chat_turns',
// 'tenant_credits', 'credit_transactions'

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`\n=== F168 Phase 3 — Beam pull ===\n`);
  console.log(`  source app    : ${args.app}`);
  console.log(`  source tenant : ${args.tenantSlug} (prod tenant_id: t-${args.tenantSlug})`);
  console.log(`  source kb     : ${args.kbId}`);
  console.log(`  target tenant : ${args.targetTenant} (local)`);
  console.log(`  skip uploads  : ${args.skipUploads}`);
  console.log(`  dry run       : ${args.dryRun}`);

  const ts = timestamp();
  const stagingDir = `/tmp/beam-pull-${args.tenantSlug}-${ts}`;
  const stagingDb = join(stagingDir, 'trail.db');
  mkdirSync(stagingDir, { recursive: true });

  // [1] Pull prod trail.db over sftp
  console.log(`\n[1] sftp pull /data/${args.tenantSlug}/trail.db → ${stagingDb}`);
  const remotePath = `/data/${args.tenantSlug}/trail.db`;
  const sftp = run('flyctl', [
    'ssh', 'sftp', 'shell',
    '-a', args.app,
  ]);
  // The shell-mode is interactive; for non-interactive we use stdin.
  const sftpResult = spawnSync('flyctl', ['ssh', 'sftp', 'shell', '-a', args.app], {
    input: `get ${remotePath} ${stagingDb}\n`,
    encoding: 'utf8',
  });
  if (sftpResult.status !== 0) {
    console.error(`  ✗ sftp failed: ${sftpResult.stderr}`);
    process.exit(1);
  }
  void sftp;
  if (!existsSync(stagingDb)) {
    console.error(`  ✗ ${stagingDb} not present after sftp`);
    process.exit(1);
  }
  console.log(`  ✓ ${(statSync(stagingDb).size / 1024 / 1024).toFixed(1)} MB`);

  // [2] Open both DBs
  console.log(`\n[2] Open staging DB (read) + local DB (write)`);
  const stage = await createLibsqlDatabase({ path: stagingDb });
  const local = await createLibsqlDatabase({ path: LOCAL_DB });

  const sourceTenantId = `t-${args.tenantSlug}`;

  // [3] Verify KB exists on both sides
  const stageKb = await stage.execute(
    `SELECT id, name, tenant_id FROM knowledge_bases WHERE id = ?`,
    [args.kbId],
  );
  const localKb = await local.execute(
    `SELECT id, name, tenant_id FROM knowledge_bases WHERE id = ?`,
    [args.kbId],
  );
  const stageKbRow = stageKb.rows[0] as { id: string; name: string; tenant_id: string } | undefined;
  const localKbRow = localKb.rows[0] as { id: string; name: string; tenant_id: string } | undefined;
  if (!stageKbRow) {
    console.error(`  ✗ kb-id ${args.kbId} not found on prod`);
    process.exit(1);
  }
  if (!localKbRow) {
    console.error(`  ✗ kb-id ${args.kbId} not found locally — pull cannot match a target`);
    process.exit(1);
  }
  if (stageKbRow.tenant_id !== sourceTenantId) {
    console.error(`  ✗ kb's prod tenant_id is ${stageKbRow.tenant_id}, expected ${sourceTenantId}`);
    process.exit(1);
  }
  if (localKbRow.tenant_id !== args.targetTenant) {
    console.error(`  ✗ kb's local tenant_id is ${localKbRow.tenant_id}, expected ${args.targetTenant}`);
    process.exit(1);
  }
  console.log(`  ✓ KB matched: "${stageKbRow.name}"`);

  // [4] Capture local users we can map prod-actor-ids onto. Anything
  //     unmapped → service-ingest fallback.
  const localUsers = await local.execute(
    `SELECT id FROM users WHERE tenant_id = ? OR id = ?`,
    [args.targetTenant, INGEST_USER_ID],
  );
  const localUserIds = new Set((localUsers.rows as Array<{ id: string }>).map((r) => r.id));
  console.log(`  ✓ ${localUserIds.size} local user-ids available for FK mapping`);

  // [5] Per-table merge.
  // First fetch the doc-id list for the KB (used by doc-scoped tables).
  const stageDocIds = await stage.execute(
    `SELECT id FROM documents WHERE knowledge_base_id = ?`,
    [args.kbId],
  );
  const docIdSet = new Set(
    (stageDocIds.rows as Array<{ id: string }>).map((r) => r.id),
  );
  console.log(`\n[3] Merge prod rows into local (KB-scoped + doc-scoped tables)`);
  console.log(`    ${docIdSet.size} document ids in scope`);

  // F168 Phase 3 — disable FK enforcement during merge. Mirror of the
  // push-Beam approach (apps/server/scripts/beam.ts line ~119): inserts
  // arrive in arbitrary order so child rows can land before their
  // parents within the same transaction. Re-enabled at the end.
  if (!args.dryRun) {
    await local.execute(`PRAGMA foreign_keys = OFF`);
    await local.execute(`BEGIN`);
  }
  const summary: Record<string, { fetched: number; inserted: number; replaced: number }> = {};

  async function mergeTable(
    table: string,
    whereClause: string,
    whereArgs: unknown[],
  ): Promise<void> {
    const cols = await stage.execute(`PRAGMA table_info('${table}')`);
    const colNames = (cols.rows as Array<{ name: string }>).map((c) => c.name);
    if (colNames.length === 0) {
      console.log(`  - ${table}: not present, skipping`);
      return;
    }
    const hasTenantId = colNames.includes('tenant_id');
    const userIdCols = colNames.filter((n) =>
      ['actor_id', 'user_id', 'created_by', 'reviewed_by'].includes(n),
    );

    const rows = await stage.execute(
      `SELECT * FROM ${table} WHERE ${whereClause}`,
      whereArgs,
    );
    const fetched = rows.rows.length;
    let inserted = 0;
    let replaced = 0;

    for (const r of rows.rows as Array<Record<string, unknown>>) {
      if (hasTenantId) r.tenant_id = args.targetTenant;
      for (const col of userIdCols) {
        const v = r[col];
        if (typeof v === 'string' && !localUserIds.has(v)) {
          r[col] = INGEST_USER_ID;
        }
      }

      const id = r.id as string | undefined;
      let wasReplace = false;
      if (id) {
        const exists = await local.execute(
          `SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`,
          [id],
        );
        wasReplace = exists.rows.length > 0;
      }

      if (!args.dryRun) {
        const placeholders = colNames.map(() => '?').join(', ');
        const colList = colNames.map((c) => `"${c}"`).join(', ');
        const values = colNames.map((c) => r[c] as never);
        await local.execute(
          `INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`,
          values,
        );
      }

      if (wasReplace) replaced += 1;
      else inserted += 1;
    }

    summary[table] = { fetched, inserted, replaced };
    console.log(
      `  - ${table.padEnd(24)} fetched=${fetched.toString().padStart(4)} inserted=${inserted.toString().padStart(4)} replaced=${replaced.toString().padStart(4)}`,
    );
  }

  // KB-scoped tables: filter on knowledge_base_id
  for (const table of KB_SCOPED_TABLES) {
    await mergeTable(table, 'knowledge_base_id = ?', [args.kbId]);
  }

  // Doc-scoped tables: filter on document_id IN (...)
  if (docIdSet.size > 0) {
    const docIdList = Array.from(docIdSet);
    // SQLite IN-list cap is 999 by default; chunk if needed
    const CHUNK = 500;
    for (const table of DOC_SCOPED_TABLES) {
      let totalFetched = 0;
      let totalInserted = 0;
      let totalReplaced = 0;
      for (let i = 0; i < docIdList.length; i += CHUNK) {
        const slice = docIdList.slice(i, i + CHUNK);
        const placeholders = slice.map(() => '?').join(',');
        const before = summary[table];
        await mergeTable(table, `document_id IN (${placeholders})`, slice);
        const after = summary[table];
        if (after) {
          totalFetched += after.fetched - (before?.fetched ?? 0);
          totalInserted += after.inserted - (before?.inserted ?? 0);
          totalReplaced += after.replaced - (before?.replaced ?? 0);
        }
      }
      // Coalesce summary rows
      if (totalFetched > 0 || summary[table]) {
        summary[table] = {
          fetched: totalFetched || (summary[table]?.fetched ?? 0),
          inserted: totalInserted || (summary[table]?.inserted ?? 0),
          replaced: totalReplaced || (summary[table]?.replaced ?? 0),
        };
      }
    }
  }

  // Close out the merge transaction + re-enable FK enforcement
  // BEFORE uploads + FTS so any failure in those steps doesn't
  // hold the merge open in an undecided state.
  if (!args.dryRun) {
    await local.execute(`COMMIT`);
    await local.execute(`PRAGMA foreign_keys = ON`);
  }

  // [6] Uploads sync via sftp
  if (args.skipUploads) {
    console.log(`\n[4] Uploads — skipped (--skip-uploads)`);
  } else {
    console.log(`\n[4] Uploads sync`);
    // Storage paths embed tenant_id: `uploads/{tenantId}/{kbId}/...`.
    // Prod uses `t-{slug}`; local uses args.targetTenant.
    const remoteTenantId = `t-${args.tenantSlug}`;
    const remoteUploadsKb = `/data/${args.tenantSlug}/uploads/${remoteTenantId}/${args.kbId}`;
    const localUploadsKb = join(LOCAL_UPLOADS_ROOT, args.targetTenant, args.kbId);
    mkdirSync(localUploadsKb, { recursive: true });
    if (args.dryRun) {
      console.log(`  (dry-run) would mirror ${remoteUploadsKb}/ → ${localUploadsKb}/`);
    } else {
      // Note: NO `2>/dev/null` — fly's ssh wrapper splits args on
      // whitespace and treats the redirect as a path.
      const lsResult = spawnSync('flyctl', [
        'ssh', 'console', '-a', args.app,
        '-C', `find ${remoteUploadsKb} -type f`,
      ], { encoding: 'utf8' });
      if (lsResult.status !== 0) {
        console.error(`  ✗ remote ls failed: ${lsResult.stderr}`);
      } else {
        const remoteFiles = lsResult.stdout
          .split('\n')
          .filter((l) => l.startsWith(remoteUploadsKb));
        console.log(`  ${remoteFiles.length} remote files`);
        let pulled = 0;
        let skipped = 0;
        const sftpCommands: string[] = [];
        for (const remoteFile of remoteFiles) {
          // Mirror path: /data/{slug}/uploads/{tenantId}/{kbId}/foo.png
          //  → {LOCAL_UPLOADS_ROOT}/{targetTenant}/{kbId}/foo.png
          const rel = remoteFile.slice(`${remoteUploadsKb}/`.length);
          const localFile = join(localUploadsKb, rel);
          if (existsSync(localFile)) {
            skipped += 1;
            continue;
          }
          mkdirSync(join(localFile, '..'), { recursive: true });
          sftpCommands.push(`get ${remoteFile} ${localFile}`);
        }
        if (sftpCommands.length > 0) {
          const batch = spawnSync('flyctl', ['ssh', 'sftp', 'shell', '-a', args.app], {
            input: sftpCommands.join('\n') + '\n',
            encoding: 'utf8',
          });
          if (batch.status === 0) pulled = sftpCommands.length;
          else console.error(`  ✗ sftp batch failed: ${batch.stderr}`);
        }
        console.log(`  pulled ${pulled}, skipped ${skipped} (already present locally)`);
      }
    }
  }

  // [7] FTS5 rebuild on the affected KB. Cheap: only the rows we just
  //     touched. The triggers SHOULD have kept FTS in sync via INSERT
  //     OR REPLACE on documents, but a defensive rebuild on the kb-
  //     scoped slice is harmless.
  if (!args.dryRun) {
    console.log(`\n[5] FTS5 rebuild on KB ${args.kbId}`);
    try {
      // Minimal rebuild: re-trigger documents_fts row for each doc id
      // we touched. Drizzle's FTS triggers handle INSERT OR REPLACE,
      // so the data is already in sync — this is a sanity step.
      await local.execute(
        `INSERT INTO documents_fts(documents_fts) VALUES('rebuild')`,
      );
      console.log(`  ✓ FTS rebuilt`);
    } catch (err) {
      console.warn(`  ! FTS rebuild skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  await stage.close();
  await local.close();

  console.log(`\n=== Summary ===`);
  for (const [tbl, s] of Object.entries(summary)) {
    if (s.fetched === 0) continue;
    console.log(`  ${tbl.padEnd(24)} +${s.inserted} new, ~${s.replaced} updated`);
  }
  console.log(args.dryRun ? `\n(dry-run — no changes written)` : `\n✓ pull complete`);
}

main().catch((err) => {
  console.error('beam-pull failed:', err);
  process.exit(1);
});
