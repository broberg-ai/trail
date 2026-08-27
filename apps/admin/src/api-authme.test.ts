// F211.1 — the payload guard that keeps a wrong /me from rendering an admin.
//
// The 2026-08-27 blank page had two causes, and this file covers the second.
// The first was a status code (engine /me answered 200 for "no session"); the
// second was that nothing ever checked whether the BODY was the body this app
// needs. A 200 from the wrong host is still a 200.
//
// The fixture below is the engine's real /me shape, copied from
// apps/server/src/routes/auth.ts — not an invented "bad object". A guard
// tested only against `{}` would pass while the payload that actually reached
// the SPA sailed through.
import { describe, test, expect, afterEach } from 'bun:test';
import { fetchAuthMe, isAuthMe } from './api';

/** Exactly what apps/server/src/routes/auth.ts returns for a valid session. */
const ENGINE_ME = {
  user: {
    id: 'u1',
    tenantId: 'ten1',
    email: 'cb@webhouse.dk',
    displayName: 'Christian',
    avatarUrl: null,
    role: 'admin',
    onboarded: true,
    tenantSlug: 'broberg-ai',
    tenantName: 'Broberg AI',
  },
};

/** What the control plane returns — the shape the SPA is written against. */
const CONTROL_ME = {
  user: { id: 'u1', email: 'cb@webhouse.dk', name: 'Christian', onboarded: true },
  organizationId: 'org1',
  tenant: { id: 't1', slug: 'broberg-ai', name: 'Broberg AI', language: 'da', plan: null },
  tenants: [{ id: 't1', slug: 'broberg-ai', name: 'Broberg AI' }],
  engineUrl: 'https://engine.trailmem.com',
};

describe('isAuthMe', () => {
  test('POSITIVE CONTROL — the control plane payload is accepted', () => {
    // Without this, `return false` would pass every other test in the file.
    expect(isAuthMe(CONTROL_ME)).toBe(true);
  });

  test('the ENGINE payload is rejected — this is the one that reached the SPA', () => {
    // It has a plausible `user` with a real id. Only the missing `tenants`
    // and `organizationId` distinguish it, which is precisely why a guard
    // that just checked for `user` would not have helped.
    expect(isAuthMe(ENGINE_ME)).toBe(false);
  });

  test('a payload with NO tenants field is rejected', () => {
    const { tenants, ...withoutTenants } = CONTROL_ME;
    expect(isAuthMe(withoutTenants)).toBe(false);
  });

  test('tenants present but not an array is rejected', () => {
    // `.length` exists on a string too — a guard using truthiness or `.length`
    // would accept this and then hand a string to the tenant switcher.
    expect(isAuthMe({ ...CONTROL_ME, tenants: 'nope' })).toBe(false);
    expect(isAuthMe({ ...CONTROL_ME, tenants: null })).toBe(false);
  });

  test('an EMPTY tenant list is still a valid session', () => {
    // A brand-new account legitimately has none. Rejecting it would lock a
    // real user out — the opposite failure, and just as bad.
    expect(isAuthMe({ ...CONTROL_ME, tenants: [] })).toBe(true);
  });

  test('a signed-out body is rejected', () => {
    expect(isAuthMe({ user: null })).toBe(false);
    expect(isAuthMe({ user: null, error: 'not signed in' })).toBe(false);
  });

  test('non-objects are rejected without throwing', () => {
    for (const bad of [null, undefined, '', 'ok', 0, [], true]) {
      expect(isAuthMe(bad)).toBe(false);
    }
  });
});

describe('fetchAuthMe', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  const respondWith = (body: unknown) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
  };

  test('rejects a 200 carrying the engine payload', async () => {
    // The guard existing is not enough — fetchAuthMe has to actually call it.
    // Without this test, deleting the check from fetchAuthMe leaves the whole
    // suite green while the SPA is broken exactly as it was on 2026-08-27.
    respondWith(ENGINE_ME);
    await expect(fetchAuthMe()).rejects.toThrow('not a signed-in admin session');
  });

  test('POSITIVE CONTROL — resolves on the control-plane payload', async () => {
    respondWith(CONTROL_ME);
    const me = await fetchAuthMe();
    expect(me.user.id).toBe('u1');
    expect(me.tenants).toHaveLength(1);
  });
});
