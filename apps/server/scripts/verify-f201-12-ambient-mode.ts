/**
 * F201.12 proof — Ambient-tilstand noise auto-reject, end-to-end through the
 * real route → createCandidate → shouldAutoReject/shouldAutoApprove policy.
 *
 * Distill is left OFF (env TRAIL_AMBIENT_DISTILL unset) so the route does NOT
 * re-run Mistral on the probe — the metadata.distill verdict we POST is exactly
 * what the enqueue policy sees, which is what a live distill step would stamp.
 *
 * Proves:
 *   AC1 — armed KB (threshold 0.5): ambient distill=noise → auto-REJECTED
 *         (status rejected, reason 'ambient-noise (auto)'); OFF KB (null): the
 *         same noise capture → stays pending (ship-dark unchanged).
 *   AC2 — armed KB: ambient distill=knowledge conf 0.8 → still auto-APPROVED
 *         (F201.8 regression guard).
 *   +   — armed KB: a NON-ambient noise-tagged candidate → stays pending
 *         (auto-reject is ambient-only, no collateral).
 *
 * Run from apps/server:  bun run scripts/verify-f201-12-ambient-mode.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, queueCandidates } from '@trail/db';
import { eq } from 'drizzle-orm';
import { AMBIENT_CONNECTOR } from '@trail/shared';
import { createApp } from '../src/app.js';

// Guard: this test asserts the enqueue policy on a PRE-stamped verdict, so the
// route's distill step must stay off or it would overwrite metadata.distill.
delete process.env.TRAIL_AMBIENT_DISTILL;

const T = 't-f20112', U = 'u-f20112';
const KB_ON = 'kb-on12', KB_OFF = 'kb-off12';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f20112-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await trail.db.insert(tenants).values({ id: T, slug: 'f20112', name: 'F20112', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f20112@local.trail', displayName: 'F20112', role: 'owner', onboarded: true }).run();
// KB_ON = ambient mode (threshold 0.5); KB_OFF = ship-dark (NULL).
await trail.db.insert(knowledgeBases).values({ id: KB_ON, tenantId: T, createdBy: U, name: 'Armed', slug: 'armed12', language: 'da', autoApproveThreshold: 0.5 }).run();
await trail.db.insert(knowledgeBases).values({ id: KB_OFF, tenantId: T, createdBy: U, name: 'Off', slug: 'off12', language: 'da' }).run();
await trail.db.insert(sessions).values({ id: 'sess-f20112', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();

const app = createApp(trail, new Map([['f20112', trail]]));
const req = (path: string, init: RequestInit = {}) => app.request(`http://engine.local${path}`, init);
const authed = { 'Content-Type': 'application/json', Cookie: 'session=sess-f20112' };

// POST a candidate carrying a pre-stamped distill verdict; return its stored row.
async function post(kb: string, connector: string, distill: string, confidence: number) {
  const res = await req('/api/v1/queue/candidates', {
    method: 'POST', headers: authed,
    body: JSON.stringify({
      knowledgeBaseId: kb, kind: 'external-feed',
      title: `probe ${connector} ${distill}`, content: 'Ambient probe-indhold til F201.12.',
      metadata: JSON.stringify({ connector, distill }), confidence,
    }),
  });
  const body = await res.json() as { candidate?: { id?: string } };
  const row = await trail.db
    .select({ s: queueCandidates.status, r: queueCandidates.rejectionReason })
    .from(queueCandidates).where(eq(queueCandidates.id, body.candidate?.id ?? '')).get();
  return { status: row?.s ?? 'missing', reason: row?.r ?? null };
}

// AC1 — noise auto-rejects in ambient mode; stays pending when mode off.
const armedNoise = await post('armed12', AMBIENT_CONNECTOR, 'noise', 0);
check('armed KB: ambient distill=noise → rejected', armedNoise.status === 'rejected', `status ${armedNoise.status}`);
check('armed KB: reason = ambient-noise (auto)', armedNoise.reason === 'ambient-noise (auto)', `reason ${armedNoise.reason}`);
const offNoise = await post('off12', AMBIENT_CONNECTOR, 'noise', 0);
check('OFF KB (null threshold): ambient noise → pending (ship-dark)', offNoise.status === 'pending', `status ${offNoise.status}`);

// AC2 — knowledge path unbroken (F201.8 regression guard).
const armedKnowledge = await post('armed12', AMBIENT_CONNECTOR, 'knowledge', 0.8);
check('armed KB: ambient distill=knowledge conf 0.8 → approved', armedKnowledge.status === 'approved', `status ${armedKnowledge.status}`);

// Guard — auto-reject is ambient-only: a non-ambient noise-tagged candidate stays pending.
const nonAmbientNoise = await post('armed12', 'chat', 'noise', 0);
check('armed KB: NON-ambient distill=noise → pending (auto-reject is ambient-only)', nonAmbientNoise.status === 'pending', `status ${nonAmbientNoise.status}`);

console.log(`\nF201.12: ${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
