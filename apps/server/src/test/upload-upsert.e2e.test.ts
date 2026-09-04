/**
 * F243.1 — the gate for upsert-on-sourceUrl.
 *
 * Runs through the REAL route (createApp), and the chunk claims are read back
 * through the SEARCH endpoint — it is the READER's path that is asserted, not
 * the writer's. A test that only counted rows after an update would be green
 * while search still served the old text.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, documents } from '@trail/db';
import { eq, and } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-ups', U = 'u-ups', KB = 'kb-ups';
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `upsert-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  // The uploads land in the real storage root under this tenant prefix —
  // unique tenant id per run keeps them isolated (the F241 lesson: pointing a
  // fake env var at storage silently does nothing).
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.initFTS();
  await trail.db.insert(tenants).values({ id: T, slug: 'ups', name: 'Ups', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'ups@local.trail', displayName: 'U', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'KB', slug: 'kb', language: 'da' }).run();
  await trail.db.insert(sessions).values({ id: 'sess-ups', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();
  app = createApp(trail, new Map([['ups', trail]]));
});

const upload = async (
  markdown: string,
  opts: { sourceUrl?: string; filename?: string; force?: boolean } = {},
) => {
  const fd = new FormData();
  fd.set('file', new File([markdown], opts.filename ?? 'side.md', { type: 'text/markdown' }));
  fd.set('path', '/');
  if (opts.sourceUrl) {
    fd.set('metadata', JSON.stringify({ connector: 'broberg-ai-site-sync', sourceUrl: opts.sourceUrl }));
  }
  const qs = opts.force ? '?force=true' : '';
  const res = await app.request(`http://engine.local/api/v1/knowledge-bases/kb/documents/upload${qs}`, {
    method: 'POST',
    headers: { Cookie: 'session=sess-ups' },
    body: fd,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const docCount = async (): Promise<number> =>
  (await trail.db.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.knowledgeBaseId, KB), eq(documents.kind, 'source'))).all()).length;

const search = async (q: string): Promise<number> => {
  const res = await app.request(
    `http://engine.local/api/v1/knowledge-bases/kb/search?q=${encodeURIComponent(q)}&limit=10`,
    { headers: { Cookie: 'session=sess-ups' } },
  );
  // The endpoint answers { documents, chunks } — counted together, because a
  // match in EITHER means a reader can find the text.
  const body = (await res.json()) as { documents?: unknown[]; chunks?: unknown[] };
  return (body.documents ?? []).length + (body.chunks ?? []).length;
};

const URL1 = 'https://broberg.ai/flagskibe/trail';

test('first push of a sourceUrl creates — 201, one document', async () => {
  const r = await upload('# Trail\n\nOriginalordet kildekildeord her.', { sourceUrl: URL1 });
  expect(r.status).toBe(201);
  expect(await docCount()).toBe(1);
});

test('re-push, UNCHANGED bytes: 200 unchanged, same id, count stable, row untouched', async () => {
  const before = await trail.db.select().from(documents).where(eq(documents.knowledgeBaseId, KB)).get();
  const r = await upload('# Trail\n\nOriginalordet kildekildeord her.', { sourceUrl: URL1 });
  expect(r.status).toBe(200);
  expect(r.body.upsert).toBe('unchanged');
  expect(r.body.id).toBe(before!.id);
  expect(await docCount()).toBe(1);
  const after = await trail.db.select().from(documents).where(eq(documents.id, before!.id)).get();
  expect(after!.updatedAt).toBe(before!.updatedAt); // not even a timestamp moved
  expect(after!.contentHash).toBe(before!.contentHash);
});

test('re-push, CHANGED bytes: 200 updated, same id, version bumped, count stable', async () => {
  const before = await trail.db.select().from(documents).where(eq(documents.knowledgeBaseId, KB)).get();
  const r = await upload('# Trail\n\nHelt nyt indhold med nyhedsordet erstatningsord.', { sourceUrl: URL1 });
  expect(r.status).toBe(200);
  expect(r.body.upsert).toBe('updated');
  expect(r.body.id).toBe(before!.id);
  expect(await docCount()).toBe(1);
  const after = await trail.db.select().from(documents).where(eq(documents.id, before!.id)).get();
  expect(after!.contentHash).not.toBe(before!.contentHash);
  expect((after!.version ?? 0)).toBeGreaterThan(before!.version ?? 0);
  expect(after!.status).toBe('processing');
});

// THE READ-BACK, both directions. Counting chunk rows would prove the write;
// only the search endpoint proves what a READER now finds.
test('after the update, search finds the new word and NOT the old-only word', async () => {
  expect(await search('erstatningsord')).toBeGreaterThan(0);
  expect(await search('kildekildeord')).toBe(0);
});

test('NEGATIVE CONTROL — same bytes, DIFFERENT sourceUrl: still 409 duplicate_source', async () => {
  const r = await upload('# Trail\n\nHelt nyt indhold med nyhedsordet erstatningsord.', {
    sourceUrl: 'https://broberg.ai/en-anden-side',
  });
  expect(r.status).toBe(409);
  expect(r.body.code).toBe('duplicate_source');
  expect(await docCount()).toBe(1);
});

test('NEGATIVE CONTROL — no sourceUrl at all: behaviour untouched (409 on dup hash, 201 on new)', async () => {
  const dup = await upload('# Trail\n\nHelt nyt indhold med nyhedsordet erstatningsord.', {});
  expect(dup.status).toBe(409);
  const fresh = await upload('# Uden URL\n\nEt selvstændigt dokument.', { filename: 'anden.md' });
  expect(fresh.status).toBe(201);
  expect(await docCount()).toBe(2);
});

test('?force=true skips the upsert — the escape hatch to intentionally fork survives', async () => {
  const r = await upload('# Trail\n\nTredje udgave via force.', { sourceUrl: URL1, force: true });
  expect(r.status).toBe(201);
  expect(r.body.upsert).toBeUndefined();
  expect(await docCount()).toBe(3);
});
