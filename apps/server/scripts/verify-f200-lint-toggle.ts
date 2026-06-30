/**
 * F200.1 + F200.2 runtime proof (RED test) against a fresh temp DB.
 *
 * F200.1 — per-KB contradiction-lint toggle:
 *   - migration 0039 adds contradiction_lint_enabled (round-trips true/false);
 *   - scanDocForContradictions with a STUB checker (no LLM) emits a
 *     contradiction-alert for an ENABLED KB but emits ZERO for a DISABLED KB.
 * F200.2 — drain filter selectivity:
 *   - the connector="lint" filter rejects lint candidates but NEVER a
 *     knowledge candidate (connector="buddy").
 *
 * Run from apps/server:  bun run scripts/verify-f200-lint-toggle.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  createLibsqlDatabase,
  tenants,
  users,
  knowledgeBases,
  documents,
  queueCandidates,
} from '@trail/db';
import { and, eq, like, sql } from 'drizzle-orm';
import { scanDocForContradictions } from '../src/services/contradiction-lint.js';

const T = 't-f200', U = 'u-f200', KB_ON = 'kb-f200-on', KB_OFF = 'kb-f200-off';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f200-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// AC: migration added the column.
const cols = (await trail.execute("SELECT name FROM pragma_table_info('knowledge_bases')")).rows.map((r) => r.name);
check('F200.1 migration: contradiction_lint_enabled column present', cols.includes('contradiction_lint_enabled'));

// Seed FK chain + 2 KBs (ON default true, OFF set false).
await trail.db.insert(tenants).values({ id: T, slug: 'f200', name: 'F200', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f200@local.trail', displayName: 'F200', role: 'owner', onboarded: true }).run();
await trail.db.insert(knowledgeBases).values({ id: KB_ON, tenantId: T, createdBy: U, name: 'ON', slug: 'f200-on', language: 'da' }).run();
await trail.db.insert(knowledgeBases).values({ id: KB_OFF, tenantId: T, createdBy: U, name: 'OFF', slug: 'f200-off', language: 'da', contradictionLintEnabled: false }).run();

// AC: boolean round-trips.
const onVal = (await trail.db.select({ v: knowledgeBases.contradictionLintEnabled }).from(knowledgeBases).where(eq(knowledgeBases.id, KB_ON)).get())?.v;
const offVal = (await trail.db.select({ v: knowledgeBases.contradictionLintEnabled }).from(knowledgeBases).where(eq(knowledgeBases.id, KB_OFF)).get())?.v;
check('F200.1 default ON (true) + explicit OFF (false) round-trip', onVal === true && offVal === false, `on=${onVal} off=${offVal}`);

// Two FTS-similar, contradictory Neurons per KB (>=200 chars so the lint runs).
const A = 'Trail retains deleted Neurons in a recoverable state for thirty days before they are permanently purged from the engine volume. An administrator can restore any deleted Neuron within that thirty-day recovery window using the admin tools at any time.';
const B = 'When a Neuron is deleted in Trail it is purged immediately and irreversibly from the engine volume. There is no recovery window for a deleted Neuron and no administrator action can ever bring a deleted Neuron back once it has been removed.';
const mkNeuron = (id: string, kb: string, content: string) => ({
  id, tenantId: T, knowledgeBaseId: kb, userId: U, kind: 'wiki' as const,
  filename: `${id}.md`, path: '/neurons/', fileType: 'wiki', title: 'Neuron retention', content, status: 'ready' as const,
});
await trail.db.insert(documents).values([
  mkNeuron('on-a', KB_ON, A), mkNeuron('on-b', KB_ON, B),
  mkNeuron('off-a', KB_OFF, A), mkNeuron('off-b', KB_OFF, B),
]).run();
await trail.initFTS();

// STUB checker — always "contradicts", no LLM. Lets us test the GATE
// deterministically: if the scan proceeds past the toggle, a candidate lands.
const stub = async () => ({ contradicts: true, summary: 'stub' });

const countAlerts = async (kb: string) =>
  (await trail.db.select({ id: queueCandidates.id }).from(queueCandidates)
    .where(and(eq(queueCandidates.knowledgeBaseId, kb), eq(queueCandidates.kind, 'contradiction-alert'))).all()).length;

await scanDocForContradictions(trail, 'on-a', stub);
await scanDocForContradictions(trail, 'off-a', stub);
const onAlerts = await countAlerts(KB_ON);
const offAlerts = await countAlerts(KB_OFF);
check('F200.1 ENABLED KB emits contradiction-alert(s)', onAlerts >= 1, `on=${onAlerts}`);
check('F200.1 DISABLED KB emits ZERO (gate blocked the scan)', offAlerts === 0, `off=${offAlerts}`);

// ── F200.2 drain filter selectivity ─────────────────────────────────────
await trail.db.insert(queueCandidates).values([
  { id: 'lint-1', tenantId: T, knowledgeBaseId: KB_ON, kind: 'contradiction-alert', title: 'lint noise', content: 'x', status: 'pending', metadata: JSON.stringify({ connector: 'lint' }) },
  { id: 'know-1', tenantId: T, knowledgeBaseId: KB_ON, kind: 'chat-answer', title: 'real knowledge', content: 'y', status: 'pending', metadata: JSON.stringify({ connector: 'buddy' }) },
]).run();

// Replicate the endpoint's exact filter: pending + connector="lint".
const drainFilter = and(
  eq(queueCandidates.tenantId, T),
  eq(queueCandidates.status, 'pending'),
  like(queueCandidates.metadata, '%"connector":"lint"%'),
);
await trail.db.update(queueCandidates).set({ status: 'rejected', reviewedAt: sql`datetime('now')` }).where(drainFilter).run();

const lintStatus = (await trail.db.select({ s: queueCandidates.status }).from(queueCandidates).where(eq(queueCandidates.id, 'lint-1')).get())?.s;
const knowStatus = (await trail.db.select({ s: queueCandidates.status }).from(queueCandidates).where(eq(queueCandidates.id, 'know-1')).get())?.s;
check('F200.2 drain rejects the lint candidate', lintStatus === 'rejected', `lint=${lintStatus}`);
check('F200.2 drain LEAVES the knowledge candidate pending', knowStatus === 'pending', `knowledge=${knowStatus}`);

console.log(`\nscore: ${pass}/${pass + fail}`);
await trail.close();
process.exit(fail === 0 ? 0 : 1);
