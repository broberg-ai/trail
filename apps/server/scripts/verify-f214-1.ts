/**
 * F214.1 proof — a body the schema rejects must come back as a 400 that NAMES
 * the field, not as a bare 500.
 *
 * The bug, measured on prod 2026-08-27 23:38:21Z:
 *
 *   PATCH /api/v1/knowledge-bases/10096de6-…  →  500  7ms
 *
 * and nothing else. No log line, no field, no limit. The owner was editing the
 * "Admin Chat" Trail in the fd-aalborg tenant, wrote a description longer than
 * the schema's 500 characters, and got back the least useful answer a server
 * can give about text he had just spent minutes writing.
 *
 * Mechanism: six routes call `Schema.parse(await c.req.json())` directly. Zod's
 * .parse() THROWS, Hono's onError caught it, and onError treated every throw as
 * a server fault — `c.text('Internal Server Error', 500)`. Plain text, so the
 * SPA's fetch wrapper could not even read a message off it and fell back to
 * "500 Internal Server Error".
 *
 * Run from apps/server:  bun run scripts/verify-f214-1.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions } from '@trail/db';
import { eq } from 'drizzle-orm';
import { KB_DESCRIPTION_MAX, KB_NAME_MAX } from '@trail/shared';
import { createApp } from '../src/app.js';

const T = 't-f2141', U = 'u-f2141', KB = 'kb-f2141';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f2141-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await trail.db.insert(tenants).values({ id: T, slug: 'f2141', name: 'F2141', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f2141@local.trail', displayName: 'F2141', role: 'owner', onboarded: true }).run();
await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Admin Chat', slug: 'admin-chat', language: 'da', description: 'kort beskrivelse' }).run();
await trail.db.insert(sessions).values({ id: 'sess-f2141', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();

const app = createApp(trail, new Map([['f2141', trail]]));
const authed = { 'Content-Type': 'application/json', Cookie: 'session=sess-f2141' };
const patch = (body: unknown) =>
  app.request(`http://engine.local/api/v1/knowledge-bases/admin-chat`, {
    method: 'PATCH', headers: authed, body: JSON.stringify(body),
  });

/** Parse an error body without letting a non-JSON one abort the run. */
async function safeJson(res: Response): Promise<{ error?: string }> {
  try { return (await res.clone().json()) as { error?: string }; } catch { return {}; }
}

/** Read the stored description with raw SQL — never through the layer that wrote it. */
async function storedDescription(): Promise<string | null> {
  const row = await trail.client.execute({
    sql: 'SELECT description FROM knowledge_bases WHERE id = ?',
    args: [KB],
  });
  const v = (row.rows[0] as unknown as { description: string | null } | undefined)?.description;
  return v ?? null;
}

// ── AC1 — the exact prod shape: one character past the limit ────────────────
// 501, not 5000. A limit is only proven at its edge; a wildly-long string
// would also fail a limit set to any other number.
const tooLong = 'æ'.repeat(KB_DESCRIPTION_MAX + 1);
const beforeTooLong = await storedDescription();
const res401 = await patch({ description: tooLong, language: 'da', lintPolicy: 'trusting' });
check('over-long description → 400, not 500', res401.status === 400, `status ${res401.status}`);

// Read the body defensively. Under the pre-fix code this response was
// `c.text('Internal Server Error', 500)` — plain text — so .json() THREW, and
// that throw is precisely why the SPA could show no message: its fetch wrapper
// falls back to "500 Internal Server Error" when the body will not parse. A
// crash here would hide the finding behind a stack trace, so it is a check.
type ErrBody = { error?: string; issues?: Array<{ field: string; message: string }> };
let body401: ErrBody = {};
let body401Parsed = true;
try { body401 = (await res401.clone().json()) as ErrBody; }
catch { body401Parsed = false; }
check(
  'the error body is JSON the client can read a message out of',
  body401Parsed,
  body401Parsed ? '' : `body var ikke JSON: ${JSON.stringify(await res401.text())}`,
);
check(
  'the 400 NAMES the field',
  typeof body401.error === 'string' && body401.error.startsWith('description:'),
  JSON.stringify(body401.error),
);
check(
  'the 400 states the limit, so the message is actionable',
  typeof body401.error === 'string' && body401.error.includes(String(KB_DESCRIPTION_MAX)),
  JSON.stringify(body401.error),
);
check(
  'issues[] carries the machine-readable field path',
  body401.issues?.[0]?.field === 'description',
  JSON.stringify(body401.issues),
);
// A rejected write must write NOTHING — not the valid half of the body either.
check(
  'a rejected body changes nothing on disk',
  (await storedDescription()) === beforeTooLong,
  `før ${JSON.stringify(beforeTooLong)} · efter ${JSON.stringify(await storedDescription())}`,
);

