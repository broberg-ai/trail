/**
 * F197 — verify the secret-scan gate end-to-end.
 *
 * Proves (not infers):
 *   1. redactSecrets detects every provider sample AND leaves benign text
 *      byte-identical (no false positives on shas/uuids/urls/code).
 *   2. INGEST gate: a secret pushed through createCandidate is stored REDACTED
 *      in queueCandidates — a real DB round-trip through the write path.
 *   3. EGRESS guardrail: stripForAudience scrubs a secret out of a chat answer
 *      for every audience.
 *
 * Run: cd apps/server && bun run scripts/verify-f197-secret-gate.ts
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import {
  createLibsqlDatabase,
  tenants,
  users,
  knowledgeBases,
  queueCandidates,
} from '@trail/db';
import { createCandidate } from '@trail/core';
import { redactSecrets } from '@trail/shared';
import { stripForAudience } from '../src/services/chat/postprocess.js';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log('\n=== F197 secret-scan gate verify ===\n');

// ── 1. redactSecrets unit sweep ─────────────────────────────────────────
console.log('[1] redactSecrets — provider samples redacted');
const SAMPLES: Array<[label: string, sample: string]> = [
  ['anthropic-api-key', 'sk-ant-api03-' + 'A'.repeat(80)],
  ['openai-api-key', 'sk-proj-' + 'B'.repeat(40)],
  ['google-api-key', 'AIza' + 'C'.repeat(35)],
  ['google-oauth-secret', 'GOCSPX-' + 'D'.repeat(28)],
  ['aws-access-key-id', 'AKIA' + 'EXAMPLE0123456789'.slice(0, 16)],
  ['github-token', 'ghp_' + 'f'.repeat(36)],
  ['slack-token', 'xoxb-1234567890-abcdefghij'],
  ['stripe-secret-key', 'sk_live_' + 'g'.repeat(24)],
  ['fly-api-token', 'FlyV1 fm2_' + 'h'.repeat(40)],
  ['upmetrics-key', 'uk_' + 'a1b2c3d4'.repeat(6)], // uk_ + 48 hex
  ['cardmem-key', 'pa_' + 'j'.repeat(24)],
  ['trail-key', 'trail_' + 'k'.repeat(24)],
  ['cms-access-token', 'wh_' + 'deadbeef'.repeat(8)], // wh_ + 64 hex
];
for (const [label, sample] of SAMPLES) {
  const r = redactSecrets(`my key is ${sample} ok`);
  assert(
    !r.redacted.includes(sample) && r.redacted.includes(`[REDACTED:${label}]`),
    `${label} redacted`,
  );
}
const jwt =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEFghiJKLmnoPQRstuv';
assert(redactSecrets(jwt).redacted.includes('[REDACTED:jwt]'), 'jwt redacted');
const pem =
  '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234\n-----END RSA PRIVATE KEY-----';
assert(redactSecrets(pem).redacted.includes('[REDACTED:private-key]'), 'private-key block redacted');
const labeled = 'CMS_JWT_SECRET=' + 'f'.repeat(64);
const labeledR = redactSecrets(labeled);
assert(
  labeledR.redacted.includes('[REDACTED:labeled-hex-secret]') && !labeledR.redacted.includes('f'.repeat(64)),
  'labeled prefix-less hex secret redacted',
);

console.log('\n[1b] benign text untouched (no false positives)');
const BENIGN = [
  'The commit sha is 59ecd59 and the file is foo.ts.',
  'A sha256 digest: ' + 'a'.repeat(64), // 64-hex — must NOT redact
  'UUID 019eb117-9846-75c0-bd19-51633444aa5e here.',
  'See https://app.trailmem.com/kb/sanne-andersen/search for details.',
  'function redactSecrets(text: string) { return text; }',
];
for (const b of BENIGN) {
  const r = redactSecrets(b);
  assert(r.redacted === b && r.findings.length === 0, `unchanged: "${b.slice(0, 38)}…"`);
}

// ── 2. INGEST gate — real DB round-trip through createCandidate ─────────
console.log('\n[2] INGEST gate — createCandidate stores redacted content');
const dbPath = join(tmpdir(), `trail-f197-verify-${process.pid}.db`);
const trail = await createLibsqlDatabase({ path: dbPath });
await trail.runMigrations();
const now = new Date().toISOString();
const TID = 'tnt_f197verify';
const UID = 'usr_f197verify';
const KID = 'kb_f197verify';
await trail.db.insert(tenants).values({ id: TID, slug: 'f197', name: 'F197 verify', createdAt: now }).run();
await trail.db
  .insert(users)
  .values({ id: UID, tenantId: TID, email: 'f197@trail.test', role: 'owner', createdAt: now })
  .run();
await trail.db
  .insert(knowledgeBases)
  .values({ id: KID, tenantId: TID, createdBy: UID, slug: 'f197', name: 'F197', createdAt: now, updatedAt: now })
  .run();

const leakKey = 'sk-ant-api03-' + 'Z'.repeat(80);
const { candidate } = await createCandidate(
  trail,
  TID,
  {
    knowledgeBaseId: KID,
    kind: 'chat-answer',
    title: `Key ${leakKey} note`,
    content: `Here is the key: ${leakKey}\nUse it carefully.`,
  },
  { id: UID, kind: 'user' },
);
const stored = await trail.db
  .select()
  .from(queueCandidates)
  .where(eq(queueCandidates.id, candidate.id))
  .get();
assert(stored != null, 'candidate row persisted');
assert(stored != null && !stored.content.includes(leakKey), 'stored content has NO raw key');
assert(
  stored != null && stored.content.includes('[REDACTED:anthropic-api-key]'),
  'stored content carries the redaction marker',
);
assert(
  stored != null && !stored.title.includes(leakKey) && stored.title.includes('[REDACTED:anthropic-api-key]'),
  'stored title redacted',
);

// ── 3. EGRESS guardrail — chat answer scrub for every audience ─────────
console.log('\n[3] EGRESS guardrail — stripForAudience scrubs the answer');
const answer = `Sure! The token is ${leakKey} — paste it in.`;
for (const aud of ['public', 'tool', 'curator'] as const) {
  const out = stripForAudience(answer, aud);
  assert(
    !out.includes(leakKey) && out.includes('[REDACTED:anthropic-api-key]'),
    `answer redacted for audience=${aud}`,
  );
}

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
await trail.close();
process.exit(failures === 0 ? 0 : 1);
