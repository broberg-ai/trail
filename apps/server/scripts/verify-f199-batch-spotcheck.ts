/**
 * F199.3–.8 spot-check — exercise all 5 migrated engine AI services end-to-end
 * on Mistral, against a freshly-seeded TEMP DB (no dev-data pollution). Each
 * service's REAL orchestrator is called so we hit its actual prompt + parser
 * via the mistral override. Proves: output parses + reads sanely on Mistral.
 *
 * Run from apps/server:
 *   set -a; source ../../.env; set +a; bun run scripts/verify-f199-batch-spotcheck.ts
 */
import { join } from 'node:path';
import {
  createLibsqlDatabase,
  tenants,
  users,
  knowledgeBases,
  documents,
  queueCandidates,
} from '@trail/db';
import { eq } from 'drizzle-orm';
import { suggestTagsForNeuron } from '../src/services/tag-suggester.js';
import { proposeSourcesForOrphan } from '../src/services/source-inferer.js';
import { ensureCandidateInLocale } from '../src/services/translation.js';
import { backfillGlossaryForKb } from '../src/services/glossary-backfill.js';
import { backfillRecommendations } from '../src/services/action-recommender.js';
import { buildSeedGlossary } from '../src/services/glossary-seed.js';

if (!process.env.MISTRAL_API_KEY) {
  console.error('✗ no MISTRAL_API_KEY in env — cannot runtime-verify');
  process.exit(1);
}

const T = 't-f199-spot';
const U = 'u-f199-spot';
const KB = 'kb-f199-spot';
const CAND = 'cand-f199-spot';
const DB_PATH = join(
  process.env.TMPDIR ?? '/tmp',
  `f199-spotcheck-${process.env.USER ?? 'x'}.db`,
);

// Fresh DB every run.
import { rmSync } from 'node:fs';
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();

// ── Seed the FK chain ───────────────────────────────────────────────────
await trail.db.insert(tenants).values({ id: T, slug: 'f199-spot', name: 'F199 spot', plan: 'hobby' }).run();
await trail.db.insert(users).values({
  id: U, tenantId: T, email: 'f199-spot@local.trail', displayName: 'Spot', role: 'owner', onboarded: true,
}).run();
await trail.db.insert(knowledgeBases).values({
  id: KB, tenantId: T, createdBy: U, name: 'F199 spot KB', slug: 'f199-spot', language: 'da',
}).run();

const doc = (id: string, kind: 'source' | 'wiki', filename: string, title: string, content: string, path = '/neurons/') => ({
  id, tenantId: T, knowledgeBaseId: KB, userId: U, kind, filename, path,
  fileType: kind === 'source' ? 'text/markdown' : 'wiki', title, content, status: 'ready' as const,
});

// 3 source docs (for auto-link search), 2 content Neurons, 1 glossary Neuron.
await trail.db.insert(documents).values([
  doc('src-1', 'source', 'retention-policy.md', 'Retention policy', 'Trail retains deleted Neurons for 30 days in a recoverable state before purge. An admin can restore within the window.'),
  doc('src-2', 'source', 'decay-design.md', 'Memory decay design', 'Memory decay lowers a Neuron confidence over time unless reinforced or pinned. Enabled by default per tenant.'),
  doc('src-3', 'source', 'magic-link.md', 'Magic-link auth', 'A magic-link login token expires 15 minutes after issue; using it later returns an error.'),
  doc('neu-1', 'wiki', 'retention.md', 'Neuron retention window', 'Deleted Neurons stay recoverable for 30 days; an administrator restores them from the recovery window.'),
  doc('neu-2', 'wiki', 'decay.md', 'Confidence decay', 'A Neuron confidence decays over time; reinforcement or a curator pin halts the decay.'),
  doc('glossary', 'wiki', 'glossary.md', 'Glossary', buildSeedGlossary('da')),
]).run();

