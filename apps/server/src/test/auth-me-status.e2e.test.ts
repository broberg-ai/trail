// F211.1 — the engine's /api/auth/me must answer 401 when there is no session.
//
// It used to answer `200 {user: null}`. That is a successful call as far as
// every client is concerned, so the "not signed in" branch — which almost
// always hangs off `!response.ok` — never ran. On 2026-08-27 the admin SPA was
// pointed at the engine instead of the control plane, sailed past its own
// redirect-to-login because the call "succeeded", and then died reading
// `me.tenants.length` on a body that has no `tenants`. The owner got a blank
// page and nothing said why.
//
// Every assertion here is about the STATUS, because the status is the field
// that lied. Asserting the body alone would have passed against the bug.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { sessions } from '@trail/db';
import { startE2E, type E2EContext } from './e2e-harness.js';

let e2e: E2EContext;

const hourFromNow = () => new Date(Date.now() + 3_600_000).toISOString();
const hourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

beforeAll(async () => {
  e2e = await startE2E();
  await e2e.trail.db
    .insert(sessions)
    .values({ id: 'sess-live', userId: e2e.seed.userId, expiresAt: hourFromNow() })
    .run?.();
  await e2e.trail.db
    .insert(sessions)
    .values({ id: 'sess-expired', userId: e2e.seed.userId, expiresAt: hourAgo() })
    .run?.();
});

afterAll(async () => { await e2e?.cleanup(); });

const me = (cookie?: string) =>
  e2e.app.request('/api/auth/me', cookie ? { headers: { cookie } } : undefined);

describe('GET /api/auth/me', () => {
  test('no cookie at all → 401', async () => {
    expect((await me()).status).toBe(401);
  });

  test('a cookie naming a session that does not exist → 401', async () => {
    // The interesting case: a stale cookie from a wiped database looks
    // identical to a valid one until the lookup misses.
    expect((await me('session=sess-does-not-exist')).status).toBe(401);
  });

  test('an EXPIRED session → 401', async () => {
    // The row exists; only the expiry disqualifies it. A handler that checked
    // "is there a row" rather than "is it still valid" would pass the two
    // tests above and fail here.
    expect((await me('session=sess-expired')).status).toBe(401);
  });

  test('the body still carries user:null, so shape-readers keep working', async () => {
    // The status is what changed. Anything already reading `.user` must not
    // break — that is what makes this a fix rather than a cutover.
    const body = (await (await me()).json()) as { user: unknown };
    expect(body.user).toBeNull();
  });

  test('POSITIVE CONTROL — a valid session → 200 with the user', async () => {
    // Without this, returning 401 unconditionally would pass every test above.
    const res = await me('session=sess-live');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; email: string } | null };
    expect(body.user).not.toBeNull();
    expect(body.user!.id).toBe(e2e.seed.userId);
  });

  test('the control plane and the engine agree on the unauthenticated status', async () => {
    // The two /me routes disagreeing is the actual root cause: a client can be
    // correct against one and broken against the other, and the difference is
    // invisible until it is a blank page. apps/admin-server/src/auth.ts has
    // always returned 401 here; this pins the engine to the same contract so
    // they cannot drift apart again unnoticed.
    expect((await me()).status).toBe(401);
  });
});
