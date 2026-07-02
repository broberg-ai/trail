/**
 * F201.1 runtime proof — @trail/ambient-gate against the REAL engine app.
 *
 * Boots createApp() on a fresh temp DB (no port bind — Hono app.request),
 * seeds tenant/user/KB + a trail_ API key, then drives the package's
 * postCandidate() through the real HTTP route incl. auth middleware,
 * CreateQueueCandidateSchema validation, and the candidate write. Asserts:
 *   - the candidate row lands in queue_candidates in the right KB
 *   - metadata carries connector=trail-ambient-capture + kind=external-feed
 *   - a seeded secret is redacted before it ever reaches the wire
 *   - a bogus token is rejected (401) — auth is actually enforced
 *
 * Run from apps/server:  bun run scripts/verify-f201-1-ambient-gate.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, apiKeys, queueCandidates } from '@trail/db';
import { eq } from 'drizzle-orm';
import { postCandidate, AMBIENT_CONNECTOR } from '@trail/ambient-gate';
import { createApp } from '../src/app.js';

const T = 't-f201', U = 'u-f201', KB = 'kb-f201';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f201-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// Seed tenant/user/KB + a DB-backed trail_ API key (the F201.2 flow will
// mint these for real; here we plant one directly, same shape).
await trail.db.insert(tenants).values({ id: T, slug: 'f201', name: 'F201', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f201@local.trail', displayName: 'F201', role: 'owner', onboarded: true }).run();
await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Ambient test', slug: 'ambient-test', language: 'da' }).run();
const token = `trail_${randomBytes(32).toString('hex')}`;
await trail.db.insert(apiKeys).values({
  id: 'key-f201', tenantId: T, userId: U, name: 'ambient-probe',
  keyHash: createHash('sha256').update(token).digest('hex'),
}).run();

const app = createApp(trail, new Map([['f201', trail]]));
const viaApp = (url: string, init: RequestInit) => app.request(url, init);

// Synthetic Anthropic-shaped key — matches secret-scan, never a real credential.
const FAKE_SECRET = 'sk-ant-api03-' + 'Zz9yXx8w'.repeat(12);

const result = await postCandidate(
  {
    kb: 'ambient-test', // slug on purpose — proves F135 slug resolution
    title: 'Call med Acme — pricing',
    content: `Aftalt: nyt tilbud fremsendes senest fredag. Deres nøgle ${FAKE_SECRET} skal roteres.`,
    sourceUrl: 'app://Zoom/Acme weekly',
    capturedAt: new Date().toISOString(),
    confidence: 0.55,
  },
  { apiBase: 'http://engine.local', token, fetchImpl: viaApp },
);

check('POST /api/v1/queue/candidates returns 201 via the real route', result.ok && result.status === 201, `status=${result.status} ${result.error ?? ''}`);
check('candidateId returned', !!result.candidateId, result.candidateId ?? '');
check('redaction reported the seeded secret', result.redactionFindings.some((f) => f.label === 'anthropic-api-key'));

const row = result.candidateId
  ? await trail.db.select().from(queueCandidates).where(eq(queueCandidates.id, result.candidateId)).get()
  : undefined;
check('candidate row exists in queue_candidates', !!row);
check('row landed in the test KB (slug resolved to UUID)', row?.knowledgeBaseId === KB, `kb=${row?.knowledgeBaseId}`);
check('kind is external-feed', row?.kind === 'external-feed', `kind=${row?.kind}`);
const meta = row?.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {};
check(`metadata.connector = ${AMBIENT_CONNECTOR}`, meta.connector === AMBIENT_CONNECTOR, `connector=${String(meta.connector)}`);
check('stored content is redacted (secret never persisted)', !!row && !row.content.includes(FAKE_SECRET) && row.content.includes('[REDACTED:'));

// Auth is enforced: a bogus token must 401, never write.
const denied = await postCandidate(
  { kb: 'ambient-test', title: 'x', content: 'Aftalt: dette må aldrig lande i køen.' },
  { apiBase: 'http://engine.local', token: 'trail_' + '0'.repeat(64), fetchImpl: viaApp },
);
check('bogus trail_ token is rejected with 401', !denied.ok && denied.status === 401, `status=${denied.status}`);

console.log(`\n${pass} pass, ${fail} fail`);
try { rmSync(DB_PATH, { force: true }); } catch { /* leave for inspection */ }
process.exit(fail === 0 ? 0 : 1);
