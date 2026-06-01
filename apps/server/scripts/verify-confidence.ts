/**
 * F182.2 verification — pure-function properties of the confidence formula.
 * No DB, no LLM. Run: bun run apps/server/scripts/verify-confidence.ts
 */
import {
  computeConfidence,
  computeReinforcementBoost,
  countDistinctSources,
  DEFAULT_DECAY_RATES,
  type ConfidenceSignalInput,
} from '../src/services/confidence.js';

const NOW = 1_800_000_000_000; // fixed epoch ms for determinism
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => NOW - days * DAY;

let failures = 0;
function assert(c: boolean, m: string) { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failures++; }

const base = { type: 'concept' as const, contradictionCount: 0, now: NOW, signals: [] as ConfidenceSignalInput[] };

console.log('1. output clamped to [0,1]');
for (const ageDays of [0, 1, 30, 365, 1000, 5000]) {
  const c = computeConfidence({ ...base, createdAt: ago(ageDays) });
  assert(c >= 0 && c <= 1, `age ${ageDays}d → ${c.toFixed(3)} in [0,1]`);
}

console.log('\n2. recency: fresher > older (same type, no signals)');
const fresh = computeConfidence({ ...base, createdAt: ago(1) });
const old = computeConfidence({ ...base, createdAt: ago(700) });
assert(fresh > old, `1d (${fresh.toFixed(3)}) > 700d (${old.toFixed(3)})`);

console.log('\n3. sourceStrength: more distinct citing sources → higher');
const citeSig = (id: string): ConfidenceSignalInput => ({ signalType: 'cite', weight: 0, sourceNeuronId: id, recordedAt: ago(400) });
const oneSrc = computeConfidence({ ...base, createdAt: ago(10), signals: [citeSig('s1')] });
const fiveSrc = computeConfidence({ ...base, createdAt: ago(10), signals: ['s1','s2','s3','s4','s5'].map(citeSig) });
assert(fiveSrc > oneSrc, `5 sources (${fiveSrc.toFixed(3)}) > 1 source (${oneSrc.toFixed(3)})`);
assert(countDistinctSources(['s1','s1','s2'].map(citeSig)) === 2, 'countDistinctSources dedups (s1,s1,s2 → 2)');

console.log('\n4. contradictions lower confidence');
const noContra = computeConfidence({ ...base, createdAt: ago(10) });
const contra = computeConfidence({ ...base, createdAt: ago(10), contradictionCount: 2 });
assert(contra < noContra, `2 contradictions (${contra.toFixed(3)}) < none (${noContra.toFixed(3)})`);

console.log('\n5. reinforcement raises confidence');
const accessSig: ConfidenceSignalInput = { signalType: 'access', weight: 0.1, recordedAt: ago(2) };
const noReinf = computeConfidence({ ...base, createdAt: ago(300) });
const reinf = computeConfidence({ ...base, createdAt: ago(300), signals: [accessSig, accessSig, accessSig] });
assert(reinf > noReinf, `reinforced (${reinf.toFixed(3)}) > none (${noReinf.toFixed(3)})`);
assert(computeReinforcementBoost([{ signalType: 'access', weight: 0.1, recordedAt: ago(400) }], NOW) === 0, 'signals older than 90d window → no boost');
assert(computeReinforcementBoost(Array(100).fill({ signalType: 'access', weight: 0.1, recordedAt: ago(1) }), NOW) <= 0.3, 'boost capped at 0.3');

console.log('\n6. AC scenario: oldest (2y) + 5 access reinforcement > newest (1d), no signals');
const newest = computeConfidence({ ...base, createdAt: ago(1) });
const oldestReinforced = computeConfidence({
  ...base,
  createdAt: ago(730),
  signals: Array.from({ length: 5 }, (_, i) => ({ signalType: 'access' as const, weight: 0.1, recordedAt: ago(i + 1) })),
});
assert(oldestReinforced > newest, `oldest+reinforced (${oldestReinforced.toFixed(3)}) > newest (${newest.toFixed(3)})`);

console.log('\n7. per-type τ: session decays faster than concept at equal age');
const sessionC = computeConfidence({ ...base, type: 'session', createdAt: ago(60) });
const conceptC = computeConfidence({ ...base, type: 'concept', createdAt: ago(60) });
assert(sessionC < conceptC, `session@60d (${sessionC.toFixed(3)}) < concept@60d (${conceptC.toFixed(3)})  [τ ${DEFAULT_DECAY_RATES.session} vs ${DEFAULT_DECAY_RATES.concept}]`);

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
