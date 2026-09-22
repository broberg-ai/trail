/**
 * F201.10 AC#2 — kandidater fra to enheder kan skelnes, og det er SERVEREN der
 * afgør hvilken enhed, ikke klienten.
 *
 * Kørt gennem den ægte app og den ægte auth — to ambient-nøgler i samme
 * tenant, begge bevilget samme delte Brain — og LÆST TILBAGE FRA BASEN, ikke
 * fra svaret. Et svar siger hvad ruten mente den gjorde; rækken er det der
 * faktisk står i køen.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys, queueCandidates } from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from './../app.js';

const T = 't-dev', U = 'u-dev', KB = '8f14e45f-ceea-467a-9575-0c3b1b5c1f2e';
const TOKEN_A = 'trail_device_a_' + 'a'.repeat(40);
const TOKEN_B = 'trail_device_b_' + 'b'.repeat(40);
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function post(token: string, title: string, metadata: unknown) {
  const res = await app.request('http://engine.local/api/v1/queue/candidates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      knowledgeBaseId: KB,
      kind: 'external-feed',
      title,
      content: `Indhold fra ${title} med nok ord til at være en rigtig optagelse.`,
      metadata: JSON.stringify(metadata),
    }),
  });
  if (res.status !== 201) console.log('SVAR', res.status, await res.clone().text());
  return res;
}

async function storedDevice(title: string) {
  const row = await trail.db
    .select({ metadata: queueCandidates.metadata })
    .from(queueCandidates)
    .where(eq(queueCandidates.title, title))
    .get();
  return row ? (JSON.parse(row.metadata ?? '{}') as { device?: { keyId: string; name: string } }).device : undefined;
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `dev-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'dev', name: 'Dev', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'd@v.dk', displayName: 'D', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Delt', slug: 'delt', language: 'da' }).run();
  // Samme form som device-auth mønter dem: `ambient:<enhed>:<id8>`.
  for (const [id, name, tok] of [
    ['key-a', 'ambient:Mac A:1a2b3c4d', TOKEN_A],
    ['key-b', 'ambient:Mac B:5e6f7a8b', TOKEN_B],
  ] as const) {
    await trail.db.insert(apiKeys).values({
      id, tenantId: T, userId: U, name, keyHash: sha(tok), scope: 'ambient', scopeKbIds: JSON.stringify([KB]),
    }).run();
  }
  app = createApp(trail, new Map([['dev', trail]]));
});

test('DEN BÆRENDE: to enheder i samme delte Brain lander under hvert sit navn', async () => {
  expect((await post(TOKEN_A, 'fra-a', { connector: 'trail-ambient-capture' })).status).toBe(201);
  expect((await post(TOKEN_B, 'fra-b', { connector: 'trail-ambient-capture' })).status).toBe(201);

  // STRENG LIGHED, ikke «indeholder».
  expect(await storedDevice('fra-a')).toEqual({ keyId: 'key-a', name: 'Mac A' });
  expect(await storedDevice('fra-b')).toEqual({ keyId: 'key-b', name: 'Mac B' });
});

test('en enhed der UDGIVER SIG for at være en anden, lander under sit eget navn', async () => {
  // Mac B påstår at være Mac A. Serveren ved hvilken nøgle der kaldte.
  const res = await post(TOKEN_B, 'forfalsket', {
    connector: 'trail-ambient-capture',
    device: { keyId: 'key-a', name: 'Mac A' },
  });
  expect(res.status).toBe(201);
  expect(await storedDevice('forfalsket')).toEqual({ keyId: 'key-b', name: 'Mac B' });
});
