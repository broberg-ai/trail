import { describe, expect, test } from 'bun:test';
import { buildCandidateBody, postCandidate, AMBIENT_CONNECTOR } from './candidate.js';

// Synthetic Anthropic-shaped key — matches @broberg/secret-scan's
// 'anthropic-api-key' pattern, never a real credential.
const FAKE_SECRET = 'sk-ant-api03-' + 'A1b2C3d4'.repeat(12);

describe('buildCandidateBody', () => {
  test('a secret in the captured text NEVER reaches the assembled body', () => {
    const { body, redactionFindings } = buildCandidateBody({
      kb: 'personal',
      title: `Config note med nøgle ${FAKE_SECRET}`,
      content: `Kunden delte ved en fejl deres API-nøgle: ${FAKE_SECRET} — skal roteres.`,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(FAKE_SECRET);
    expect(body.content).toContain('[REDACTED:');
    expect(body.title).toContain('[REDACTED:');
    expect(redactionFindings.length).toBeGreaterThan(0);
  });

  test('clean text passes through byte-identical with empty findings', () => {
    const { body, redactionFindings } = buildCandidateBody({
      kb: 'deals',
      title: 'Call med Acme',
      content: 'Aftalt: nyt tilbud fremsendes senest fredag.',
    });
    expect(body.content).toBe('Aftalt: nyt tilbud fremsendes senest fredag.');
    expect(redactionFindings).toEqual([]);
  });

  test('metadata carries connector + capture context as a JSON string', () => {
    const { body } = buildCandidateBody({
      kb: 'personal',
      title: 'T',
      content: 'Besluttet at vi dropper det gamle CRM-system til fordel for det nye.',
      sourceUrl: 'app://Safari/Acme CRM',
      capturedAt: '2026-07-02T14:00:00Z',
    });
    const meta = JSON.parse(body.metadata) as Record<string, string>;
    expect(meta.connector).toBe(AMBIENT_CONNECTOR);
    expect(meta.sourceUrl).toBe('app://Safari/Acme CRM');
    expect(meta.capturedAt).toBe('2026-07-02T14:00:00Z');
    expect(body.kind).toBe('external-feed');
  });
});

describe('postCandidate', () => {
  test('POSTs the redacted body with bearer auth and parses the 201 response', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const result = await postCandidate(
      { kb: 'personal', title: 'T', content: `Aftalt deadline. Nøgle: ${FAKE_SECRET}` },
      {
        apiBase: 'http://engine.test/',
        token: 'trail_testtoken',
        fetchImpl: async (url, init) => {
          captured = { url, init };
          return new Response(JSON.stringify({ candidate: { id: 'cand-1' } }), { status: 201 });
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(result.candidateId).toBe('cand-1');
    expect(captured!.url).toBe('http://engine.test/api/v1/queue/candidates');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer trail_testtoken');
    // The wire invariant: the raw secret is not in the outgoing payload.
    expect(String(captured!.init.body)).not.toContain(FAKE_SECRET);
  });

  test('409 surfaces as duplicate, not a generic failure', async () => {
    const result = await postCandidate(
      { kb: 'personal', title: 'T', content: 'Aftalt: gentaget capture af samme session.' },
      {
        apiBase: 'http://engine.test',
        token: 'trail_x',
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: 'duplicate', code: 'DUP' }), { status: 409 }),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.duplicate).toBe(true);
  });
});
