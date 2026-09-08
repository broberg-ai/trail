/**
 * F263.3 — TÆLLEREN FOR TABTE OMKOSTNINGS-STEMPLER.
 *
 * upmetrics målte 8/9 at de aldrig kan se vores tab: de kan i princippet tælle
 * det de AFVISER, men et kald der aldrig ankom efterlader intet spor hos dem.
 * Kun afsenderen kender forskellen på «afvist» og «kom aldrig frem».
 *
 * DEN NEGATIVE KONTROL STÅR FØRST og er hele pointen: en tæller der aldrig
 * tælles op ser præcis ud som «vi taber ingenting». Prøven skal derfor både
 * vise at den STIGER ved en fejl OG at den BLIVER STÅENDE når alt går godt —
 * ellers kunne `antal++` et vilkårligt sted bestå.
 */
import { test, expect, beforeEach } from 'bun:test';
import { upmetricsSink } from '@broberg/ai-sdk';

/** Samme form som motorens buildSink, med tælleren isoleret til prøven. */
function byg(svar: () => Promise<Response>) {
  const tab = { antal: 0, sidsteFejl: null as string | null };
  const sink = upmetricsSink({
    baseUrl: 'https://upmetrics.test',
    apiKey: 'uk_test',
    agentName: 'trail',
    agentKind: 'chatbot',
    fetch: (async () => svar()) as unknown as typeof fetch,
    onError: (err: unknown) => {
      tab.antal += 1;
      tab.sidsteFejl = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    },
  });
  return { sink, tab };
}

const brug = {
  provider: 'anthropic', model: 'claude-code', transport: 'subprocess', capability: 'chat',
  region: 'us', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
  costUsd: 0, subprocess: true, purpose: 'local-ingest', latencyMs: 0,
  labels: { tenantId: 't', kbId: 'k' }, ts: new Date().toISOString(),
} as never;

test('NEGATIV KONTROL: et stempel der LYKKES tæller ikke som tabt', async () => {
  // Uden den ville «antal++ ved hvert kald» bestå prøven nedenfor, og tallet
  // ville rapportere tab hver eneste gang alt gik godt.
  const { sink, tab } = byg(async () => new Response('{}', { status: 200 }));
  await sink.record(brug);
  expect(tab.antal).toBe(0);
});

test('et AFVIST stempel (500) tælles — og fejlen gemmes', async () => {
  const { sink, tab } = byg(async () => new Response('nede', { status: 500 }));
  await sink.record(brug);
  expect(tab.antal).toBe(1);
  expect(tab.sidsteFejl).toContain('500');
});

test('et stempel der ALDRIG NÅR FREM tælles også — det er dét upmetrics ikke kan se', async () => {
  // Netværkshikke, deres proces nede, Macen der swapper. Sinken fanger kastet
  // i sin egen try/catch og kalder onError; uden tælleren var det en linje i
  // en log og ellers ingenting.
  const { sink, tab } = byg(async () => { throw new Error('connect ECONNREFUSED'); });
  await sink.record(brug);
  expect(tab.antal).toBe(1);
  expect(tab.sidsteFejl).toContain('ECONNREFUSED');
});

test('tabene AKKUMULERER — «der skete en fejl» og «der er sket tre» er to beskeder', async () => {
  const { sink, tab } = byg(async () => new Response('nede', { status: 503 }));
  await sink.record(brug);
  await sink.record(brug);
  await sink.record(brug);
  expect(tab.antal).toBe(3);
});

test('sinken KASTER ikke videre — telemetri må aldrig vælte kaldet der udløste den', async () => {
  const { sink } = byg(async () => { throw new Error('boom'); });
  await expect(sink.record(brug)).resolves.toBeUndefined();
});