// 1 pending candidate (EN-only) for translation + action-recommender.
await trail.db.insert(queueCandidates).values({
  id: CAND, tenantId: T, knowledgeBaseId: KB, kind: 'chat-answer',
  title: 'Neuron retention window',
  content: 'Deleted Neurons in Trail remain recoverable for 30 days before they are permanently purged. An administrator can restore any Neuron within that window.',
  status: 'pending',
  actions: JSON.stringify([
    { id: 'approve', effect: 'approve', label: { en: 'Approve' }, explanation: { en: 'Accept this Neuron into the KB.' } },
    { id: 'reject', effect: 'reject', label: { en: 'Reject' }, explanation: { en: 'Discard this candidate.' } },
  ]),
}).run();

// FTS rebuild so source-inferer's searchDocuments sees the seeded docs.
await trail.initFTS();

// ── Run the 5 services ──────────────────────────────────────────────────
const results: { svc: string; ok: boolean; detail: string }[] = [];
const rec = (svc: string, ok: boolean, detail: string) => results.push({ svc, ok, detail });

// F199.4 — tag-suggester
try {
  const tags = await suggestTagsForNeuron(trail, T, KB, {
    title: 'Neuron retention window',
    content: 'Deleted Neurons stay recoverable for 30 days; an admin restores them before purge.',
  });
  rec('F199.4 tag-suggester', !!tags && tags.length > 0, `tags=${JSON.stringify(tags)}`);
} catch (e) { rec('F199.4 tag-suggester', false, `ERROR ${e instanceof Error ? e.message : e}`); }

// F199.5 — auto-link (source-inferer)
try {
  const srcs = await proposeSourcesForOrphan(trail, T, KB,
    'Deleted Neurons can be restored by an administrator within a 30-day recovery window before purge.');
  const allValid = srcs.every((s) => ['retention-policy.md', 'decay-design.md', 'magic-link.md'].includes(s));
  rec('F199.5 auto-link', allValid, `proposed=${JSON.stringify(srcs)} (all valid filenames=${allValid})`);
} catch (e) { rec('F199.5 auto-link', false, `ERROR ${e instanceof Error ? e.message : e}`); }

// F199.3 — translation (EN→DA)
try {
  const bundle = await ensureCandidateInLocale(trail, T, CAND, 'da');
  const da = bundle?.content ?? '';
  const looksDanish = /\b(neuroner?|slettede|gendanne|administrator|dage)\b/i.test(da);
  rec('F199.3 translation', !!bundle && da.length > 0 && looksDanish, `da.title="${bundle?.title}" da.content="${da.slice(0, 120)}…"`);
} catch (e) { rec('F199.3 translation', false, `ERROR ${e instanceof Error ? e.message : e}`); }

// F199.6 — glossary-backfill (clean JSON parse)
try {
  const written = await backfillGlossaryForKb(trail, { id: KB, tenantId: T, createdBy: U, name: 'F199 spot KB', language: 'da' });
  const glossary = await trail.db.select({ content: documents.content }).from(documents).where(eq(documents.id, 'glossary')).get();
  rec('F199.6 glossary', written >= 0 && !!glossary, `entriesWritten=${written}, glossaryLen=${glossary?.content?.length ?? 0}`);
} catch (e) { rec('F199.6 glossary', false, `ERROR ${e instanceof Error ? e.message : e}`); }

// F199.8 — action-recommender (valid JSON + recommendation persisted)
try {
  await backfillRecommendations(trail);
  const cand = await trail.db.select({ metadata: queueCandidates.metadata }).from(queueCandidates).where(eq(queueCandidates.id, CAND)).get();
  const md = cand?.metadata ? JSON.parse(cand.metadata) : {};
  const recd = md.recommendation;
  rec('F199.8 action-recommender', !!recd, `recommendation=${JSON.stringify(recd)?.slice(0, 140)}`);
} catch (e) { rec('F199.8 action-recommender', false, `ERROR ${e instanceof Error ? e.message : e}`); }

// ── Report ──────────────────────────────────────────────────────────────
console.log('\n=== F199.3–.8 batch spot-check (all on Mistral) ===\n');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.svc}\n    ${r.detail}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\nscore: ${passed}/${results.length}`);
await trail.close();
process.exit(passed === results.length ? 0 : 1);
