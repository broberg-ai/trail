/**
 * F199.9 — does Mistral EU (mistral-direct) actually drive Trail's REAL ingest
 * tool-loop? Ingest is the largest customer-data surface (the model sees the
 * WHOLE source document) and today's registry/picker offers zero Mistral
 * option (only Gemini/GLM/Qwen/Claude — i.e. US + CN models for the riskiest
 * data path). This is the test-before-build step: prove Mistral small/large
 * can complete a real compile before touching the registry or any default.
 *
 * Faithful to production: seeds a temp DB (tenant/user/KB/source doc), calls
 * the REAL buildCompilePrompt() (tag/entity/schema/language-aware, identical
 * to what cloud-ingest and local-ingest both use) and the REAL
 * createCandidateQueueAPI() — so a successful write(create) lands an ACTUAL
 * auto-approved Neuron in `documents` (kind='ingest-summary' is a TRUSTED_KIND,
 * see packages/core/src/queue/policy.ts). The tool-loop itself mirrors
 * OpenRouterBackend's loop (services/ingest/openrouter-backend.ts) but
 * parameterizes `override.provider` so we can test 'mistral' direct (true EU
 * residency) instead of being locked to 'openrouter'.
 *
 * Run from apps/server: set -a; source ../../.env; set +a; bun run scripts/verify-f199-9-ingest-mistral.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  createLibsqlDatabase,
  tenants,
  users,
  knowledgeBases,
  documents,
  type TrailDatabase,
} from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { ai } from '../src/lib/ai.js';
import type { Tool } from '@broberg/ai-sdk';
import type { CandidateQueueAPI } from '@trail/core';
import { createCandidateQueueAPI } from '@trail/core';
import { buildCompilePrompt, type IngestJob } from '../src/services/ingest.js';

if (!process.env.MISTRAL_API_KEY) {
  console.error('✗ no MISTRAL_API_KEY in env — cannot runtime-verify');
  process.exit(1);
}

const T = 't-f199-9', U = 'u-f199-9';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f199-9-ingest-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail: TrailDatabase = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();

await trail.db.insert(tenants).values({ id: T, slug: 'f199-9', name: 'F199.9 ingest test', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f199-9@local.trail', displayName: 'F199.9', role: 'owner', onboarded: true }).run();

// A real-shaped, multi-fact Danish source — the kind of internal note Trail
// actually ingests (concrete facts the compiled Neuron must capture
// faithfully, not paraphrase loosely or drop).
const SOURCE_TEXT = `# Rejsepolitik — WebHouse interne retningslinjer

Denne note opsummerer rejsepolitikken for medarbejdere, gældende fra 1. januar 2026.

## Booking
Alle erhvervsrejser over 200 km skal bookes gennem det interne rejsebureau senest 5 hverdage
før afrejse. Rejser bestilt med kortere varsel kræver godkendelse fra nærmeste leder.

## Transportmidler
Tog er standard for rejser under 400 km. Fly er kun tilladt for rejser over 400 km eller når
togrejsen ville tage mere end 5 timer. Egen bil refunderes med statens lave takst.

## Overnatning
Hotelbudgettet er 1200 kr. per nat inklusive morgenmad. Højere udgift kræver forhåndsgodkendelse.

## Diæter
Diæter udbetales efter statens takster og kan ikke kombineres med firmakreditkort til måltider
samme dag.

## Refusion
Kvitteringer skal indsendes inden for 14 dage efter hjemkomst via expense-systemet. Sene
indsendelser kan afvises.`;

async function makeKb(kbId: string, label: string, docId: string) {
  await trail.db.insert(knowledgeBases).values({
    id: kbId, tenantId: T, createdBy: U, name: label, slug: kbId, language: 'da',
  }).run();
  await trail.db.insert(documents).values({
    id: docId, tenantId: T, knowledgeBaseId: kbId, userId: U, kind: 'source',
    filename: 'rejsepolitik.md', path: '/', fileType: 'text/markdown',
    title: 'Rejsepolitik', content: SOURCE_TEXT, status: 'ready',
  }).run();
}

// ── Tool defs + dispatch — mirrored from openrouter-backend.ts (not exported) ──
function buildTools(): Tool[] {
  return [
    { name: 'guide', description: "List the tenant's knowledge bases and explain how trail works.", parameters: { type: 'object', properties: {}, required: [] } },
    { name: 'search', description: 'Browse or FTS-search documents in a knowledge base.', parameters: { type: 'object', properties: { knowledge_base: { type: 'string' }, mode: { type: 'string', enum: ['list', 'search'] }, query: { type: 'string' }, path: { type: 'string' }, kind: { type: 'string', enum: ['source', 'wiki', 'any'] } }, required: [] } },
    { name: 'read', description: 'Read document content from a knowledge base.', parameters: { type: 'object', properties: { knowledge_base: { type: 'string' }, path: { type: 'string' } }, required: ['path'] } },
    { name: 'write', description: 'Create or edit wiki pages via the Curation Queue.', parameters: { type: 'object', properties: { knowledge_base: { type: 'string' }, command: { type: 'string', enum: ['create', 'str_replace', 'append'] }, path: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, tags: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['command'] } },
  ];
}

async function dispatchTool(api: CandidateQueueAPI, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'guide': { const r = await api.guide(); return JSON.stringify(r); }
    case 'search': { const r = await api.search({ knowledge_base: args.knowledge_base as string | undefined, mode: args.mode === 'search' ? 'search' : 'list', query: args.query as string | undefined, path: (args.path as string) ?? '*', kind: (args.kind as 'source' | 'wiki' | 'any') ?? 'any' }); return JSON.stringify(r).slice(0, 4000); }
    case 'read': { const path = args.path as string; if (!path) return 'Error: path required'; const r = await api.read({ knowledge_base: args.knowledge_base as string | undefined, path }); return JSON.stringify(r).slice(0, 8000); }
    case 'write': {
      const command = args.command as 'create' | 'str_replace' | 'append';
      if (!['create', 'str_replace', 'append'].includes(command)) return `Error: unknown command "${String(command)}"`;
      const r = await api.write({ knowledge_base: args.knowledge_base as string | undefined, command, path: args.path as string | undefined, title: args.title as string | undefined, content: args.content as string | undefined, tags: args.tags as string | undefined, old_text: args.old_text as string | undefined, new_text: args.new_text as string | undefined });
      return JSON.stringify(r);
    }
    default: return `Error: unknown tool "${name}"`;
  }
}

type ChatMessages = NonNullable<Parameters<typeof ai.chat>[0]['messages']>;

async function runIngestLoop(model: string, prompt: string, api: CandidateQueueAPI): Promise<{ turns: number; costUsd: number; createCalls: number; lastText: string }> {
  const tools = buildTools();
  const override = { provider: 'mistral', model, transport: 'http' as const };
  const messages: ChatMessages = [{ role: 'user', content: prompt }];
  let totalCostUsd = 0;
  let createCalls = 0;
  let lastText = '';
  const MAX_TURNS = 8;
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const res = await ai.chat({ messages, tools, override, temperature: 0.3, maxTokens: 4096, purpose: 'f199.9-ingest-verify' });
    totalCostUsd += res.usage.costUsd;
    lastText = res.text ?? '';
    const toolCalls = res.toolCalls;
    if (!toolCalls || toolCalls.length === 0) return { turns: turn, costUsd: totalCostUsd, createCalls, lastText };
    messages.push({ role: 'assistant', content: res.text ?? '', toolCalls });
    for (const tc of toolCalls) {
      if (tc.name === 'write' && tc.arguments.command === 'create') createCalls += 1;
      let toolResult: string;
      try { toolResult = await dispatchTool(api, tc.name, tc.arguments); }
      catch (err) { toolResult = `Tool error: ${err instanceof Error ? err.message : String(err)}`; }
      messages.push({ role: 'tool', toolCallId: tc.id, content: toolResult });
    }
  }
  return { turns: MAX_TURNS, costUsd: totalCostUsd, createCalls, lastText };
}

async function testModel(model: string) {
  const kbId = `kb-${model.replace(/[^a-z0-9]/g, '-')}`;
  const docId = `doc-${model.replace(/[^a-z0-9]/g, '-')}`;
  await makeKb(kbId, `F199.9 ${model}`, docId);

  const job: IngestJob = { trail, docId, kbId, tenantId: T, userId: U };
  const doc = await trail.db.select().from(documents).where(eq(documents.id, docId)).get();
  const kb = await trail.db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).get();
  if (!doc || !kb) throw new Error('seed failed');

  const prompt = await buildCompilePrompt(trail, job, doc, kb);
  const api = createCandidateQueueAPI({ trail, tenantId: T, tenantName: 'F199.9 ingest test', userId: U, connector: 'api', ingestJobId: null, defaultKbId: kbId });

  console.log(`\n=== ${model} ===`);
  const result = await runIngestLoop(model, prompt, api);
  console.log(`turns=${result.turns} costUsd=${result.costUsd.toFixed(6)} write(create) calls=${result.createCalls}`);

  const neurons = await trail.db.select({ title: documents.title, content: documents.content, filename: documents.filename })
    .from(documents)
    .where(and(eq(documents.knowledgeBaseId, kbId), eq(documents.kind, 'wiki')))
    .all();
  console.log(`Neurons auto-approved into documents: ${neurons.length}`);
  for (const n of neurons) {
    console.log(`\n--- ${n.filename} : "${n.title}" ---`);
    console.log(n.content?.slice(0, 900));
  }
  if (neurons.length === 0 && result.lastText) {
    console.log(`\n(no Neuron written — model's final text: ${result.lastText.slice(0, 300)})`);
  }
  return { model, ...result, neuronCount: neurons.length };
}

const small = await testModel('mistral-small-latest');
const large = await testModel('mistral-large-latest');

console.log('\n=== SUMMARY ===');
for (const r of [small, large]) {
  console.log(`${r.model}: turns=${r.turns} cost=$${r.costUsd.toFixed(6)} neurons=${r.neuronCount}`);
}

await trail.close();
process.exit(small.neuronCount > 0 || large.neuronCount > 0 ? 0 : 1);
