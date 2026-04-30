/**
 * F111.2 — mint an API key via SSH directly into a remote engine's DB.
 *
 * Uses the EXACT same logic as POST /api/v1/api-keys:
 *   key  = `trail_${randomBytes(32).hex}`
 *   hash = sha256(key)
 *   INSERT INTO api_keys(id, tenant_id, user_id, name, key_hash)
 *
 * Operator workflow when admin SPA isn't yet deployed (Phase 1A bridge).
 * Once F33 Phase 1B ships, prefer the admin UI.
 *
 * Run: bun run apps/server/scripts/mint-api-key.ts \
 *   --fly-app trail-engine-001 \
 *   --tenant t-sanne-andersen \
 *   --user u-sanne \
 *   --kb-slug sanne-andersen \
 *   --name "sanne-andersen.dk-prod"
 */

import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

interface Args {
  flyApp: string;
  tenant: string;
  user: string;
  kbSlug: string;
  name: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (flag: string): string => {
    const idx = a.indexOf(flag);
    if (idx === -1 || idx === a.length - 1) {
      throw new Error(`missing ${flag}`);
    }
    return a[idx + 1]!;
  };
  return {
    flyApp: get('--fly-app'),
    tenant: get('--tenant'),
    user: get('--user'),
    kbSlug: get('--kb-slug'),
    name: get('--name'),
  };
}

const args = parseArgs();

// Generate the raw key + sha256 hash locally so we never log the raw key
// to the SSH transcript.
const rawKey = `trail_${randomBytes(32).toString('hex')}`;
const keyHash = createHash('sha256').update(rawKey).digest('hex');
const id = crypto.randomUUID();
const dbPath = `/data/${args.kbSlug}/trail.db`;

// Pre-flight: assert tenant + user exist (so we don't INSERT a key
// pointing at a missing FK). Engine has bun + @libsql/client baked in,
// so we can run a tiny inline script via fly ssh console -C.
const preflightScript = `bun -e "
  const c = require('@libsql/client');
  const db = c.createClient({ url: 'file:${dbPath}' });
  (async () => {
    const t = await db.execute({sql: 'SELECT id, slug FROM tenants WHERE id = ?', args: ['${args.tenant}']});
    const u = await db.execute({sql: 'SELECT id, email FROM users WHERE id = ? AND tenant_id = ?', args: ['${args.user}', '${args.tenant}']});
    console.log('tenant:', t.rows[0] ? t.rows[0].id + ' (' + t.rows[0].slug + ')' : 'MISSING');
    console.log('user:', u.rows[0] ? u.rows[0].id + ' (' + u.rows[0].email + ')' : 'MISSING');
  })();
"`.replace(/\n\s*/g, ' ');

console.log(`[1] Pre-flight: verify tenant + user on ${args.flyApp}`);
const pre = spawnSync('fly', ['ssh', 'console', '--app', args.flyApp, '-C', preflightScript], {
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const preOut = pre.stdout ?? '';
console.log(preOut.trim());
if (preOut.includes('MISSING')) {
  console.error('  ✗ tenant or user missing on engine');
  process.exit(1);
}

// INSERT
console.log(`[2] INSERT api_keys row id=${id}`);
const insertScript = `bun -e "
  const c = require('@libsql/client');
  const db = c.createClient({ url: 'file:${dbPath}' });
  db.execute({
    sql: 'INSERT INTO api_keys (id, tenant_id, user_id, name, key_hash) VALUES (?, ?, ?, ?, ?)',
    args: ['${id}', '${args.tenant}', '${args.user}', '${args.name.replace(/'/g, "''")}', '${keyHash}'],
  }).then(() => console.log('OK')).catch(err => { console.error(err); process.exit(1); });
"`.replace(/\n\s*/g, ' ');

const ins = spawnSync('fly', ['ssh', 'console', '--app', args.flyApp, '-C', insertScript], {
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (!(ins.stdout ?? '').includes('OK')) {
  console.error('  ✗ INSERT failed');
  console.error(ins.stdout);
  process.exit(1);
}
console.log('  ✓ row inserted');

console.log(`\n=== F111.2 — API key minted ===\n`);
console.log(`Tenant:      ${args.tenant}`);
console.log(`User:        ${args.user}`);
console.log(`Name:        ${args.name}`);
console.log(`Key id:      ${id}`);
console.log(`\n  ⚠️  RAW KEY — copy now, will not be shown again:\n`);
console.log(`  ${rawKey}\n`);
console.log(`Use as:  Authorization: Bearer ${rawKey}`);
