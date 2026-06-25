/**
 * F182.5 fix — supersession recency guard.
 *
 * Bug (observed 2026-06-25): a freshly-saved Neuron (default confidence 0.7) was
 * auto-superseded by an OLDER, unrelated, higher-confidence Neuron (1.0) on a
 * false-positive contradiction match — backwards, and it hid the fresh Neuron
 * from chat. The guard: a Neuron may never be superseded by one OLDER than it.
 *
 * Pure unit test over decideFromMeta (no DB). Run from apps/server:
 *   bun run scripts/verify-f182-5-supersession-recency-guard.ts
 */
import { decideFromMeta, type NeuronMeta } from '../src/services/supersession.js';

let fail = 0;
function check(name: string, cond: boolean) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail++;
}

const NEW = 'doc_new';
const OLD = 'doc_old';

console.log('\n=== F182.5 supersession recency guard ===\n');

// 1. THE BUG: fresh low-confidence Neuron vs older high-confidence one.
//    Without the guard the older would supersede the newer. Must now be null.
console.log('[1] fresh (0.7, 24 Jun) "contradicts" older (1.0, 10 Jun)');
{
  const fresh: NeuronMeta = { confidence: 0.7, sourceCount: 0, createdAt: '2026-06-24 23:41:02' };
  const older: NeuronMeta = { confidence: 1.0, sourceCount: 0, createdAt: '2026-06-10 15:51:31' };
  const d = decideFromMeta(NEW, fresh, OLD, older);
  check('returns null — older may NOT supersede newer', d === null);
}

// 2. LEGIT: newer high-confidence Neuron supersedes older low-confidence one.
//    The intended direction — must still produce a decision.
console.log('[2] newer (1.0, 24 Jun, 2 sources) supersedes older (0.7, 10 Jun, 1 source)');
{
  const newer: NeuronMeta = { confidence: 1.0, sourceCount: 2, createdAt: '2026-06-24 10:00:00' };
  const older: NeuronMeta = { confidence: 0.7, sourceCount: 1, createdAt: '2026-06-10 10:00:00' };
  const d = decideFromMeta(NEW, newer, OLD, older);
  check('returns a decision', d !== null);
  check('target = the OLDER Neuron', d?.targetNeuronId === OLD);
  check('replacement = the NEWER Neuron', d?.replacementNeuronId === NEW);
}

// 3. Equal confidence (F199.1 & vision-selector both 1.0 today) → no supersession.
console.log('[3] equal confidence → no supersession at all');
{
  const a: NeuronMeta = { confidence: 1.0, sourceCount: 0, createdAt: '2026-06-24 23:41:02' };
  const b: NeuronMeta = { confidence: 1.0, sourceCount: 0, createdAt: '2026-06-10 15:51:31' };
  check('returns null (Δconfidence 0 < delta)', decideFromMeta(NEW, a, OLD, b) === null);
}

// 4. Older, stronger Neuron vs a NEWER weaker one created later — guard still
//    refuses (the winner is older than the loser). Curator decides instead.
console.log('[4] older strong (1.0, 10 Jun) vs newer weak (0.7, 24 Jun) — guard blocks');
{
  const newerWeak: NeuronMeta = { confidence: 0.7, sourceCount: 0, createdAt: '2026-06-24 10:00:00' };
  const olderStrong: NeuronMeta = { confidence: 1.0, sourceCount: 5, createdAt: '2026-06-10 10:00:00' };
  // new=newerWeak, existing=olderStrong → confidence wants olderStrong to win,
  // but it is OLDER than newerWeak → guard returns null.
  check('returns null — winner is older than loser', decideFromMeta(NEW, newerWeak, OLD, olderStrong) === null);
}

console.log(`\n=== ${fail === 0 ? 'PASS' : `FAIL (${fail})`} ===\n`);
process.exit(fail === 0 ? 0 : 1);
