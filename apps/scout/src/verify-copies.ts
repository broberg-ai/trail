/**
 * F286.9 AC#1 — did every source reach its training brain unchanged?
 *
 * Compares the CONTENT of every source in an original brain with its training
 * copy by sha256, as a multiset — not by filename, because a renamed file with
 * the same bytes is the same source and a same-named file with other bytes is
 * not. One request at a time (22/9: parallel /content calls slowed the engine
 * enough to time out another session's writes).
 *
 *   bun run src/verify-copies.ts <original>:<copy> [<original>:<copy> …]
 */
import { createHash } from 'node:crypto';
import { allDocuments, get, requireKey } from './api.js';

requireKey();
const TENANT = 'broberg-ai';

async function hashes(kb: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const d of await allDocuments(TENANT, kb, 'source')) {
    const { content } = await get<{ content?: string | null }>(TENANT, `/api/v1/documents/${d.id}/content`);
    const h = createHash('sha256').update(content ?? '').digest('hex');
    out.set(h, [...(out.get(h) ?? []), d.filename]);
  }
  return out;
}

let failed = false;
for (const pair of process.argv.slice(2)) {
  const [original, copy] = pair.split(':') as [string, string];
  const a = await hashes(original);
  const b = await hashes(copy);
  const count = (m: Map<string, string[]>) => [...m.values()].reduce((n, v) => n + v.length, 0);
  const missing = [...a].filter(([h, f]) => (b.get(h)?.length ?? 0) < f.length).map(([, f]) => f.join(','));
  const extra = [...b].filter(([h, f]) => (a.get(h)?.length ?? 0) < f.length).map(([, f]) => f.join(','));
  console.log(`${original} → ${copy}: ${count(a)} kilder → ${count(b)} kilder · mangler i kopien ${missing.length} · ekstra i kopien ${extra.length}`);
  for (const f of missing) console.log(`  MANGLER  ${f}`);
  for (const f of extra) console.log(`  EKSTRA   ${f}`);
  if (missing.length || extra.length || count(a) !== count(b)) failed = true;
}
process.exit(failed ? 1 : 0);
