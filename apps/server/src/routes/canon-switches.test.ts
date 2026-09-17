/**
 * F275.2 — the two switches, measured through the endpoint.
 *
 * The tests are written against the acceptance criteria: default ON (AC#2), the
 * hierarchy (AC#3), SAVE PROOF via a FRESH read (AC#5), and negative controls on
 * both another Brain and another connector (AC#6).
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys, documents } from '@trail/db';
import { createApp } from '../app.js';

const T = 't-kan', U = 'u-kan', A = 'kb-a', B = 'kb-b';
const KEY = 'trail_' + 'k'.repeat(64);
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

type Settings = {
  brain: boolean;
  disabledConnectors: string[];
  connectors: { id: string; label: string; sourceCount: number; ownSwitch: boolean; overriddenByBrain: boolean; effective: boolean }[];
};

/** A FRESH read — never the PATCH response's own echo. That is the whole point
 *  of AC#5. */
async function read(kb: string): Promise<Settings> {
  const res = await app.request(`http://engine.local/api/v1/knowledge-bases/${kb}/canon-settings`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Settings;
}

async function patch(kb: string, body: unknown) {
  return app.request(`http://engine.local/api/v1/knowledge-bases/${kb}/canon-settings`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function connector(s: Settings, id: string) {
  return s.connectors.find((k) => k.id === id);
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `kanon-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'kan', name: 'Kan', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'k@b.dk', displayName: 'K', role: 'owner', onboarded: true }).run();
  // slug == id: resolveKbId looks up a non-UUID by SLUG, not by id.
  for (const id of [A, B])
    await trail.db.insert(knowledgeBases).values({ id, tenantId: T, createdBy: U, name: id, slug: id, language: 'da' }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(KEY).digest('hex'), scope: 'all',
  }).run();
  // Two connectors on A's sources, so the list is MEASURED and not read off the
  // static registry. `broberg-ai-site-sync` is NOT in @trail/shared's registry —
  // which is exactly why it is here: a list built from the registry would be
  // missing the very switch the owner needs.
  let n = 0;
  for (const [c, count] of [['broberg-ai-site-sync', 3], ['upload', 1]] as const)
    for (let i = 0; i < count; i++)
      await trail.db.insert(documents).values({
        id: `d${n++}`, tenantId: T, userId: U, knowledgeBaseId: A, path: '/sources/', filename: `f${n}.md`,
        content: 'x', kind: 'source', fileType: 'md', metadata: JSON.stringify({ connector: c }),
      }).run();
  app = createApp(trail, new Map([['kan', trail]]));
});

test('AC#2 — a fresh Brain: BOTH switches are ON without anyone touching them', async () => {
  const s = await read(A);
  expect(s.brain).toBe(true);
  expect(s.disabledConnectors).toEqual([]);
  expect(s.connectors.length).toBe(2);
  for (const k of s.connectors) expect([k.ownSwitch, k.effective, k.overriddenByBrain]).toEqual([true, true, false]);
});

test('the connector list is MEASURED from the Brain\'s own sources — not read off the registry', async () => {
  const s = await read(A);
  const site = connector(s, 'broberg-ai-site-sync');
  expect(site?.sourceCount).toBe(3);
  // Outside the registry ⇒ the id is its own label rather than disappearing.
  expect(site?.label).toBe('broberg-ai-site-sync');
  expect(connector(s, 'upload')?.label).toBe('Upload');
});

test('AC#5 SAVE PROOF — switch the connector off, read AFRESH, it is still off', async () => {
  expect((await patch(A, { connector: { id: 'upload', canon: false } })).status).toBe(200);
  const fresh = await read(A);
  expect(fresh.disabledConnectors).toEqual(['upload']);
  expect(connector(fresh, 'upload')?.effective).toBe(false);
  // The other connector in the SAME Brain is untouched — otherwise we saved on
  // the Brain instead of on the connector, and that would pass AC#5 by accident.
  expect(connector(fresh, 'broberg-ai-site-sync')?.effective).toBe(true);
});

test('AC#5 the way back — switch it on again, read AFRESH, it is on', async () => {
  // A switch that can only be SET looks identical to one that works, until
  // someone tries to clear it. So the way back has its own test.
  expect((await patch(A, { connector: { id: 'upload', canon: true } })).status).toBe(200);
  const fresh = await read(A);
  expect(fresh.disabledConnectors).toEqual([]);
  expect(connector(fresh, 'upload')?.effective).toBe(true);
});

test('AC#3 — Brain OFF turns EVERYTHING off, and the connector shows as OVERRIDDEN', async () => {
  expect((await patch(A, { brain: false })).status).toBe(200);
  const fresh = await read(A);
  expect(fresh.brain).toBe(false);
  for (const k of fresh.connectors) {
    expect(k.ownSwitch).toBe(true);           // the switch still reads ON …
    expect(k.overriddenByBrain).toBe(true);   // … but it is overridden, and that is VISIBLE
    expect(k.effective).toBe(false);
  }
});

test('AC#3 — a connector that is itself off is not "overridden", it is simply off', async () => {
  await patch(A, { connector: { id: 'upload', canon: false } });
  const fresh = await read(A);
  const k = connector(fresh, 'upload');
  expect([k?.ownSwitch, k?.overriddenByBrain, k?.effective]).toEqual([false, false, false]);
});

test('a switch the user turned OFF does not disappear even when no source carries the connector', async () => {
  // Otherwise they cannot turn it back on — the switch would be gone from the
  // screen while still taking effect in the database.
  await patch(A, { connector: { id: 'a-connector-with-no-sources', canon: false } });
  expect(connector(await read(A), 'a-connector-with-no-sources')?.sourceCount).toBe(0);
});

test('AC#6 NEGATIVE CONTROL — Brain B is completely untouched by all of the above', async () => {
  const b = await read(B);
  expect(b.brain).toBe(true);
  expect(b.disabledConnectors).toEqual([]);
  // Proves the value is saved on the right ROW and not globally.
});

test('AC#3 back again — switch the Brain on: the connectors\' own switches are remembered', async () => {
  expect((await patch(A, { brain: true })).status).toBe(200);
  const fresh = await read(A);
  expect(fresh.brain).toBe(true);
  expect(connector(fresh, 'upload')?.effective).toBe(false);               // was switched off earlier
  expect(connector(fresh, 'broberg-ai-site-sync')?.effective).toBe(true);  // was not
});

test('an empty body is rejected rather than saving nothing and reporting success', async () => {
  expect((await patch(A, {})).status).toBe(400);
  expect((await patch(A, { unknownField: true })).status).toBe(400);
});

test('an unknown Brain gives 404 — not a silent 200 on the wrong row', async () => {
  const res = await app.request('http://engine.local/api/v1/knowledge-bases/findes-ikke/canon-settings', {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  expect(res.status).toBe(404);
});
