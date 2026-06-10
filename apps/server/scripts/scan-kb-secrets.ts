/**
 * F197.4 — retro-scan a KB's existing Neurons for leaked secrets that predate
 * the F197 ingest gate. Uses the SAME redactSecrets detector as the gate.
 *
 * SAFETY: never echoes a raw secret. Reports only the pattern label + a context
 * line with the secret already masked, so findings can be triaged without
 * re-leaking the value into this transcript.
 *
 * Run: cd apps/server && bun run scripts/scan-kb-secrets.ts <kb-slug> [tenant]
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSecrets } from '@trail/shared';

const kb = process.argv[2] ?? 'buddy-sessions';
const tenant = process.argv[3] ?? 'broberg-ai';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '../../../.env.local-ingest');
function envVal(name: string): string {
  if (!existsSync(envPath)) return '';
  const m = readFileSync(envPath, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, 'm'));
  return m ? (m[1] ?? '').trim() : '';
}
const BASE = process.env.TRAIL_CLOUD_API || envVal('TRAIL_CLOUD_API') || 'https://app.trailmem.com';
const KEY = process.env.TRAIL_API_KEY || envVal('TRAIL_API_KEY');
if (!KEY) {
  console.error('No TRAIL_API_KEY (set it in repo-root .env.local-ingest)');
  process.exit(1);
}
const H = { Authorization: `Bearer ${KEY}`, 'X-Trail-Tenant': tenant };

console.log(`\n=== F197.4 retro-scan: kb=${kb} tenant=${tenant} ===\n`);

const listRes = await fetch(`${BASE}/api/v1/knowledge-bases/${kb}/documents`, { headers: H });
if (!listRes.ok) {
  console.error(`list failed: HTTP ${listRes.status}`);
  process.exit(1);
}
const docs = (await listRes.json()) as Array<{ id: string; title: string; path: string }>;
console.log(`Scanning ${docs.length} Neurons…\n`);

interface Hit {
  id: string;
  title: string;
  path: string;
  labels: string[];
  sample: string;
}
const hits: Hit[] = [];
let scanned = 0;
let errors = 0;

function maskedLine(redactedText: string): string {
  const line = redactedText.split('\n').find((l) => l.includes('[REDACTED:'));
  return (line ?? '').trim().slice(0, 160);
}

const BATCH = 8;
for (let i = 0; i < docs.length; i += BATCH) {
  const slice = docs.slice(i, i + BATCH);
  await Promise.all(
    slice.map(async (d) => {
      try {
        const r = await fetch(`${BASE}/api/v1/documents/${d.id}/content`, { headers: H });
        if (!r.ok) {
          errors += 1;
          return;
        }
        const body = (await r.json()) as { content?: string };
        const titleScan = redactSecrets(d.title ?? '');
        const contentScan = redactSecrets(body.content ?? '');
        const findings = [...titleScan.findings, ...contentScan.findings];
        if (findings.length > 0) {
          const labels = [...new Set(findings.map((f) => f.label))];
          hits.push({
            id: d.id,
            title: d.title,
            path: d.path,
            labels,
            sample: maskedLine(contentScan.redacted) || maskedLine(titleScan.redacted),
          });
        }
      } catch {
        errors += 1;
      }
    }),
  );
  scanned += slice.length;
  if (scanned % 80 === 0 || scanned >= docs.length) console.log(`  …${Math.min(scanned, docs.length)}/${docs.length}`);
}

console.log(`\n=== RESULT ===`);
console.log(`Scanned:            ${docs.length} Neurons (${errors} fetch errors)`);
console.log(`With leaked secret: ${hits.length}`);
if (hits.length > 0) {
  const byLabel: Record<string, number> = {};
  for (const h of hits) for (const l of h.labels) byLabel[l] = (byLabel[l] ?? 0) + 1;
  console.log(`By type:            ${JSON.stringify(byLabel)}`);
  console.log(`\n--- Neurons with secrets (raw value NOT shown) ---`);
  for (const h of hits) {
    console.log(`• ${h.id}  [${h.labels.join(', ')}]  ${h.path}`);
    console.log(`    title: ${redactSecrets(h.title).redacted.slice(0, 90)}`);
    if (h.sample) console.log(`    ctx:   ${h.sample}`);
  }
}
console.log();
process.exit(0);
