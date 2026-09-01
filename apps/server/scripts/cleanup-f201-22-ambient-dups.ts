/**
 * F201.22 cleanup — archive the duplicate ambient Neurons that landed today.
 *
 * On 2026-09-01 the restored relay (F201.21) drained two months of focus.jsonl
 * before the filters existed. 48 candidates auto-approved into Neurons covering
 * 19 real topics: one sidebar in Notes became a dozen "facts".
 *
 * ARCHIVES, NEVER DELETES. `DELETE /documents/:id` sets archived=true — the row
 * and its content survive, so the evidence that this was needed is not destroyed
 * along with the noise.
 *
 * Groups on CONTENT, not on title similarity. Two Neurons can carry different
 * titles for the same observation, and a title-only rule would both miss those
 * and merge genuinely different work that happened to be named alike.
 *
 * Dry run by default. `--apply` to act.
 *
 *   bun run scripts/cleanup-f201-22-ambient-dups.ts [--apply]
 */
const BASE = process.env.TRAIL_CLOUD_API ?? 'https://app.trailmem.com';
const TOKEN = process.env.TRAIL_API_KEY;
const TENANT = process.env.TRAIL_TENANT ?? 'broberg-ai';
const KB = process.env.TRAIL_AMBIENT_KB ?? 'ae9aad44-8ac8-4036-bf02-222e17f593d1';
const DAY = process.env.CLEANUP_DAY ?? '2026-09-01';
const apply = process.argv.includes('--apply');

if (!TOKEN) { console.error('TRAIL_API_KEY not set — source .env.local-ingest'); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}`, 'X-Trail-Tenant': TENANT };

interface Doc { id: string; title: string; createdAt: string; kind?: string }

const docs = (await (await fetch(`${BASE}/api/v1/knowledge-bases/${KB}/documents?limit=500`, { headers: H })).json()) as Doc[];
const today = docs.filter((d) => String(d.createdAt ?? '').startsWith(DAY));
console.log(`${today.length} Neuron(er) oprettet ${DAY} i KB ${KB}`);

/** Fetch each one's body — the grouping key is what it SAYS, not what it is called. */
const bodies = new Map<string, string>();
for (const d of today) {
  const r = await fetch(`${BASE}/api/v1/documents/${d.id}/content`, { headers: H });
  bodies.set(d.id, r.ok ? ((await r.json()) as { content?: string }).content ?? '' : '');
}

const words = (s: string): Set<string> =>
  new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));
const overlap = (a: Set<string>, b: Set<string>): number => {
  const inter = [...a].filter((w) => b.has(w)).length;
  return inter / Math.max(1, Math.min(a.size, b.size));
};

// Oldest first, so the KEPT one in each cluster is the first observation.
const sorted = [...today].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
const clusters: Array<{ keep: Doc; dropped: Doc[]; w: Set<string> }> = [];
for (const d of sorted) {
  const w = words(`${d.title} ${bodies.get(d.id) ?? ''}`);
  const hit = clusters.find((c) => overlap(w, c.w) >= 0.75);
  if (hit) hit.dropped.push(d);
  else clusters.push({ keep: d, dropped: [], w });
}

const drop = clusters.flatMap((c) => c.dropped);
console.log(`${clusters.length} distinkte emner · ${drop.length} overskydende dubletter\n`);
for (const c of clusters.filter((x) => x.dropped.length > 0)) {
  console.log(`BEHOLD  ${c.keep.createdAt}  ${c.keep.title.slice(0, 58)}`);
  for (const d of c.dropped) console.log(`  arkivér ${d.createdAt}  ${d.title.slice(0, 55)}`);
}

if (!apply) { console.log(`\nTØRKØRSEL — ingen ændringer. Kør med --apply for at arkivere de ${drop.length}.`); process.exit(0); }

let ok = 0, failed = 0;
for (const d of drop) {
  const r = await fetch(`${BASE}/api/v1/documents/${d.id}`, { method: 'DELETE', headers: H });
  r.ok ? ok++ : (failed++, console.error(`  FEJL ${r.status} på ${d.id} ${d.title.slice(0, 40)}`));
}
console.log(`\narkiveret ${ok}, fejlet ${failed}`);

// Read back from a FRESH request — never trust the loop's own count.
const after = (await (await fetch(`${BASE}/api/v1/knowledge-bases/${KB}/documents?limit=500`, { headers: H })).json()) as Doc[];
const activeToday = after.filter((d) => String(d.createdAt ?? '').startsWith(DAY)).length;
console.log(`aktive Neuroner fra ${DAY} efter oprydning: ${activeToday} (forventet ${clusters.length})`);
process.exit(activeToday === clusters.length ? 0 : 1);
