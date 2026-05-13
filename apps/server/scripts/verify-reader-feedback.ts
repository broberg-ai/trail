/**
 * F31 verify — exercise /reader-feedback end-to-end against a local
 * engine. Spawns nothing; assumes the engine is already running on
 * 127.0.0.1:58021 with at least one KB present. Reads bearer token
 * from env (TRAIL_API_KEY) or falls back to admin's dev session
 * cookie if running on Christian's local launcher.
 *
 * Run: cd apps/server && bun run scripts/verify-reader-feedback.ts
 */

const ENGINE = process.env.TRAIL_ENGINE_URL ?? 'http://127.0.0.1:58021';
const KB = process.env.TRAIL_KB ?? 'sanne-andersen';
const TOKEN = process.env.TRAIL_API_KEY ?? '';

if (!TOKEN) {
  console.error('TRAIL_API_KEY missing — set env or pass via --env.');
  console.error('Quick: create one in admin UI Settings → API keys, or run');
  console.error('  TRAIL_API_KEY=$(sqlite3 ~/.trail-tenant/trail.db "SELECT key FROM api_keys LIMIT 1")');
  process.exit(2);
}

interface FeedbackPayload {
  vote: 'up' | 'down' | 'flag';
  question: string;
  answer: string;
  reason?: string;
  category?: string;
  pageUrl?: string;
  citations?: Array<{ documentId: string; path: string; filename: string }>;
}

async function postFeedback(payload: FeedbackPayload): Promise<unknown> {
  const url = `${ENGINE}/api/v1/knowledge-bases/${encodeURIComponent(KB)}/reader-feedback`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    throw new Error(`POST ${url} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return body;
}

const probes: Array<{ name: string; payload: FeedbackPayload; expectError?: string }> = [
  {
    name: 'up vote, no reason',
    payload: {
      vote: 'up',
      question: 'Is reflexology effective for sleep issues?',
      answer: 'Many clients find reflexology supportive for sleep, though responses vary.',
    },
  },
  {
    name: 'down vote with reason + category',
    payload: {
      vote: 'down',
      question: 'What treatments work for chronic headaches?',
      answer: 'Reflexology may help with some types of headaches.',
      reason: 'The answer is too vague — doesn\'t cite which types or research backing.',
      category: 'missing-info',
      pageUrl: 'https://docs.trailmem.com/test',
    },
  },
  {
    name: 'flag with reason',
    payload: {
      vote: 'flag',
      question: 'Sensitive question that AI answered wrong',
      answer: 'A response that should be reviewed.',
      reason: 'Curator should review — AI made a claim outside its scope.',
      category: 'other',
    },
  },
  {
    name: 'down vote MISSING reason (should 400)',
    payload: {
      vote: 'down',
      question: 'Test',
      answer: 'Test answer',
    },
    expectError: 'reason_required_for_negative_vote',
  },
];

let passed = 0;
let failed = 0;
for (const probe of probes) {
  try {
    const result = await postFeedback(probe.payload);
    if (probe.expectError) {
      console.error(`  ✗ ${probe.name} — expected error '${probe.expectError}' but got 200`);
      failed++;
      continue;
    }
    const r = result as { candidateId?: string; status?: string };
    if (!r.candidateId || !r.status) {
      console.error(`  ✗ ${probe.name} — response missing candidateId/status:`, result);
      failed++;
      continue;
    }
    console.log(`  ✓ ${probe.name} → ${r.candidateId} (${r.status})`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (probe.expectError && msg.includes(probe.expectError)) {
      console.log(`  ✓ ${probe.name} → correctly rejected (${probe.expectError})`);
      passed++;
    } else {
      console.error(`  ✗ ${probe.name} —`, msg);
      failed++;
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
