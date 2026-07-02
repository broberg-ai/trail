/**
 * F201.4 runtime proof — the full ambient relay pipeline against the REAL
 * engine, no human clicks. Mints an ambient token through the real F201.2
 * device-auth flow (approve → claim), then drives the relay's exact
 * pipeline (deny-list → windowEvents → summarizeWindow → scoreChunk →
 * postCandidate) over a synthetic focus.jsonl and asserts:
 *   - a real capture session lands candidate(s) attributed to the connector
 *   - deny-listed apps produce ZERO candidates
 *   - a multi-event burst yields ONE candidate (anti-flood batching)
 *   - a seeded secret is redacted before it reaches the queue
 *
 * Run from apps/server:  bun run scripts/verify-f201-4-relay-e2e.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, queueCandidates } from '@trail/db';
import { eq, like } from 'drizzle-orm';
import {
  windowEvents, summarizeWindow, scoreChunk, postCandidate, isDenyListed, AMBIENT_CONNECTOR,
  type RelayEvent,
} from '@trail/ambient-gate';
import { createApp } from '../src/app.js';

const T = 't-f201d', U = 'u-f201d', KB = 'kb-f201d';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f201d-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await trail.db.insert(tenants).values({ id: T, slug: 'f201d', name: 'F201d', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f201d@local.trail', displayName: 'F201d', role: 'owner', onboarded: true }).run();
await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Ambient Test', slug: 'ambient-test', language: 'da' }).run();
await trail.db.insert(sessions).values({ id: 'sess-f201d', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();

process.env.TRAIL_AMBIENT_AUTH = '1';
const app = createApp(trail, new Map([['f201d', trail]]));
const req = (path: string, init: RequestInit = {}) => app.request(`http://engine.local${path}`, init);
const json = { 'Content-Type': 'application/json' };

// ── Real device-auth: approve (session) → claim → ambient token ────────
const code = randomBytes(32).toString('hex');
await req('/api/v1/ambient/approve', {
  method: 'POST', headers: { ...json, Cookie: 'session=sess-f201d' },
  body: JSON.stringify({ code, deviceName: 'cb-m1', kbIds: [KB] }),
});
const claim = await (await req('/api/v1/ambient/token', { method: 'POST', headers: json, body: JSON.stringify({ code }) })).json() as { token: string; kbIds: string[] };
check('device-auth minted an ambient token bound to Ambient Test', !!claim.token?.startsWith('trail_') && claim.kbIds[0] === KB);
const token = claim.token;

// The relay posts to the engine; here that engine is the in-process app.
const postOpts = { apiBase: 'http://engine.local', token, fetchImpl: (u: string, i: RequestInit) => app.request(u, i) };

// ── Synthetic focus.jsonl: a work session + a deny-listed app + a
//    seeded secret in a window title. Mirrors what the Swift agent logs.
const FAKE_SECRET = 'sk-ant-api03-' + 'Kj7Lm9Qr'.repeat(12);
const events: RelayEvent[] = [
  { app: 'Safari', windowTitle: 'Acme CRM — Deal 4471', ts: '2026-07-02T09:00:00Z' },
  { app: 'Safari', windowTitle: 'Acme CRM — Deal 4471', ts: '2026-07-02T09:00:40Z' },
  { app: 'Safari', windowTitle: 'Tilbud 2026 — pris og levering', ts: '2026-07-02T09:01:30Z' },
  { app: 'Mail', windowTitle: `Re: kontrakt (nøgle ${FAKE_SECRET})`, ts: '2026-07-02T09:02:10Z' },
  { app: '1Password', windowTitle: 'Login vault', ts: '2026-07-02T09:02:30Z' }, // deny-listed
  { app: 'iTerm2', windowTitle: 'TRAIL', ts: '2026-07-02T09:03:00Z' },
  // 20 min gap → a SECOND session window
  { app: 'Slack', windowTitle: 'general', ts: '2026-07-02T09:25:00Z' },
];

// Relay pipeline: deny-list filter → window → summarize → post.
const kept = events.filter((e) => !isDenyListed(e.app));
check('deny-list filtered the 1Password event before windowing', kept.length === events.length - 1 && !kept.some((e) => e.app === '1Password'));

const windows = windowEvents(kept);
check('multi-event burst folded into 2 session windows (gap split)', windows.length === 2, `windows=${windows.length}`);
check('first window batches 5 events into ONE (anti-flood)', windows[0]!.length === 5, `n=${windows[0]!.length}`);

for (const w of windows) {
  const summary = summarizeWindow(w);
  const gate = scoreChunk(summary.content);
  const r = await postCandidate(
    { kb: 'ambient-test', title: summary.title, content: summary.content, sourceUrl: `ambient://focus-session/${summary.start}`, capturedAt: summary.end, confidence: Math.max(0.05, gate.score) },
    postOpts,
  );
  check(`window ${summary.start.slice(11, 16)} → candidate 201`, r.ok, `status=${r.status}`);
}

// ── Assert against the queue: exactly 2 candidates, connector-attributed,
//    secret redacted at rest.
const rows = await trail.db.select().from(queueCandidates)
  .where(like(queueCandidates.metadata, `%"connector":"${AMBIENT_CONNECTOR}"%`)).all();
check('exactly 2 ambient candidates in the queue (one per window)', rows.length === 2, `count=${rows.length}`);
check('all candidates attributed to trail-ambient-capture', rows.every((r) => r.metadata?.includes(AMBIENT_CONNECTOR)));
const secretLeaked = rows.some((r) => r.content.includes(FAKE_SECRET) || r.title.includes(FAKE_SECRET));
check('seeded secret NEVER reached the queue (redacted at rest)', !secretLeaked);
const redactedPresent = rows.some((r) => r.content.includes('[REDACTED:'));
check('the Mail window title was redacted in-place', redactedPresent);

console.log(`\n${pass} pass, ${fail} fail`);
try { rmSync(DB_PATH, { force: true }); } catch { /* leave for inspection */ }
process.exit(fail === 0 ? 0 : 1);
