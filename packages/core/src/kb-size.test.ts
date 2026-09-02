/**
 * F217.1 — the size of a Trail must not include bytes that are gone.
 *
 * The orphan fixture is not invented. It reproduces the shape measured on
 * production 2026-09-02: image rows whose `storage_path` begins with a tenant
 * prefix that no longer exists, claiming 501 MB with 0 bytes on disk.
 */
import { test, expect } from 'bun:test';
import { createLibsqlDatabase } from '@trail/db';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { kbSizes, toMB, type FileProbe } from './kb-size.js';

const MB = 1_048_576;

async function seed() {
  const p = join(process.env.TMPDIR ?? '/tmp', `kbsize-${process.pid}-${Math.random()}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  const trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.initFTS();
  const T = 't-size';
  await trail.execute(`INSERT INTO tenants (id, slug, name, plan) VALUES (?,?,?,?)`, [T, 'size', 'Size', 'hobby']);
  await trail.execute(`INSERT INTO users (id, tenant_id, email, display_name, role, onboarded) VALUES (?,?,?,?,?,1)`,
    ['u-size', T, 'size@local.trail', 'S', 'owner']);
  const kb = async (id: string, slug: string) =>
    trail.execute(`INSERT INTO knowledge_bases (id, tenant_id, created_by, name, slug, language) VALUES (?,?,?,?,?,?)`,
      [id, T, 'u-size', slug, slug, 'da']);
  await kb('kb-healthy', 'healthy');
  await kb('kb-orphan', 'orphan');
  await kb('kb-knowledge-only', 'knowledge-only');

  const src = async (id: string, kbId: string, bytes: number) =>
    trail.execute(`INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, path, file_type, file_size, content, archived)
                   VALUES (?,?,?,?,'source',?,'/','md',?,'x',0)`, [id, T, kbId, 'u-size', id, bytes]);
  const neuron = async (id: string, kbId: string, text: string) =>
    trail.execute(`INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, path, file_type, file_size, content, archived)
                   VALUES (?,?,?,?,'wiki',?,'/','md',0,?,0)`, [id, T, kbId, 'u-size', id, text]);
  const img = async (id: string, kbId: string, docId: string, path: string, bytes: number) =>
    trail.execute(`INSERT INTO document_images (id, document_id, tenant_id, knowledge_base_id, filename, storage_path, content_hash, size_bytes, width, height)
                   VALUES (?,?,?,?,?,?,?,?,10,10)`, [id, docId, T, kbId, id, path, id, bytes]);

  // healthy: 2 sources (3 MB), 2 images (2 MB) whose files EXIST, 1 Neuron
  await src('s1', 'kb-healthy', 2 * MB);
  await src('s2', 'kb-healthy', 1 * MB);
  await img('i1', 'kb-healthy', 's1', 'here/kb-healthy/a.png', 1 * MB);
  await img('i2', 'kb-healthy', 's1', 'here/kb-healthy/b.png', 1 * MB);
  await neuron('n1', 'kb-healthy', 'x'.repeat(500));

  // orphan: 1 source, 3 images pointing at a tenant prefix that is GONE
  await src('s3', 'kb-orphan', 5 * MB);
  await img('i3', 'kb-orphan', 's3', 't-christian/kb-orphan/page-19-img-1.png', 200 * MB);
  await img('i4', 'kb-orphan', 's3', 't-christian/kb-orphan/page-20-img-1.png', 200 * MB);
  await img('i5', 'kb-orphan', 's3', 't-christian/kb-orphan/page-21-img-1.png', 101 * MB);

  // knowledge-only: Neurons, no sources at all
  await neuron('n2', 'kb-knowledge-only', 'y'.repeat(1234));
  return { trail, T };
}

/** Only paths under `here/` exist — everything under t-christian/ is gone. */
const probe: FileProbe = (p) => (p.startsWith('here/') ? 1 * MB : null);

test('a healthy KB reports claimed == present, and flags nothing', async () => {
  const { trail, T } = await seed();
  const s = (await kbSizes(trail, T, probe)).find((x) => x.knowledgeBaseId === 'kb-healthy')!;
  expect(s.sourceBytes).toBe(3 * MB);
  expect(s.sourceCount).toBe(2);
  expect(s.imageBytesClaimed).toBe(2 * MB);
  expect(s.imageBytesPresent).toBe(2 * MB);      // NEGATIVE CONTROL
  expect(s.imageMissingCount).toBe(0);
  expect(s.knowledgeBytes).toBe(500);
  expect(s.totalBytes).toBe(3 * MB + 2 * MB + 500);
  expect(s.totalBytesClaimed).toBe(s.totalBytes); // no discrepancy to show
});

test('ORPHANS: 501 MB of missing images are not counted as present', async () => {
  const { trail, T } = await seed();
  const s = (await kbSizes(trail, T, probe)).find((x) => x.knowledgeBaseId === 'kb-orphan')!;
  expect(s.imageCount).toBe(3);
  expect(s.imageMissingCount).toBe(3);
  expect(toMB(s.imageBytesClaimed)).toBe(501);   // what the DB says
  expect(s.imageBytesPresent).toBe(0);           // what is there
  expect(s.totalBytes).toBe(5 * MB);             // sources only
  expect(toMB(s.totalBytesClaimed - s.totalBytes)).toBe(501);
});

test('the discrepancy is visible, not merged away', async () => {
  const { trail, T } = await seed();
  const all = await kbSizes(trail, T, probe);
  const orphan = all.find((x) => x.knowledgeBaseId === 'kb-orphan')!;
  const healthy = all.find((x) => x.knowledgeBaseId === 'kb-healthy')!;
  // The two states must be DISTINGUISHABLE from the caller — the whole point.
  expect(orphan.totalBytesClaimed > orphan.totalBytes).toBe(true);
  expect(healthy.totalBytesClaimed === healthy.totalBytes).toBe(true);
});

test('compiled knowledge is counted, and is not confused with source bytes', async () => {
  const { trail, T } = await seed();
  const s = (await kbSizes(trail, T, probe)).find((x) => x.knowledgeBaseId === 'kb-knowledge-only')!;
  expect(s.sourceBytes).toBe(0);
  expect(s.sourceCount).toBe(0);
  expect(s.knowledgeBytes).toBe(1234);
  expect(s.knowledgeCount).toBe(1);
  expect(s.totalBytes).toBe(1234);
});

test('the filesystem is probed once per image row and never for sources', async () => {
  const { trail, T } = await seed();
  let calls = 0;
  const counting: FileProbe = (p) => { calls++; return probe(p); };
  await kbSizes(trail, T, counting);
  expect(calls).toBe(5); // 5 image rows in the tenant; 3 sources cost zero calls
});

test('toMB rounds to one decimal', () => {
  expect(toMB(501 * MB)).toBe(501);
  expect(toMB(1_572_864)).toBe(1.5);
  expect(toMB(0)).toBe(0);
});
