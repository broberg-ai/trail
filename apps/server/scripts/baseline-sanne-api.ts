/**
 * F40.2a-F: byte-for-byte baseline verifier for Sanne's prod API.
 *
 * Captures responses to a fixed set of read endpoints (and one queue
 * write that's idempotent), then compares the next run against the
 * snapshot. Used to prove that the F40.2a rollout doesn't change
 * Sanne's API output — first run BEFORE the flag-flip captures the
 * baseline, second run AFTER each deploy/flip step verifies parity.
 *
 * Usage:
 *   TRAIL_BEARER=$(cat ~/.trail-secrets/sanne.bearer) \
 *     bun run apps/server/scripts/baseline-sanne-api.ts capture
 *   TRAIL_BEARER=$(cat ~/.trail-secrets/sanne.bearer) \
 *     bun run apps/server/scripts/baseline-sanne-api.ts diff
 *
 * Bearer must belong to sanne-andersen tenant. Defaults to
 * engine.trailmem.com; override via TRAIL_ENGINE_URL.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(__dirname, '..', '.baseline');
const ENGINE = process.env.TRAIL_ENGINE_URL ?? 'https://engine.trailmem.com';
const BEARER = process.env.TRAIL_BEARER;

if (!BEARER) {
  console.error('TRAIL_BEARER env var required.');
  process.exit(2);
}

const mode = process.argv[2];
if (mode !== 'capture' && mode !== 'diff') {
  console.error('usage: bun run baseline-sanne-api.ts capture|diff');
  process.exit(2);
}

// Fields that legitimately vary per request and must not contribute
// to diff failures.
//
// LLM prose (answer/renderedAnswer) drifts even with deterministic
// retrieval — same KB, same query, same model can produce different
// wording. So we mask it out. What's NOT masked, and IS the actual
// signal we care about for F40.2a:
//
//   - status code (200 vs 401 vs 500)
//   - citations[].documentId / filename / path — these come from the
//     tenant DB's documents table. If F40.2a accidentally routed a
//     Sanne-bearer to broberg.ai's DB, the citations would be from a
//     DIFFERENT corpus and the diff would catch it. THAT is the
//     catastrophic data-leak detector.
//   - backend, model, audience, turnsLimit — config-deterministic.
//
// Timestamps + per-request random IDs are masked because they're
// unrelated to F40.2a behaviour.
const VOLATILE_KEYS = new Set([
  'sessionId',
  'turnId',
  'turnsUsed',
  'lastUsedAt',
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt',
  'requested_at',
  'completed_at',
  'answer',
  'renderedAnswer',
]);

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE_KEYS.has(k)) {
        out[k] = '<<volatile>>';
        continue;
      }
      out[k] = stableJson((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

interface Probe {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

const probes: Probe[] = [
  {
    name: 'kb-metadata',
    method: 'GET',
    path: '/api/v1/knowledge-bases/sanne-andersen',
  },
  {
    name: 'documents-list',
    method: 'GET',
    path: '/api/v1/knowledge-bases/sanne-andersen/documents?limit=10',
  },
  {
    name: 'chat-zoneterapi',
    method: 'POST',
    path: '/api/v1/chat',
    body: {
      knowledgeBaseId: 'sanne-andersen',
      message: 'Hvad er zoneterapi?',
      audience: 'public',
    },
  },
  {
    name: 'chat-ansigtszoneterapi',
    method: 'POST',
    path: '/api/v1/chat',
    body: {
      knowledgeBaseId: 'sanne-andersen',
      message: 'Hvad er ansigtszoneterapi?',
      audience: 'public',
    },
  },
  {
    name: 'chat-behandlinger',
    method: 'POST',
    path: '/api/v1/chat',
    body: {
      knowledgeBaseId: 'sanne-andersen',
      message: 'Hvilke behandlinger tilbyder du?',
      audience: 'public',
    },
  },
  {
    name: 'chat-bog',
    method: 'POST',
    path: '/api/v1/chat',
    body: {
      knowledgeBaseId: 'sanne-andersen',
      message: 'Har du skrevet en bog?',
      audience: 'public',
    },
  },
  {
    name: 'chat-pris',
    method: 'POST',
    path: '/api/v1/chat',
    body: {
      knowledgeBaseId: 'sanne-andersen',
      message: 'Hvad koster en behandling?',
      audience: 'public',
    },
  },
];

async function runProbe(p: Probe): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${ENGINE}${p.path}`, {
    method: p.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BEARER}`,
    },
    body: p.body ? JSON.stringify(p.body) : undefined,
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

mkdirSync(BASELINE_DIR, { recursive: true });

if (mode === 'capture') {
  console.log(`Capturing baseline against ${ENGINE}...\n`);
  for (const p of probes) {
    process.stdout.write(`  ${p.name}... `);
    const result = await runProbe(p);
    const stable = stableJson(result);
    const outPath = join(BASELINE_DIR, `${p.name}.json`);
    writeFileSync(outPath, JSON.stringify(stable, null, 2) + '\n');
    console.log(`✓ ${result.status} → ${outPath}`);
  }
  console.log('\nBaseline captured. Run with `diff` after the deploy to verify.');
} else {
  console.log(`Diffing against captured baseline (${BASELINE_DIR})...\n`);
  let failures = 0;
  for (const p of probes) {
    const baselinePath = join(BASELINE_DIR, `${p.name}.json`);
    if (!existsSync(baselinePath)) {
      console.log(`  ${p.name}: ✗ MISSING BASELINE (run capture first)`);
      failures++;
      continue;
    }
    const expected = readFileSync(baselinePath, 'utf-8').trim();
    const result = await runProbe(p);
    const actual = JSON.stringify(stableJson(result), null, 2);
    if (actual === expected) {
      console.log(`  ${p.name}: ✓ match`);
    } else {
      console.log(`  ${p.name}: ✗ MISMATCH`);
      console.log('    expected (baseline):');
      console.log(expected.split('\n').map((l) => `      ${l}`).join('\n'));
      console.log('    actual:');
      console.log(actual.split('\n').map((l) => `      ${l}`).join('\n'));
      failures++;
    }
  }
  if (failures > 0) {
    console.log(`\n✗ ${failures}/${probes.length} probes diverged from baseline.`);
    process.exit(1);
  }
  console.log(`\n✓ All ${probes.length} probes match the captured baseline.`);
}
