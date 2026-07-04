// F182.9 — regression guard: an ARCHIVED Neuron's chunks must never come back
// from searchChunks. Chat retrieval (retrieveContext) pulls searchChunks and
// pushes every wiki chunk into the LLM context, so a chunk that survives archive
// leaks the archived Neuron's prose into answers. CHUNKS_SQL was missing the
// `AND pd.archived = 0` filter that DOCUMENTS_SQL already had. This test inserts
// a wiki Neuron + chunk, confirms searchChunks finds it, archives the Neuron, and
// asserts it is gone. RED before the fix, GREEN after.
import { expect, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { runMigrationsByHash } from './migrate-runner.js';
import { initFTS } from './fts.js';
import { searchChunks } from './search.js';

const MIGRATIONS = resolve(import.meta.dir, '../drizzle');

test('searchChunks excludes chunks of an ARCHIVED Neuron', async () => {
  const dbFile = resolve(import.meta.dir, `../.tmp-search-test-${process.pid}.db`);
  const client = createClient({ url: `file:${dbFile}` });
  try {
    await client.execute('PRAGMA foreign_keys = ON');
    await runMigrationsByHash(client, MIGRATIONS);
    await initFTS(client); // documents_fts + chunks_fts + sync triggers

    await client.execute("INSERT INTO tenants (id, slug, name) VALUES ('t1','t1','T1')");
    await client.execute("INSERT INTO users (id, tenant_id, email) VALUES ('u1','t1','a@b.c')");
    await client.execute(
      "INSERT INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES ('k1','t1','k1','K1','u1')",
    );
    // A wiki Neuron (archived defaults to 0) + one chunk carrying a distinctive term.
    await client.execute(
      "INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path) " +
        "VALUES ('d1','t1','k1','u1','wiki','d1.md','md','/neurons/concepts/')",
    );
    await client.execute(
      "INSERT INTO document_chunks (id, tenant_id, document_id, knowledge_base_id, chunk_index, content, token_count) " +
        "VALUES ('c1','t1','d1','k1',0,'The wolverine roams the northern forest',7)",
    );

    // Baseline: the chunk is retrievable while the Neuron is live.
    const before = await searchChunks(client, 'wolverine', 'k1', 't1', 10);
    expect(before.length).toBe(1);
    expect(before[0]!.documentId).toBe('d1');

    // Archive the Neuron (the product's "delete" — soft-delete, keeps the row).
    await client.execute("UPDATE documents SET archived = 1 WHERE id = 'd1'");

    // The archived Neuron's chunk MUST NOT surface (else it leaks into chat).
    const after = await searchChunks(client, 'wolverine', 'k1', 't1', 10);
    expect(after.length).toBe(0);
  } finally {
    client.close();
    rmSync(dbFile, { force: true });
    rmSync(`${dbFile}-wal`, { force: true });
    rmSync(`${dbFile}-shm`, { force: true });
  }
});
