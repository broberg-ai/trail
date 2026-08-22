// F206.1 — the F205.1 partner-scope proof, now a real test that `pnpm test`
// runs, instead of a script somebody has to remember to invoke.
//
// Most of these assertions are NEGATIVE, deliberately. The interesting half of
// an auth change is what gets refused: a test that only showed the upload
// working would pass just as happily on the unrestricted master key F205.1
// exists to stop issuing.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startE2E, type E2EContext } from './e2e-harness.js';

let e2e: E2EContext;
let partnerKey: string;
let legacyKey: string;

beforeAll(async () => {
  e2e = await startE2E();
  // A key written the way EVERY key was written before F205.1: no scope at all.
  legacyKey = await e2e.mintKey({ name: 'legacy' });
  // Mint the partner key through the REAL endpoint, using the legacy key to
  // authenticate — so the mint path itself is under test, not bypassed.
  const res = await e2e.call('/api/v1/api-keys', legacyKey, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Acme Partner', scope: 'partner', kbId: e2e.seed.kbA }),
  });
  expect(res.status).toBe(201);
  partnerKey = ((await res.json()) as { key: string }).key;
});

afterAll(async () => { await e2e?.cleanup(); });

describe('partner API key', () => {
  test('is persisted with its scope AND its knowledge base', async () => {
    // Read the row back with raw SQL — never trust the 201 body for a save.
    const row = await e2e.trail.db.run(
      `SELECT scope, kb_id FROM api_keys WHERE key_hash = '${e2e.hashKey(partnerKey)}'`,
    );
    const stored = (row.rows ?? [])[0] as Record<string, unknown> | undefined;
    expect(stored?.scope).toBe('partner');
    expect(stored?.kb_id).toBe(e2e.seed.kbA);
  });

  test('cannot be minted without a knowledge base', async () => {
    // A partner key that fell back to tenant-wide access would be the exact
    // bug this feature removes, so this must refuse rather than default.
    const res = await e2e.call('/api/v1/api-keys', legacyKey, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bad', scope: 'partner' }),
    });
    expect(res.status).toBe(400);
  });

  test.each([
    ['search',                 '/api/v1/knowledge-bases/kb-a/search?q=x',        'GET'],
    ['a Neuron read',          '/api/v1/documents/doc-1/content',                'GET'],
    ['minting another key',    '/api/v1/api-keys',                               'POST'],
    ['the candidate queue',    '/api/v1/queue/candidates',                       'POST'],
    ['another KB’s upload',    '/api/v1/knowledge-bases/kb-b/documents/upload',  'POST'],
    ['listing knowledge bases', '/api/v1/knowledge-bases',                       'GET'],
  ])('is refused on %s', async (_label, path, method) => {
    const res = await e2e.call(path, partnerKey, { method });
    expect(res.status).toBe(403);
  });

  test('passes the scope gate on its own upload path', async () => {
    // The endpoint itself lands in F205.2; until then a 404 from the router is
    // the correct "allowed, not implemented". What must never happen is 403.
    const res = await e2e.call('/api/v1/partner/sources', partnerKey, { method: 'POST' });
    expect(res.status).not.toBe(403);
  });
});

describe('existing keys', () => {
  test('a scope-less key still works (no naked cutover)', async () => {
    const res = await e2e.call('/api/v1/knowledge-bases', legacyKey);
    expect(res.status).not.toBe(403);
  });
});

describe('the harness itself', () => {
  test('gives each run its own database', async () => {
    // Cross-test state bleed is the classic way a suite goes green for reasons
    // unrelated to the code, so the isolation claim is asserted, not assumed.
    const other = await startE2E();
    try {
      const row = await other.trail.db.run(
        `SELECT COUNT(*) AS n FROM api_keys WHERE key_hash = '${e2e.hashKey(partnerKey)}'`,
      );
      const n = (row.rows ?? [])[0] as Record<string, unknown> | undefined;
      expect(Number(n?.n ?? -1)).toBe(0);
    } finally {
      await other.cleanup();
    }
  });
});
