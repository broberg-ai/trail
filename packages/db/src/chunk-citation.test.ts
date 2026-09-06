/**
 * F261.3 — EN NEURON DER LEVERER INDHOLD SKAL KUNNE KREDITERES.
 *
 * MÅLT 6/9 på ejerens eget spørgsmål: chat-svaret kom ordret fra hans egen
 * Neuron, mens kilderne pegede på flagskibe-broberg-ai.md og
 * hosting-broberg-ai-md.md. Årsagen lå to lag nede: chattens STUMP-løkke
 * havde ingen citations.push, og et stump-træf bar ikke moderdokumentets
 * identitet — så den KUNNE ikke kreditere nogen, selv hvis den ville.
 *
 * Fordi løkken samtidig lægger dokumentet i `seen`, sprang dokument-løkken
 * det over bagefter. Citaterne viste derfor konsekvent de dokumenter der
 * bidrog MINDST.
 *
 * Det er ikke kosmetik: citaterne er den eneste måde et menneske kan
 * kontrollere OM chatten svarer fra hjernen eller finder på noget.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibsqlDatabase, type TrailDatabase } from './index.js';

const dir = mkdtempSync(join(tmpdir(), 'f261-cite-'));
let db: TrailDatabase;
const T = 't-1', KB = 'kb-1';

beforeAll(async () => {
  db = await createLibsqlDatabase({ path: join(dir, 'c.db') });
  await db.runMigrations();
  await db.initFTS();
  await db.execute(`INSERT INTO tenants (id, slug, name) VALUES (?,?,?)`, [T, 't1', 'T1']);
  await db.execute(`INSERT INTO users (id, tenant_id, email, role) VALUES (?,?,?,?)`, ['u-1', T, 'a@b.dk', 'owner']);
  await db.execute(`INSERT INTO knowledge_bases (id, tenant_id, created_by, slug, name) VALUES (?,?,?,?,?)`,
    [KB, T, 'u-1', 'kb1', 'KB1']);
  await db.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, filename, file_type, path, title, content, kind, archived)
     VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
    ['d1', T, KB, 'u-1', 'christian-broberg.md', 'md', '/neurons/entities/', 'Christian Broberg',
     'Christian Broberg driver broberg.ai og arbejder med symfoni-metaforen.', 'wiki'],
  );
  await db.execute(
    `INSERT INTO document_chunks (id, tenant_id, knowledge_base_id, document_id, chunk_index, content, header_breadcrumb, token_count)
     VALUES (?,?,?,?,?,?,?,?)`,
    ['c1', T, KB, 'd1', 0, 'Christian Broberg driver broberg.ai og arbejder med symfoni-metaforen.', null, 12],
  );
});
afterAll(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('et stump-træf bærer moderdokumentets identitet', async () => {
  const hits = await db.searchChunks('symfoni', KB, T, 5);
  expect(hits.length).toBeGreaterThan(0);
  const h = hits[0]!;
  // Uden disse tre KAN chattens stump-løkke ikke kreditere nogen.
  expect(h.docFilename).toBe('christian-broberg.md');
  expect(h.docPath).toBe('/neurons/entities/');
  expect(h.docTitle).toBe('Christian Broberg');
});

test('NEGATIV KONTROL: felterne er ikke bare tomme strenge der ligner et svar', async () => {
  // Den ægte fejl var et FRAVÆR. Et felt der altid er '' ville bestå en
  // «feltet findes»-prøve og stadig gøre kreditering umulig.
  const h = (await db.searchChunks('symfoni', KB, T, 5))[0]!;
  expect(h.docFilename.length).toBeGreaterThan(0);
  expect(h.docTitle.length).toBeGreaterThan(0);
});

test('identiteten hører til MODERDOKUMENTET, ikke til stumpen', async () => {
  const h = (await db.searchChunks('symfoni', KB, T, 5))[0]!;
  expect(h.documentId).toBe('d1');
  expect(h.docFilename).toBe('christian-broberg.md'); // ikke stumpens eget id
});
