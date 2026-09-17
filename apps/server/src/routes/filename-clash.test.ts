/**
 * F275.2 AC#4 — the message shown on an upload filename clash.
 *
 * The owner chose default ON for uploads AGAINST the advice. The price is that
 * two different `rapport.pdf` in the same Brain would otherwise overwrite each
 * other's knowledge silently. This message — and the undo — is the entire safety
 * net, so it has its own test in both directions.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys, documents } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-nav', U = 'u-nav', KB = 'kb-nav';
const KEY = 'trail_' + 'n'.repeat(64);
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

type Warning = {
  kind: string;
  supersedes: { id: string; filename: string; uploadedAt: string };
  supersedesNow: boolean;
  reason: string;
  newSourceEndpoint: string;
};

/** The content varies on purpose — otherwise we hit the dedup guard on contentHash. */
async function upload(name: string, content: string, query = '') {
  const fd = new FormData();
  fd.append('file', new Blob([content], { type: 'text/markdown' }), name);
  const res = await app.request(
    `http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload${query ? query + '&' : '?'}localCompile=true`,
    { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd },
  );
  return { res, body: (await res.json()) as { id: string; sourceIdentity: string | null; warning?: Warning } };
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `nav-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'nav', name: 'Nav', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'n@b.dk', displayName: 'N', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Nav', slug: KB, language: 'da' }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(KEY).digest('hex'), scope: 'all',
  }).run();
  app = createApp(trail, new Map([['nav', trail]]));
});

test('an upload gets an identity from filename + Brain — not null', async () => {
  const { res, body } = await upload('rapport.md', '# udgave 1');
  expect(res.status).toBe(201);
  expect(body.sourceIdentity).toBe(`path:${KB}/rapport.md`);
  // First upload: nothing to supersede, so no message.
  expect(body.warning).toBeUndefined();
});

test('AC#4 — the same filename again: the user is told it SUPERSEDES, WITH A DATE', async () => {
  const { body } = await upload('rapport.md', '# udgave 2, helt andet indhold');
  const w = body.warning;
  expect(w?.kind).toBe('same-source');
  expect(w?.supersedes.filename).toBe('rapport.md');
  // The date is the whole point: "this supersedes rapport.md from 3 September".
  expect(typeof w?.supersedes.uploadedAt).toBe('string');
  expect(Number.isNaN(Date.parse(w!.supersedes.uploadedAt))).toBe(false);
  expect(w?.supersedesNow).toBe(true);
  expect(w?.reason).toBe('on');
});

test('the message says what HAPPENS, not what is configured — Brain OFF ⇒ supersedesNow false', async () => {
  // A message claiming "this supersedes …" while the switch was OFF would be
  // wrong in the reassuring direction: the user would believe something happened.
  await trail.db.update(knowledgeBases).set({ newVersionIsCanon: false }).where(eq(knowledgeBases.id, KB)).run();
  const { body } = await upload('rapport.md', '# udgave 3');
  expect(body.warning?.supersedesNow).toBe(false);
  expect(body.warning?.reason).toBe('brain-off');
  await trail.db.update(knowledgeBases).set({ newVersionIsCanon: true }).where(eq(knowledgeBases.id, KB)).run();
});

test('AC#4 the undo — "this is a new source" gives the file its OWN identity', async () => {
  const { body } = await upload('rapport.md', '# helt andet værk, samme navn');
  expect(body.warning).toBeDefined();

  const res = await app.request(`http://engine.local${body.warning!.newSourceEndpoint}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}` },
  });
  expect(res.status).toBe(200);

  // READ IT BACK from the database — not from the response's own echo.
  const row = await trail.db
    .select({ id: documents.sourceIdentity }).from(documents).where(eq(documents.id, body.id)).get();
  expect(row?.id).toBe(`path:${KB}/${body.id}/rapport.md`);
});

test('a file marked "new source" NEVER triggers the message again', async () => {
  // The load-bearing half of the undo: if the choice only held until the next
  // upload, the user's decision would vanish without anyone being told.
  const { body } = await upload('rapport.md', '# endnu en udgave', '?newSource=true');
  expect(body.warning).toBeUndefined();
  expect(body.sourceIdentity).toBe(`path:${KB}/${body.id}/rapport.md`);
});

test('NEGATIVE CONTROL — a DIFFERENT filename is not a clash', async () => {
  // Without it, "always warn" would pass just as green as the real rule.
  const { body } = await upload('et-andet-navn.md', '# uafhængigt værk');
  expect(body.warning).toBeUndefined();
});

/**
 * THE PATH THE ADMIN PANEL ACTUALLY USES.
 *
 * There are two upload paths: the single POST above and the chunked one below.
 * The panel uses ONLY the chunked one. Testing just the first would leave the
 * message green in the suite and missing on the screen — and a safety net that
 * exists only in the tests is not a safety net.
 */
