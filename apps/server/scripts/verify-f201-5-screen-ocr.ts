/**
 * F201.5 runtime proof — screen-OCR text flows through the SAME relay pipeline
 * as focus events (windowEvents → summarizeWindow → buildCandidateBody →
 * postCandidate) into the real engine queue, and asserts the story's AC:
 *   - OCR text from a "window" produces a candidate containing the marker
 *   - the outgoing request carries ONLY gated text — no image/frame bytes
 *     (egress inspection of the actual POST body)
 *   - a secret seeded into the OCR text is redacted before it reaches the queue
 *
 * The Swift side (`TrailAmbient --ocrtest`) proves the on-device OCR + delta
 * guard; this proves the text→candidate half. Together = the full path.
 *
 * Run from apps/server:  bun run scripts/verify-f201-5-screen-ocr.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, queueCandidates } from '@trail/db';
import { like } from 'drizzle-orm';
import {
  windowEvents, summarizeWindow, postCandidate, AMBIENT_CONNECTOR,
  type RelayEvent,
} from '@trail/ambient-gate';
import { createApp } from '../src/app.js';

const T = 't-f201e', U = 'u-f201e', KB = 'kb-f201e';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f201e-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await trail.db.insert(tenants).values({ id: T, slug: 'f201e', name: 'F201e', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f201e@local.trail', displayName: 'F201e', role: 'owner', onboarded: true }).run();
await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Ambient Test', slug: 'ambient-test', language: 'da' }).run();
await trail.db.insert(sessions).values({ id: 'sess-f201e', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();

process.env.TRAIL_AMBIENT_AUTH = '1';
const app = createApp(trail, new Map([['f201e', trail]]));
const req = (path: string, init: RequestInit = {}) => app.request(`http://engine.local${path}`, init);
const json = { 'Content-Type': 'application/json' };

// Device-auth: approve (session) → claim → ambient token.
const code = randomBytes(32).toString('hex');
await req('/api/v1/ambient/approve', {
  method: 'POST', headers: { ...json, Cookie: 'session=sess-f201e' },
  body: JSON.stringify({ code, deviceName: 'cb-m1', kbIds: [KB] }),
});
const claim = await (await req('/api/v1/ambient/token', { method: 'POST', headers: json, body: JSON.stringify({ code }) })).json() as { token: string };
const token = claim.token;
check('ambient token minted', !!token?.startsWith('trail_'));

// A capture window: two focus events on the same "window", each carrying the
// on-device OCR of the frontmost window. One line is a real commitment (the
// marker); a fake secret is seeded to prove redaction of OCR text.
const MARKER = 'COMMITMENT ship F201.5 screen-OCR by Friday';
const SECRET = `sk-ant-api03-${randomBytes(32).toString('hex')}`;
const events: RelayEvent[] = [
  { app: 'Google Chrome', windowTitle: 'Acme CRM — Deal 42', ts: '2026-07-02T18:00:00.000Z',
    screenText: `Møde med Acme.\n${MARKER}.\nDeres API-nøgle stod på skærmen: ${SECRET}` },
  { app: 'Google Chrome', windowTitle: 'Acme CRM — Deal 42', ts: '2026-07-02T18:00:20.000Z',
    screenText: `${MARKER}.\nNæste skridt: revideret tilbud torsdag.` },
];

// Egress inspection: wrap fetch so we see the EXACT bytes leaving the agent.
let sentBody = '';
const captureFetch = (u: string, i: RequestInit): Promise<Response> => {
  sentBody = typeof i.body === 'string' ? i.body : '';
  return app.request(u, i);
};

// Pipeline — same as the relay: one window → summarise → one candidate.
const windows = windowEvents(events, { gapMs: 60_000, maxWindowMs: 900_000 });
check('two OCR events fold into ONE window', windows.length === 1, `${windows.length} window(s)`);
const summary = summarizeWindow(windows[0]!);
check('summary content contains the OCR marker', summary.content.includes(MARKER));
check('summary renders OCR under a "Skærm:" line', summary.content.includes('Skærm:'));

const result = await postCandidate(
  { kb: 'ambient-test', title: summary.title, content: summary.content, sourceUrl: `ambient://focus-session/${summary.start}`, capturedAt: summary.end, confidence: 0.5 },
  { apiBase: 'http://engine.local', token, fetchImpl: captureFetch },
);
check('candidate POST accepted (201)', result.ok, `status ${result.status}`);
check('redaction fired on the seeded OCR secret', result.redactionFindings.length > 0, result.redactionFindings.map((f) => f.label).join(','));

// Egress AC: the outgoing body is text-only. No raw image bytes, no base64
// blob, no frame/screenshot field — only the gated candidate JSON.
const sentJson = JSON.parse(sentBody || '{}') as Record<string, unknown>;
const sentKeys = Object.keys(sentJson).sort();
const textOnlyKeys = ['confidence', 'content', 'kind', 'knowledgeBaseId', 'metadata', 'title'];
check('outgoing body has ONLY text candidate fields (no image/frame key)',
  sentKeys.every((k) => textOnlyKeys.includes(k)), sentKeys.join(','));
check('outgoing body contains NO raw secret (redacted before egress)', !sentBody.includes(SECRET));
check('outgoing body carries the OCR marker text', sentBody.includes(MARKER));
// A screenshot smuggled as base64 would be a long unbroken A–Za–z0–9+/ run.
check('outgoing body has no base64 image blob', !/[A-Za-z0-9+/]{512,}={0,2}/.test(sentBody));

// It actually landed in the queue, attributed to the connector, redacted.
const rows = await trail.db.select().from(queueCandidates).where(like(queueCandidates.knowledgeBaseId, KB)).all();
const amb = rows.filter((r) => (r.metadata ?? '').includes(AMBIENT_CONNECTOR));
check('candidate is in the queue attributed to trail-ambient-capture', amb.length === 1, `${amb.length} row(s)`);
check('stored candidate content has the marker, not the secret',
  !!amb[0] && amb[0].content!.includes(MARKER) && !amb[0].content!.includes(SECRET));

console.log(`\nF201.5: ${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
