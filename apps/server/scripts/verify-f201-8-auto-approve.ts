/**
 * F201.8 proof — per-KB auto-approval for ambient captures, end-to-end through
 * the real route → createCandidate → shouldAutoApprove policy. Proves:
 *   - migration added the column; PATCH round-trips the threshold (AC0)
 *   - armed KB (threshold 0.5): ambient conf 0.8 → auto-approves to a Neuron,
 *     ambient conf 0.2 → stays pending (AC1)
 *   - OFF KB (threshold NULL): ambient conf 0.8 → stays pending — ship-dark (AC3)
 *   - armed KB: a NON-ambient candidate (createdBy set) → stays pending, i.e.
 *     the bypass is ambient-only, no regression (AC3)
 *
 * Distill is left OFF here so the confidence is exactly what we post.
 * Run from apps/server:  bun run scripts/verify-f201-8-auto-approve.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, queueCandidates } from '@trail/db';
import { eq } from 'drizzle-orm';
import { AMBIENT_CONNECTOR } from '@trail/shared';
import { createApp } from '../src/app.js';

const T = 't-f2018', U = 'u-f2018';
const KB_ON = 'kb-on', KB_OFF = 'kb-off';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f2018-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await trail.db.insert(tenants).values({ id: T, slug: 'f2018', name: 'F2018', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f2018@local.trail', displayName: 'F2018', role: 'owner', onboarded: true }).run();
// KB_ON armed at 0.5; KB_OFF left NULL (ship-dark default).
await trail.db.insert(knowledgeBases).values({ id: KB_ON, tenantId: T, createdBy: U, name: 'Armed', slug: 'armed', language: 'da', autoApproveThreshold: 0.5 }).run();
await trail.db.insert(knowledgeBases).values({ id: KB_OFF, tenantId: T, createdBy: U, name: 'Off', slug: 'off', language: 'da' }).run();
await trail.db.insert(sessions).values({ id: 'sess-f2018', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();

// AC0 — migration column present + round-trips via PATCH.
const app = createApp(trail, new Map([['f2018', trail]]));
const req = (path: string, init: RequestInit = {}) => app.request(`http://engine.local${path}`, init);
const authed = { 'Content-Type': 'application/json', Cookie: 'session=sess-f2018' };

const patch = await req(`/api/v1/knowledge-bases/off`, { method: 'PATCH', headers: authed, body: JSON.stringify({ autoApproveThreshold: 0.7 }) });
check('PATCH accepts autoApproveThreshold (200)', patch.status === 200, `status ${patch.status}`);
const readBack = await trail.db.select({ t: knowledgeBases.autoApproveThreshold }).from(knowledgeBases).where(eq(knowledgeBases.id, KB_OFF)).get();
check('threshold round-trips (0.7 read back)', readBack?.t === 0.7, `got ${readBack?.t}`);
// Clear it back to NULL so KB_OFF is the ship-dark case for the rest.
await req(`/api/v1/knowledge-bases/off`, { method: 'PATCH', headers: authed, body: JSON.stringify({ autoApproveThreshold: null }) });

// Helper: POST a candidate (session actor → createdBy set), return its stored status.
async function postAndStatus(kb: string, connector: string, confidence: number): Promise<string> {
  const res = await req('/api/v1/queue/candidates', {
    method: 'POST', headers: authed,
    body: JSON.stringify({
      knowledgeBaseId: kb, kind: 'external-feed',
      title: `probe ${connector} ${confidence}`, content: 'Beslutning: probe-indhold til F201.8.',
      metadata: JSON.stringify({ connector }), confidence,
    }),
  });
  const body = await res.json() as { candidate?: { id?: string } };
  const id = body.candidate?.id;
  const row = await trail.db.select({ s: queueCandidates.status }).from(queueCandidates).where(eq(queueCandidates.id, id!)).get();
  return row?.s ?? 'missing';
}

// AC1 — armed KB (slug 'armed').
check('armed KB: ambient conf 0.8 → auto-approved', await postAndStatus('armed', AMBIENT_CONNECTOR, 0.8) === 'approved');
check('armed KB: ambient conf 0.2 (below 0.5) → pending', await postAndStatus('armed', AMBIENT_CONNECTOR, 0.2) === 'pending');

// AC3 — ship-dark + ambient-only bypass (slug 'off').
check('OFF KB (null threshold): ambient conf 0.8 → pending (ship-dark)', await postAndStatus('off', AMBIENT_CONNECTOR, 0.8) === 'pending');
check('armed KB: NON-ambient (chat) conf 0.9 → pending (createdBy blocks, bypass is ambient-only)', await postAndStatus('armed', 'chat', 0.9) === 'pending');

console.log(`\nF201.8: ${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