async function uploadChunked(name: string, content: string, query = '') {
  const bytes = new TextEncoder().encode(content);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const init = await app.request(
    `http://engine.local/api/v1/knowledge-bases/${KB}/documents/upload/init${query ? query + '&' : '?'}localCompile=true`,
    { method: 'POST', headers: H, body: JSON.stringify({ filename: name, contentLength: bytes.length, contentHash: hash }) },
  );
  expect(init.status).toBe(201);
  const { uploadId } = (await init.json()) as { uploadId: string };

  const chunk = await app.request(`http://engine.local/api/v1/uploads/${uploadId}/chunk`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
  });
  expect(chunk.status).toBe(200);

  const fin = await app.request(`http://engine.local/api/v1/uploads/${uploadId}/finalize`, {
    method: 'POST', headers: H, body: JSON.stringify({ contentHash: hash }),
  });
  return { res: fin, body: (await fin.json()) as { doc?: { id: string; sourceIdentity: string | null }; warning?: Warning } };
}

test('the CHUNKED path yields the same identity as the single POST', async () => {
  const { res, body } = await uploadChunked('chunket.md', '# chunket udgave 1');
  expect(res.status).toBe(201);
  expect(body.doc?.sourceIdentity).toBe(`path:${KB}/chunket.md`);
  expect(body.warning).toBeUndefined();
});

test('AC#4 on the path ADMIN uses: same name again ⇒ a message with a date', async () => {
  const { body } = await uploadChunked('chunket.md', '# chunket udgave 2, andet indhold');
  expect(body.warning?.kind).toBe('same-source');
  expect(body.warning?.supersedes.filename).toBe('chunket.md');
  expect(Number.isNaN(Date.parse(body.warning!.supersedes.uploadedAt))).toBe(false);
  expect(body.warning?.supersedesNow).toBe(true);
});

test('the two paths agree on the identity — otherwise "same source" depended on the client', async () => {
  // A file uploaded via one path must be recognised by the other.
  const { body } = await upload('chunket.md', '# nu via enkelt-POST');
  expect(body.sourceIdentity).toBe(`path:${KB}/chunket.md`);
  expect(body.warning?.supersedes.filename).toBe('chunket.md');
});

/**
 * F263.8 — the key scope applies to the UNDO route too.
 *
 * Found in the security review of my own endpoint: an `ambient`-scoped key could
 * change the source identity of ANY document in the tenant, including in a Brain
 * it had never been granted access to. The consequence is quiet — a source whose
 * identity has changed is no longer recognised as a previous edition, so
 * supersession skips it without anything failing.
 */
import { apiKeys as keyTable, knowledgeBases as brainTable } from '@trail/db';

const SCOPED = 'trail_' + 'g'.repeat(64);
const OTHER_KB = 'kb-anden';

test('SECURITY: a SCOPED key CANNOT move the identity — and the rejection is complete', async () => {
  // The key is granted to a DIFFERENT Brain than the one the file lives in.
  await trail.db.insert(brainTable).values({
    id: OTHER_KB, tenantId: T, createdBy: U, name: 'Anden', slug: OTHER_KB, language: 'da', isSandbox: true,
  }).run();
  await trail.db.insert(keyTable).values({
    id: 'k-scoped', tenantId: T, userId: U, name: 'scoped',
    keyHash: createHash('sha256').update(SCOPED).digest('hex'),
    scope: 'ambient', scopeKbIds: JSON.stringify([OTHER_KB]),
  }).run();

  const { body } = await upload('afgraenset.md', '# en fil i KB');
  const res = await app.request(`http://engine.local/api/v1/documents/${body.id}/new-source`, {
    method: 'POST', headers: { Authorization: `Bearer ${SCOPED}` },
  });
  expect(res.status).toBe(403);
  // MEASURED, not assumed: the rejection comes from the OUTERMOST guard — the
  // path allowlist in middleware/auth.ts, which this route is not on. My first
  // assumption was that the route itself would stop it; that did not hold, so the
  // test asserts on what ACTUALLY happens. The route's own check is a second
  // door: the day someone widens the allowlist, it is the difference between an
  // opening and a silent opening.
  expect((await res.json() as { error: string }).error).toContain('ambient key scope');

  // And the identity is UNTOUCHED — the rejection must not be half-completed.
  const after = await trail.db
    .select({ i: documents.sourceIdentity }).from(documents).where(eq(documents.id, body.id)).get();
  expect(after!.i).toBe(`path:${KB}/afgraenset.md`);
});

test('NEGATIVE CONTROL: an UNSCOPED key can still undo', async () => {
  // Without it, "reject everyone" would pass just as green — and the curator
  // would have lost the one choice that is the whole safety net behind default ON.
  const { body } = await upload('uafgraenset.md', '# en anden fil');
  const res = await app.request(`http://engine.local/api/v1/documents/${body.id}/new-source`, {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}` },
  });
  expect(res.status).toBe(200);
});
