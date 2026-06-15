/**
 * F010 — verify the @broberg/apikey swap is byte-identical to the prior
 * hand-rolled crypto + that selectTenant reproduces trail's selector-not-grant
 * tenant resolution exactly. Pure logic; the wired proxy path is proven by the
 * live e2e (cb scope=all key → member 200 / bogus slug 401).
 *
 * The #1 safety gate: hashApiKey(raw) MUST equal the old sha256(raw), or every
 * key already stored in control.db stops verifying after deploy.
 *
 * Run from apps/admin-server:
 *   TRAIL_ADMIN_CONTROL_DB=/tmp/trail-f010-verify.db bun run scripts/verify-f010-apikey-swap.ts
 */
import { createHash } from 'node:crypto';
import { selectTenant, TenantAccessError } from '@broberg/apikey/authorize';
import { generateKey } from '@broberg/apikey';
import { hashApiKey } from '../src/keys.js';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log('\n=== F010 apikey swap verify ===\n');

// ── 1. hash byte-identity — existing stored keys must still verify ──────────
console.log('[1] hashApiKey === legacy sha256(raw) (existing keys keep working)');
for (const raw of [
  'trail_' + '0'.repeat(64),
  'trail_deadbeef'.padEnd(70, 'a'),
  generateKey('trail'),
  'trail_' + 'ab12cd34'.repeat(8),
]) {
  const legacy = createHash('sha256').update(raw).digest('hex');
  assert(hashApiKey(raw) === legacy, `hashApiKey matches legacy sha256 for ${raw.slice(0, 14)}…`);
}

// ── 2. mint form unchanged ──────────────────────────────────────────────────
console.log('\n[2] mint form');
const minted = generateKey('trail');
assert(/^trail_[0-9a-f]{64}$/.test(minted), 'generateKey("trail") → trail_<64hex>');

// ── 3. selectTenant — trail's selector-not-grant, 1:1 ───────────────────────
console.log('\n[3] selectTenant decision matrix');
const members = new Set(['broberg-ai', 'sanne-andersen']);
const isMember = (s: string) => members.has(s);

// scope=all + member slug → routes to the requested tenant
assert(
  selectTenant({ requestedSlug: 'sanne-andersen', homeTenant: 'broberg-ai', spansAll: true, isMember }) ===
    'sanne-andersen',
  'scope=all + member slug → routes to requested',
);
// scope=all + NO header → home tenant
assert(
  selectTenant({ requestedSlug: undefined, homeTenant: 'broberg-ai', spansAll: true, isMember }) === 'broberg-ai',
  'scope=all + no header → home tenant',
);
// scope=all + NON-member slug → HARD refuse (TenantAccessError, never silent home)
let threw = false;
try {
  selectTenant({ requestedSlug: 'someone-elses-tenant', homeTenant: 'broberg-ai', spansAll: true, isMember });
} catch (e) {
  threw = e instanceof TenantAccessError;
}
assert(threw, 'scope=all + non-member slug → throws TenantAccessError (→ 401, no silent fallback)');
// single-tenant (spansAll=false) → IGNORES the selector, returns home
assert(
  selectTenant({ requestedSlug: 'sanne-andersen', homeTenant: 'broberg-ai', spansAll: false, isMember }) ===
    'broberg-ai',
  'spansAll=false → ignores header, returns home (legacy keys unchanged)',
);

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
