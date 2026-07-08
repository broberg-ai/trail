/**
 * F202.1 — reusable ingest-model comparison runner.
 *
 * Design principle (Christian, 2026-07-08): mirror the PRODUCTION ingest setup
 * 100% — same buildCompilePrompt, same createCandidateQueueAPI, same tool-loop,
 * same @broberg/ai-sdk routing — with the SINGLE deviation that it runs against
 * an artificial/ephemeral KB (a throwaway temp libSQL DB), NOT a real cloud KB
 * and never writing Neurons into a customer tenant.
 *
 * Parity is guaranteed by calling the REAL backend classes (MistralBackend /
 * OpenRouterBackend) — NOT a re-implemented tool loop. The loop that walks the
 * document + dispatches guide/search/read/write lives in ONE place (the
 * production backend), so the lab can never drift from prod behaviour.
 *
 * No CLI — cc is the interface. Call runIngestComparison() directly (e.g. from
 * scripts/model-eval.ts or inline) when a comparison is requested.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createLibsqlDatabase,
  tenants,
  users,
  knowledgeBases,
  documents,
  type TrailDatabase,
} from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { createCandidateQueueAPI } from '@trail/core';
import { buildCompilePrompt, type IngestJob } from '../ingest.js';
import { MistralBackend } from '../ingest/mistral-backend.js';
import { OpenRouterBackend } from '../ingest/openrouter-backend.js';
import type { IngestBackend, IngestBackendInput } from '../ingest/backend.js';
import { resolveModels, type EvalModel } from './models.js';
import { scoreRecall, type Fact, type RecallResult } from './recall.js';
import { openEvalStore, insertEvalRun, DEFAULT_EVAL_DB } from './store.js';

export interface ComparisonOptions {
  /** Raw source text (the whole document the models compile). */
  source: string;
  /** Filename label for the seeded source doc + persisted rows. */
  sourceName?: string;
  /** 'all' (INGEST_MODELS minus claude-cli + lab extras) or a selected id list. */
  models: 'all' | string[];
  /** Optional fact ledger for grep-recall; omit to skip recall scoring. */
  facts?: Fact[];
  /** Per-model turn budget (matches production ingest). Default 30. */
  maxTurns?: number;
  /** Per-model wall-clock kill switch. Default 20 min. */
  timeoutMs?: number;
  /** KB language passed to buildCompilePrompt. Default 'da'. */
  language?: string;
  /** Persist results to model-lab.db. Default true. */
  persist?: boolean;
  /** Override the eval store path (tests point this at a throwaway file). */
  storePath?: string;
}

export interface ComparisonResult {
  model: string;
  backend: string;
  euSafe: boolean;
  neurons: number;
  turns: number;
  costUsd: number; // cent-rounded (production tracks ingest cost in cents)
  durationMs: number;
  recall: RecallResult | null;
  failed: boolean;
  error?: string;
}

function backendFor(m: EvalModel): IngestBackend {
  switch (m.backend) {
    case 'mistral':
      return new MistralBackend();
    case 'openrouter':
      return new OpenRouterBackend();
    default:
      throw new Error(`backend "${m.backend}" (model ${m.id}) is not runnable in the in-process lab`);
  }
}

