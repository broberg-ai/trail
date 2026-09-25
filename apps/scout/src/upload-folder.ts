/**
 * F286.15 — læg Foragers danske kilder i en Scout Training-brain, PARKERET til
 * lokal kompilering (?localCompile=true), så læreren kompilerer dem i en
 * interaktiv Max-session til 0 kr. Samme upload-rute og samme flag som
 * reingest.ts — forskellen er kun hvor teksten kommer fra (en mappe med
 * manifest.jsonl i stedet for en eksisterende brain).
 *
 * Kør:
 *   bun run apps/scout/src/upload-folder.ts --dir <forager>/out/scout-da-1000 --to "Scout Training 0004 DA" --dry-run
 *   bun run apps/scout/src/upload-folder.ts --dir … --to "…" --limit 5          # røgprøve
 *   bun run apps/scout/src/upload-folder.ts --dir … --kb-id <id>                 # genoptag
 *
 * Genoptagelig: filer hvis navn allerede ligger i mål-brainen springes over, så
 * en afbrudt kørsel kan startes igen uden at lave dublet-kilder.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API = process.env.TRAIL_CLOUD_API ?? process.env.TRAIL_API_URL ?? 'https://app.trailmem.com';
const TENANT = 'broberg-ai';

function token(): string {
  const t = process.env.TRAIL_API_KEY ?? process.env.TRAIL_INGEST_TOKEN;
  if (!t) throw new Error('TRAIL_API_KEY mangler — den ligger i repoets .env.local-ingest');
  return t;
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${token()}`, 'X-Trail-Tenant': TENANT };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

interface ManifestRow {
  id: string;
  file: string;
  source_type: string;
  url: string;
  title: string;
  license: string;
}

/** Foragers id'er bærer «...» og andre tegn der ikke hører hjemme i et filnavn. */
export function fileNameFor(row: ManifestRow): string {
  return `${row.source_type}-${row.id.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-')}.md`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (n: string): string | undefined => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dir = arg('--dir');
  const to = arg('--to');
  const kbIdArg = arg('--kb-id');
  const limit = Number(arg('--limit') ?? Infinity);
  const dryRun = args.includes('--dry-run');
  if (!dir || (!to && !kbIdArg)) throw new Error('brug: --dir <mappe> (--to "<navn>" | --kb-id <id>) [--limit N] [--dry-run]');

  const rows = readFileSync(join(dir, 'manifest.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ManifestRow);
  const byType = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.source_type]: (m[r.source_type] ?? 0) + 1 }), {});
  process.stderr.write(`manifest: ${rows.length} kilder ${JSON.stringify(byType)}\n`);

  if (dryRun) {
    process.stderr.write('TØRLØB — intet oprettet, intet uploadet.\n');
    return;
  }

  const kb = kbIdArg
    ? { id: kbIdArg }
    : await api<{ id: string; slug: string }>('/api/v1/knowledge-bases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: to, language: 'da', description: 'F286.15 — dansk Scout-træningsmateriale (Forager F008).' }),
      });
  process.stderr.write(`mål-brain: ${kb.id}\n`);

  const existing = await api<{ filename: string }[]>(`/api/v1/knowledge-bases/${kb.id}/documents?kind=source`);
  const already = new Set(existing.map((d) => d.filename));

  let uploaded = 0;
  let skipped = 0;
  for (const row of rows) {
    if (uploaded >= limit) break;
    const name = fileNameFor(row);
    if (already.has(name)) {
      skipped++;
      continue;
    }
    const form = new FormData();
    form.append('file', new File([readFileSync(join(dir, row.file), 'utf8')], name, { type: 'text/markdown' }));
    form.append('path', `/${row.source_type}/`);
    const res = await fetch(`${API}/api/v1/knowledge-bases/${kb.id}/documents/upload?localCompile=true`, {
      method: 'POST',
      headers: headers(),
      body: form,
    });
    if (!res.ok) throw new Error(`upload ${name} → ${res.status} ${await res.text()}`);
    uploaded++;
    if (uploaded % 25 === 0) process.stderr.write(`  uploadet ${uploaded}\n`);
  }
  console.log(JSON.stringify({ kbId: kb.id, uploaded, skipped, total: rows.length }));
}

if (import.meta.main) await main();
