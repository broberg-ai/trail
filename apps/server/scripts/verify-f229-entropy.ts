/**
 * F229 — measure the image corpus of a live tenant: how many images carry no
 * picture at all.
 *
 * WHAT THIS ANSWERS, AND WHY A PIXEL THRESHOLD COULD NOT. F226 filters on
 * SIZE, and the owner disproved size as a proxy for content by opening one of
 * the images: 416x439, 714 KB — and a single pale-blue rectangle. Big enough to
 * pass any threshold, and a picture of nothing. Entropy measures the thing we
 * actually care about (is there any variation in these pixels?) and it costs
 * nothing: sharp reads it locally, no model, no tokens.
 *
 * Prints a distribution, not a verdict. The threshold is the owner's call and
 * this script is what he decides it from.
 *
 * Run:  bun run apps/server/scripts/verify-f229-entropy.ts <tenant> [kb-slug]
 */
import sharp from 'sharp';

const API = process.env.TRAIL_CLOUD_API ?? 'https://app.trailmem.com';
const KEY = process.env.TRAIL_API_KEY ?? '';
const TENANT = process.argv[2] ?? 'sanne-andersen';
const KB_ARG = process.argv[3] ?? '';

if (!KEY) {
  console.error('TRAIL_API_KEY missing — `set -a; source .env.local-ingest; set +a`');
  process.exit(1);
}
const H = { Authorization: `Bearer ${KEY}`, 'X-Trail-Tenant': TENANT };

interface Hit {
  id: string;
  documentId: string;
  filename: string;
  alt: string;
  width: number;
  height: number;
  visionModel: string | null;
}

async function listKbs(): Promise<{ id: string; slug: string }[]> {
  const r = await fetch(`${API}/api/v1/knowledge-bases`, { headers: H });
  if (!r.ok) throw new Error(`knowledge-bases ${r.status}`);
  return (await r.json()) as { id: string; slug: string }[];
}

async function allImages(kbId: string): Promise<Hit[]> {
  const out: Hit[] = [];
  let cursor: string | null = null;
  for (;;) {
    const u = new URL(`${API}/api/v1/knowledge-bases/${kbId}/images`);
    u.searchParams.set('limit', '50');
    u.searchParams.set('audience', 'curator');
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u, { headers: H });
    if (!r.ok) throw new Error(`images ${r.status}`);
    const j = (await r.json()) as { hits: Hit[]; nextCursor: string | null };
    out.push(...j.hits);
    if (!j.nextCursor) return out;
    cursor = j.nextCursor;
  }
}

/**
 * THREE STATES, NEVER TWO. A network failure and a solid-colour image must not
 * collapse into the same bucket — that is exactly the bug that made an earlier
 * probe in this repo report "168 missing" and then "216 missing" for the same
 * corpus, because a catch counted transient failures as findings.
 */
type Measured =
  | { kind: 'ok'; entropy: number; bytes: number }
  | { kind: 'unmeasurable'; why: string };

async function measure(h: Hit): Promise<Measured> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${API}/api/v1/documents/${h.documentId}/images/${h.filename}`, {
        headers: H,
      });
      if (!r.ok) {
        if (r.status >= 500 && attempt < 2) continue;
        return { kind: 'unmeasurable', why: `http ${r.status}` };
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const stats = await sharp(buf).stats();
      return { kind: 'ok', entropy: stats.entropy, bytes: buf.byteLength };
    } catch (err) {
      if (attempt === 2) return { kind: 'unmeasurable', why: (err as Error).message };
    }
  }
  return { kind: 'unmeasurable', why: 'retries exhausted' };
}

const BUCKETS = [
  { label: 'under 0,5  (ensfarvet)', lo: 0, hi: 0.5 },
  { label: '0,5 - 1,5', lo: 0.5, hi: 1.5 },
  { label: '1,5 - 3,0', lo: 1.5, hi: 3.0 },
  { label: '3,0 - 5,0', lo: 3.0, hi: 5.0 },
  { label: 'over 5,0   (rigt indhold)', lo: 5.0, hi: Infinity },
];

async function main() {
  const kbs = await listKbs();
  const targets = KB_ARG ? kbs.filter((k) => k.slug === KB_ARG || k.id === KB_ARG) : kbs;
  if (targets.length === 0) throw new Error(`no KB matched "${KB_ARG}"`);

  const rows: { hit: Hit; m: Measured }[] = [];
  for (const kb of targets) {
    const hits = await allImages(kb.id);
    console.log(`${kb.slug}: ${hits.length} billeder`);
    const CONC = 8;
    for (let i = 0; i < hits.length; i += CONC) {
      const slice = hits.slice(i, i + CONC);
      const got = await Promise.all(slice.map((h) => measure(h)));
      slice.forEach((h, j) => rows.push({ hit: h, m: got[j] }));
      if ((i / CONC) % 10 === 0) process.stderr.write(`\r  ${i + slice.length}/${hits.length}`);
    }
    process.stderr.write('\n');
  }

  const ok = rows.filter((r) => r.m.kind === 'ok') as { hit: Hit; m: { kind: 'ok'; entropy: number; bytes: number } }[];
  const bad = rows.filter((r) => r.m.kind !== 'ok');

  console.log(`\nMÅLT ${ok.length} · IKKE MÅLBARE ${bad.length}`);
  if (bad.length > 0) {
    const why = new Map<string, number>();
    for (const b of bad) why.set((b.m as { why: string }).why, (why.get((b.m as { why: string }).why) ?? 0) + 1);
    for (const [w, n] of why) console.log(`   ikke målbar: ${w} × ${n}`);
  }

  console.log('\n%-26s %8s %10s %12s', 'entropi', 'antal', 'MB', 'beskrevet');
  for (const b of BUCKETS) {
    const inB = ok.filter((r) => r.m.entropy >= b.lo && r.m.entropy < b.hi);
    const mb = inB.reduce((s, r) => s + r.m.bytes, 0) / 1e6;
    const described = inB.filter((r) => r.hit.alt && r.hit.alt.trim()).length;
    console.log(
      `${b.label.padEnd(26)} ${String(inB.length).padStart(8)} ${mb.toFixed(1).padStart(10)} ${String(described).padStart(12)}`,
    );
  }

  // The negative control for the whole exercise: how many blobs a SIZE filter
  // lets through. If this is 0, entropy adds nothing over F226 and the card
  // should not be built.
  const blobs = ok.filter((r) => r.m.entropy < 0.5);
  for (const px of [32, 64, 72, 100]) {
    const survive = blobs.filter((r) => Math.min(r.hit.width, r.hit.height) >= px).length;
    console.log(`  ensfarvede der overlever en ${px}px-grænse: ${survive}`);
  }
  const biggest = [...blobs].sort((a, b) => b.m.bytes - a.m.bytes)[0];
  if (biggest) {
    console.log(
      `  største ensfarvede: ${biggest.hit.width}x${biggest.hit.height}, ${(biggest.m.bytes / 1e6).toFixed(1)} MB (${biggest.hit.filename})`,
    );
  }
  const noVision = ok.filter((r) => !r.hit.visionModel).length;
  console.log(`\nUden vision overhovedet: ${noVision} af ${ok.length} (${((noVision / ok.length) * 100).toFixed(0)} %)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
