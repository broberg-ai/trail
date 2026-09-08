/**
 * F263.3 — den ÆGTE tæller i lib/ai.ts, ikke min gengivelse af den.
 *
 * telemetry-loss.test.ts ved siden af bygger sin EGEN sink med sin egen tæller.
 * Den prøver formen på koblingen og består derfor selv når motorens
 * `telemetriTab.antal += 1` fjernes — målt, ikke antaget. Det er samme fejl som
 * resten af ugen, en tak længere ude: en prøve på min model af tingen frem for
 * på tingen.
 *
 * Denne kører mod det RIGTIGE modul. Nøglen sættes så buildSink() ikke giver
 * noopSink, og adressen peger på en port der ikke lytter — så kaldet fejler
 * lokalt og hurtigt, uden at forlade maskinen.
 */
import { test, expect } from 'bun:test';

process.env.UPMETRICS_API_KEY = 'uk_test_ikke_ægte';
// 127.0.0.1:1 lytter aldrig. Ingen netværkstrafik ud af maskinen, og fejlen
// kommer fra fetch selv — altså præcis den «kom aldrig frem»-vej upmetrics
// beviste at de ikke kan se.
process.env.UPMETRICS_BASE_URL = 'http://127.0.0.1:1';

const { reportLocalIngestRun, telemetriTab } = await import('../lib/ai.js');

test('et stempel der ikke kan leveres, TÆLLES i motorens egen tæller', async () => {
  const foer = telemetriTab.antal;
  await reportLocalIngestRun({
    tenantId: 't-proeve',
    kbId: 'kb-proeve',
    sourceId: 'src-proeve',
    completedAt: new Date().toISOString(),
  });
  expect(telemetriTab.antal).toBe(foer + 1);
  expect(telemetriTab.sidsteFejl).toBeTruthy();
  expect(telemetriTab.sidsteTidspunkt).toBeTruthy();
});

test('og det VÆLTER ikke kaldet — telemetri må aldrig koste den kørsel den beskriver', async () => {
  await expect(
    reportLocalIngestRun({ tenantId: 't', kbId: 'k' }),
  ).resolves.toBeUndefined();
});