// ── AC2 — exactly at the limit still saves, and READS BACK ──────────────────
// The positive control. Without it, a handler that rejected everything would
// pass AC1 perfectly.
const atLimit = 'å'.repeat(KB_DESCRIPTION_MAX);
const resOk = await patch({ description: atLimit, language: 'da', lintPolicy: 'trusting' });
check('description at exactly the limit → 200', resOk.status === 200, `status ${resOk.status}`);
const readBack = await storedDescription();
check(
  'the saved text reads back byte-identical (strict equality, fresh raw query)',
  readBack === atLimit,
  readBack === atLimit ? `${readBack?.length} tegn` : `gemte ${readBack?.length ?? 'null'} tegn, sendte ${atLimit.length}`,
);

// ── AC3 — negative control: the field can be emptied ────────────────────────
// A field that always shows the same value passes a read-back by accident, so
// the clear has to be proven too — and via BOTH shapes a client can send.
// The SPA sends null (settings-trail.tsx maps a blank textarea to null); any
// other client may send ''. The assertion is on EMPTINESS, not on which of the
// two the column ends up holding: the first draft asserted === null, went red
// on '' and would have sent me editing the handler to satisfy the test rather
// than the user. Both values render as an empty field and neither can be
// confused with the 500 characters that were there a line earlier.
const resClearEmpty = await patch({ description: '', language: 'da', lintPolicy: 'trusting' });
check('clearing with an empty string → 200', resClearEmpty.status === 200, `status ${resClearEmpty.status}`);
check(
  'and it really is empty afterwards (not the old text still standing)',
  ((await storedDescription()) ?? '') === '',
  JSON.stringify(await storedDescription()),
);

await patch({ description: atLimit, language: 'da', lintPolicy: 'trusting' }); // refill, so the next clear proves something
const resClearNull = await patch({ description: null, language: 'da', lintPolicy: 'trusting' });
check('clearing with null (what the SPA actually sends) → 200', resClearNull.status === 200, `status ${resClearNull.status}`);
check(
  'null clears it too — the SPA path is proven, not assumed',
  ((await storedDescription()) ?? '') === '',
  JSON.stringify(await storedDescription()),
);

// ── AC4 — the same treatment for every other field on the schema ────────────
// Handled in onError, so this is the proof it is not a one-field patch.
const resName = await patch({ name: 'x'.repeat(KB_NAME_MAX + 1) });
const nameBody = await safeJson(resName);
check(
  'an over-long NAME is also a 400 naming its field',
  resName.status === 400 && (nameBody.error ?? '').startsWith('name:'),
  `status ${resName.status} · ${JSON.stringify(nameBody.error)}`,
);
const resEnum = await patch({ lintPolicy: 'nonsense' });
const enumBody = await safeJson(resEnum);
check(
  'a value outside an enum is a 400 naming its field',
  resEnum.status === 400 && (enumBody.error ?? '').startsWith('lintPolicy:'),
  `status ${resEnum.status} · ${JSON.stringify(enumBody.error)}`,
);
const resDays = await patch({ lintScheduleDays: 999 });
check('an out-of-range number is a 400', resDays.status === 400, `status ${resDays.status}`);

// ── AC5 — a REAL server fault must still be a 500 ───────────────────────────
// The load-bearing negative control for the change itself: onError must not
// have become "everything is the client's fault". A route that throws a
// non-Zod error still has to answer 500, or a genuine outage would be
// reported to the user as a bad request and never reach the error board.
const boom = new (await import('hono')).Hono();
boom.get('/boom', () => { throw new Error('a real fault'); });
const probe = createApp(trail, new Map([['f2141', trail]]));
probe.route('/api/v1', boom);
// Capture console.error around the call: the prod 500 left NO trace in
// `flyctl logs` — the request line said 500 and nothing said why — so "it is
// logged" is part of the fix and therefore part of the proof. Found by
// mutation: deleting the log line produced 0 red until this check existed.
const seen: string[] = [];
const realError = console.error;
console.error = (...args: unknown[]) => { seen.push(args.map(String).join(' ')); };
const resBoom = await probe.request('http://engine.local/api/v1/boom', { headers: authed });
console.error = realError;
check('a non-Zod throw is still a 500', resBoom.status === 500, `status ${resBoom.status}`);
check(
  'and a real 500 leaves a log line naming the method, the URL and the fault',
  seen.some((l) => l.includes('GET') && l.includes('/api/v1/boom') && l.includes('a real fault')),
  seen.length ? JSON.stringify(seen[0]?.slice(0, 120)) : 'intet blev logget',
);

// ── AC6 — the 404 path is unchanged ─────────────────────────────────────────
// resolveKbId runs BEFORE parsing, so an unknown id must stay a 404 rather
// than becoming a validation error.
const res404 = await app.request('http://engine.local/api/v1/knowledge-bases/does-not-exist', {
  method: 'PATCH', headers: authed, body: JSON.stringify({ description: tooLong }),
});
check('an unknown Trail is still 404, not 400', res404.status === 404, `status ${res404.status}`);

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗'} ${pass} bestået, ${fail} fejlet`);
process.exit(fail === 0 ? 0 : 1);
