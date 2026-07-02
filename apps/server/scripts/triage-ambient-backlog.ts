/**
 * F201.11 backlog triage — re-distill the RAW ambient candidates that piled up
 * before distill went live, so the noise can be cleared and any buried
 * knowledge surfaced. Read-only by default; pass --apply to bulk-reject the
 * noise ones (reversible — the queue has a reopen).
 *
 * Run from apps/server (needs both keys):
 *   set -a; source ../../.env; source ../../.env.local-ingest; set +a
 *   bun run scripts/triage-ambient-backlog.ts          # dry run (report only)
 *   bun run scripts/triage-ambient-backlog.ts --apply   # reject the noise
 */
import { distillAmbientCapture } from '../src/services/ambient-distill.js';

const API = process.env.TRAIL_CLOUD_API ?? 'https://app.trailmem.com';
const KEY = process.env.TRAIL_API_KEY!;
const KB = 'ae9aad44-8ac8-4036-bf02-222e17f593d1'; // Ambient Test
const APPLY = process.argv.includes('--apply');
const H = { Authorization: `Bearer ${KEY}`, 'X-Trail-Tenant': 'broberg-ai', 'Content-Type': 'application/json' };

const res = await fetch(`${API}/api/v1/queue?knowledgeBaseId=${KB}&connector=trail-ambient-capture&status=pending&limit=200`, { headers: H });
const { items } = (await res.json()) as { items: Array<{ id: string; title: string; content: string }> };
console.log(`Pending ambient candidates: ${items.length}\n`);

const noise: string[] = [];
const knowledge: Array<{ id: string; title: string; content: string }> = [];

// Distill in small batches to keep Mistral happy.
for (let i = 0; i < items.length; i += 5) {
  const batch = items.slice(i, i + 5);
  const results = await Promise.all(
    batch.map(async (it) => {
      try {
        const d = await distillAmbientCapture({ title: it.title, content: it.content }, { tenantId: 'triage', kbId: KB });
        return { it, d };
      } catch {
        return { it, d: null };
      }
    }),
  );
  for (const { it, d } of results) {
    if (d?.verdict === 'knowledge') knowledge.push({ id: it.id, title: d.title, content: d.content });
    else noise.push(it.id);
  }
  process.stdout.write(`  …distilled ${Math.min(i + 5, items.length)}/${items.length}\r`);
}

console.log(`\n\n── Triage result ──`);
console.log(`  noise (clearable): ${noise.length}`);
console.log(`  knowledge (worth keeping): ${knowledge.length}`);
if (knowledge.length) {
  console.log(`\n  Knowledge candidates found:`);
  for (const k of knowledge) console.log(`   • ${k.title}`);
}

if (!APPLY) {
  console.log(`\n(dry run — nothing changed. Re-run with --apply to: approve the ${knowledge.length} knowledge candidate(s) with distilled text → Neurons, and reject the ${noise.length} noise candidate(s).)`);
  process.exit(0);
}

// Keep the real ones: approve each with its DISTILLED text → a clean Neuron.
let approved = 0;
for (const k of knowledge) {
  const r = await fetch(`${API}/api/v1/queue/${k.id}/resolve`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ actionId: 'approve', editedContent: k.content }),
  });
  if (r.ok) approved++;
  else console.error(`  approve failed for ${k.id}: ${r.status} ${await r.text()}`);
}
console.log(`\n✓ approved ${approved}/${knowledge.length} knowledge candidate(s) as distilled Neurons`);

// Reject the noise.
if (noise.length) {
  const rej = await fetch(`${API}/api/v1/queue/bulk`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ effect: 'reject', ids: noise, reason: 'Pre-distill raw ambient noise (F201.11 backlog triage)' }),
  });
  console.log(`✓ rejected ${noise.length} noise candidate(s) →`, await rej.json());
}