async function runOne(
  trail: TrailDatabase,
  tenantId: string,
  userId: string,
  m: EvalModel,
  opts: Required<Pick<ComparisonOptions, 'source' | 'sourceName' | 'language' | 'maxTurns' | 'timeoutMs'>>,
  facts: Fact[] | undefined,
): Promise<ComparisonResult> {
  const safe = m.id.replace(/[^a-z0-9]/gi, '-');
  const kbId = `kb-${safe}`;
  const docId = `doc-${safe}`;

  await trail.db
    .insert(knowledgeBases)
    .values({ id: kbId, tenantId, createdBy: userId, name: m.id, slug: kbId, language: opts.language })
    .run();
  await trail.db
    .insert(documents)
    .values({
      id: docId,
      tenantId,
      knowledgeBaseId: kbId,
      userId,
      kind: 'source',
      filename: opts.sourceName,
      path: '/',
      fileType: 'md',
      fileSize: opts.source.length,
      title: opts.sourceName,
      content: opts.source,
      status: 'ready',
    })
    .run();

  const job: IngestJob = { trail, docId, kbId, tenantId, userId };
  const doc = await trail.db.select().from(documents).where(eq(documents.id, docId)).get();
  const kb = await trail.db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).get();
  if (!doc || !kb) throw new Error('seed failed');

  const prompt = await buildCompilePrompt(trail, job, doc, kb);
  const api = createCandidateQueueAPI({
    trail,
    tenantId,
    tenantName: 'Eval',
    userId,
    connector: 'api',
    ingestJobId: null,
    defaultKbId: kbId,
  });

  const input: IngestBackendInput = {
    prompt,
    tools: [], // in-process backends ignore this (MCP-tool-name list is for claude-cli)
    mcpConfigPath: '', // ditto — mistral/openrouter dispatch to candidateApi directly
    model: m.id,
    maxTurns: opts.maxTurns,
    timeoutMs: opts.timeoutMs,
    env: {
      TRAIL_TENANT_ID: tenantId,
      TRAIL_USER_ID: userId,
      TRAIL_KNOWLEDGE_BASE_ID: kbId,
      TRAIL_DATA_DIR: '',
      TRAIL_CONNECTOR: 'api',
      TRAIL_INGEST_JOB_ID: '',
    },
    candidateApi: api,
  };

  try {
    const r = await backendFor(m).run(input);
    const neurons = await trail.db
      .select({ content: documents.content })
      .from(documents)
      .where(and(eq(documents.knowledgeBaseId, kbId), eq(documents.kind, 'wiki')))
      .all();
    const blob = neurons.map((n) => n.content ?? '').join('\n\n');
    const recall = facts && facts.length ? scoreRecall(blob, facts) : null;
    return {
      model: m.id,
      backend: m.backend,
      euSafe: m.euSafe,
      neurons: neurons.length,
      turns: r.turns,
      costUsd: r.costCents / 100,
      durationMs: r.durationMs,
      recall,
      failed: false,
    };
  } catch (err) {
    return {
      model: m.id,
      backend: m.backend,
      euSafe: m.euSafe,
      neurons: 0,
      turns: 0,
      costUsd: 0,
      durationMs: 0,
      recall: facts && facts.length ? { total: facts.length, found: 0, foundIds: [], missingIds: facts.map((f) => f.id) } : null,
      failed: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run every resolved model against the SAME source through the real ingest
 * pipeline, score recall, and (by default) persist each result to model-lab.db.
 * Returns one ComparisonResult per model, in resolution order.
 */
export async function runIngestComparison(opts: ComparisonOptions): Promise<ComparisonResult[]> {
  const modelsList = resolveModels(opts.models);
  const filled = {
    source: opts.source,
    sourceName: opts.sourceName ?? 'source.md',
    language: opts.language ?? 'da',
    maxTurns: opts.maxTurns ?? 30,
    timeoutMs: opts.timeoutMs ?? 20 * 60_000,
  };

  const dbPath = join(process.env.TMPDIR ?? '/tmp', `model-eval-${process.pid}.db`);
  rmSync(dbPath, { force: true });
  const trail: TrailDatabase = await createLibsqlDatabase({ path: dbPath });
  await trail.runMigrations();
  await trail.initFTS();

  const T = 't-eval';
  const U = 'u-eval';
  await trail.db.insert(tenants).values({ id: T, slug: 'eval', name: 'Eval', plan: 'hobby' }).run();
  await trail.db
    .insert(users)
    .values({ id: U, tenantId: T, email: 'eval@local.trail', displayName: 'Eval', role: 'owner', onboarded: true })
    .run();

  const persist = opts.persist !== false;
  const store = persist ? openEvalStore(opts.storePath ?? DEFAULT_EVAL_DB) : null;
  const ranAt = new Date().toISOString();

  const results: ComparisonResult[] = [];
  for (const m of modelsList) {
    const res = await runOne(trail, T, U, m, filled, opts.facts);
    results.push(res);
    if (store) {
      insertEvalRun(store, {
        id: crypto.randomUUID(),
        ranAt,
        source: filled.sourceName,
        sourceChars: filled.source.length,
        model: res.model,
        backend: res.backend,
        euSafe: res.euSafe ? 1 : 0,
        recallFound: res.recall ? res.recall.found : null,
        recallTotal: res.recall ? res.recall.total : null,
        costUsd: res.costUsd,
        durationMs: res.durationMs,
        neurons: res.neurons,
        turns: res.turns,
        failed: res.failed ? 1 : 0,
        error: res.error ?? null,
        missingIds: res.recall ? JSON.stringify(res.recall.missingIds) : null,
      });
    }
  }

  store?.close();
  await trail.close();
  rmSync(dbPath, { force: true });
  return results;
}

/** Pretty one-line-per-model summary for terminal output. */
export function formatComparison(results: ComparisonResult[]): string {
  return results
    .map((r) => {
      const recall = r.recall ? `recall=${r.recall.found}/${r.recall.total}` : 'recall=—';
      const tag = r.failed ? 'FAILED' : r.euSafe ? 'EU ✓' : 'non-EU';
      return `${r.model.padEnd(34)} ${recall.padEnd(14)} cost=$${r.costUsd.toFixed(4)}  ${(r.durationMs / 1000).toFixed(1)}s  neurons=${r.neurons}  turns=${r.turns}  ${r.failed ? `FAILED (${r.error ?? ''})` : tag}`;
    })
    .join('\n');
}
