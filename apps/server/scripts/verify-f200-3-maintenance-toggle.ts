/**
 * F200.3 runtime proof (RED test) against a fresh temp DB.
 *
 *   - migration 0062 adds maintenance_lint_enabled; raw SQL round-trips 0 and 1;
 *   - the SCHEDULED lint pass (runLintPassForKb) emits stale findings for a KB
 *     with the toggle ON and ZERO for a KB with it OFF — same stale Neurons;
 *   - PATCH lint-settings with one field leaves the other untouched.
 *
 * Run from apps/server:  bun run scripts/verify-f200-3-maintenance-toggle.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, documents, queueCandidates, sessions } from '@trail/db';
import { createApp } from '../src/app.js';
import { and, eq } from 'drizzle-orm';

process.env.TRAIL_LINT_SKIP_CONTRADICTIONS = '1'; // no LLM in this probe
const { runLintPassForKb } = await import('../src/services/lint-scheduler.js');

const T = 't-f2003', U = 'u-f2003', KB_ON = 'kb-f2003-on', KB_OFF = 'kb-f2003-off';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f200-3-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// AC1 — column exists and round-trips through RAW SQL (not the ORM that wrote it).
const cols = (await trail.execute("SELECT name FROM pragma_table_info('knowledge_bases')")).rows.map((r) => r.name);
check('migration: maintenance_lint_enabled column present', cols.includes('maintenance_lint_enabled'));

await trail.db.insert(tenants).values({ id: T, slug: 'f2003', name: 'F200.3', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f2003@local.trail', displayName: 'F200.3', role: 'owner', onboarded: true }).run();
await trail.db.insert(knowledgeBases).values({ id: KB_ON, tenantId: T, createdBy: U, name: 'ON', slug: 'f2003-on', language: 'da' }).run();
await trail.db.insert(knowledgeBases).values({ id: KB_OFF, tenantId: T, createdBy: U, name: 'OFF', slug: 'f2003-off', language: 'da' }).run();
await trail.client.execute({ sql: 'UPDATE knowledge_bases SET maintenance_lint_enabled = 0 WHERE id = ?', args: [KB_OFF] });

const raw = async (id: string) =>
  (await trail.client.execute({ sql: 'SELECT maintenance_lint_enabled AS v FROM knowledge_bases WHERE id = ?', args: [id] })).rows[0]?.v;
const rOn = await raw(KB_ON), rOff = await raw(KB_OFF);
check('raw SQL: default 1, explicit 0', Number(rOn) === 1 && Number(rOff) === 0, `on=${rOn} off=${rOff}`);

// AC2 — same stale Neurons in both KBs (updated 200 days ago, past the 90-day default).
const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
const mk = (id: string, kb: string) => ({
  id, tenantId: T, knowledgeBaseId: kb, userId: U, kind: 'wiki' as const,
  filename: `${id}.md`, path: '/neurons/', fileType: 'wiki', title: `Old note ${id}`,
  content: 'An old session note that nobody has edited since it was written.', status: 'ready' as const,
  createdAt: old, updatedAt: old,
});
await trail.db.insert(documents).values([mk('on-1', KB_ON), mk('on-2', KB_ON), mk('off-1', KB_OFF), mk('off-2', KB_OFF)]).run();

const kbRow = async (id: string) => {
  const r = await trail.db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id)).get();
  return { id, tenantId: T, name: r!.name, lintScheduleDays: r!.lintScheduleDays, maintenanceLintEnabled: r!.maintenanceLintEnabled, createdAt: r!.createdAt };
};
await runLintPassForKb(trail, await kbRow(KB_ON), 'scheduled');
await runLintPassForKb(trail, await kbRow(KB_OFF), 'scheduled');

const count = async (kb: string) =>
  (await trail.db.select({ id: queueCandidates.id }).from(queueCandidates)
    .where(and(eq(queueCandidates.knowledgeBaseId, kb), eq(queueCandidates.kind, 'gap-detection'))).all()).length;
const nOn = await count(KB_ON), nOff = await count(KB_OFF);
check('scheduled pass, toggle ON: stale findings emitted', nOn >= 2, `on=${nOn}`);
check('scheduled pass, toggle OFF: ZERO findings', nOff === 0, `off=${nOff}`);

// AC3 — PATCH one field, the other stays; GET returns both. Exercises the real route.
await trail.db.insert(sessions).values({ id: 'sess-f2003', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();
const app = createApp(trail, new Map([['f2003', trail]]));
const call = (method: string, body?: unknown) =>
  app.request(`http://engine.local/api/v1/knowledge-bases/f2003-on/lint-settings`, {
    method, headers: { 'Content-Type': 'application/json', Cookie: 'session=sess-f2003' }, body: body ? JSON.stringify(body) : undefined,
  });

const p1 = await call('PATCH', { maintenanceLintEnabled: false });
const g1 = (await (await call('GET')).json()) as Record<string, unknown>;
check('PATCH maintenance only → contradiction untouched', p1.status === 200 && g1.maintenanceLintEnabled === false && g1.contradictionLintEnabled === true, JSON.stringify(g1));
const p2 = await call('PATCH', { contradictionLintEnabled: false });
const g2 = (await (await call('GET')).json()) as Record<string, unknown>;
check('PATCH contradiction only → maintenance untouched', p2.status === 200 && g2.maintenanceLintEnabled === false && g2.contradictionLintEnabled === false, JSON.stringify(g2));
const p3 = await call('PATCH', {});
check('PATCH with no field → 400', p3.status === 400, `status=${p3.status}`);

console.log(`\nscore: ${pass}/${pass + fail}`);
await trail.close();
process.exit(fail === 0 ? 0 : 1);
