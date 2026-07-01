/**
 * F199.10 — retry of mistral-large-latest ALONE on the real Sanne excerpt
 * (10c's large leg crashed twice on a transient ECONNRESET, not a model
 * issue). Reuses the exact same excerpt + fact ledger as verify-f199-10c.
 */
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, documents, type TrailDatabase } from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { ai } from '../src/lib/ai.js';
import type { Tool } from '@broberg/ai-sdk';
import type { CandidateQueueAPI } from '@trail/core';
import { createCandidateQueueAPI } from '@trail/core';
import { buildCompilePrompt, type IngestJob } from '../src/services/ingest.js';

if (!process.env.MISTRAL_API_KEY) { console.error('✗ no MISTRAL_API_KEY in env'); process.exit(1); }

const SOURCE_TEXT = readFileSync(
  '/private/tmp/claude-501/-Users-cb-Apps-broberg-trail/e2438f44-1c90-43c2-9ebe-f022244ac7c8/scratchpad/zoneterapibogen-15p.txt',
  'utf8',
);
const T = 't-f199-10c-r', U = 'u-f199-10c-r';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f199-10c-r-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }
const trail: TrailDatabase = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();
await trail.db.insert(tenants).values({ id: T, slug: 'f199-10c-r', name: 'F199.10c-retry', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f199-10c-r@local.trail', displayName: 'F199.10c-r', role: 'owner', onboarded: true }).run();

const FACTS: Array<{ id: string; needle: string }> = [
  { id: 'F1', needle: 'Fodsved' }, { id: 'F2', needle: 'Ligtorne' }, { id: 'F3', needle: 'Opsvulmede fødder' },
  { id: 'F4', needle: 'Vorter' }, { id: 'F5', needle: 'Kolde fødder' }, { id: 'F6', needle: 'nyre-energi' },
  { id: 'F7', needle: 'Skæl' }, { id: 'F8', needle: 'Spændt hud' }, { id: 'F9', needle: 'akupunkturpunkter' },
  { id: 'F10', needle: 'Åbnere' }, { id: 'F11', needle: 'milt-, mave-, nyre- og blæremeridianerne' },
  { id: 'F12', needle: 'Blære 60' }, { id: 'F13', needle: 'Nyre 3' }, { id: 'F14', needle: 'Mave 36' },
  { id: 'F15', needle: 'MP9' }, { id: 'F16', needle: 'MP6' }, { id: 'F17', needle: 'Pigepunktet' },
  { id: 'F18', needle: 'Behandles ikke ved gravide' }, { id: 'F19', needle: 'menstruationsbesvær' },
  { id: 'F20', needle: 'impotens' }, { id: 'F21', needle: 'hoste og astma' }, { id: 'F22', needle: 'vanskelige fødsler' },
  { id: 'F23', needle: 'Achillessenen' }, { id: 'F24', needle: 'gastrocnemicus' }, { id: 'F25', needle: 'skinnebens-condylus' },
];

function buildTools(): Tool[] {
  return [
    { name: 'guide', description: "List KBs.", parameters: { type: 'object', properties: {}, required: [] } },
    { name: 'search', description: 'Browse/search a KB.', parameters: { type: 'object', properties: { knowledge_base: { type: 'string' }, mode: { type: 'string', enum: ['list', 'search'] }, query: { type: 'string' }, path: { type: 'string' }, kind: { type: 'string', enum: ['source', 'wiki', 'any'] } }, required: [] } },
    { name: 'read', description: 'Read document content.', parameters: { type: 'object', properties: { knowledge_base: { type: 'string' }, path: { type: 'string' } }, required: ['path'] } },
    { name: 'write', description: 'Create/edit wiki pages.', parameters: { type: 'object', properties: { knowledge_base: { type: 'string' }, command: { type: 'string', enum: ['create', 'str_replace', 'append'] }, path: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, tags: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['command'] } },
  ];
}
async function dispatchTool(api: CandidateQueueAPI, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'guide': return JSON.stringify(await api.guide());
    case 'search': return JSON.stringify(await api.search({ knowledge_base: args.knowledge_base as string | undefined, mode: args.mode === 'search' ? 'search' : 'list', query: args.query as string | undefined, path: (args.path as string) ?? '*', kind: (args.kind as 'source' | 'wiki' | 'any') ?? 'any' })).slice(0, 4000);
    case 'read': { const path = args.path as string; if (!path) return 'Error: path required'; return JSON.stringify(await api.read({ knowledge_base: args.knowledge_base as string | undefined, path })).slice(0, 8000); }
    case 'write': {
      const command = args.command as 'create' | 'str_replace' | 'append';
      if (!['create', 'str_replace', 'append'].includes(command)) return `Error: unknown command`;
      return JSON.stringify(await api.write({ knowledge_base: args.knowledge_base as string | undefined, command, path: args.path as string | undefined, title: args.title as string | undefined, content: args.content as string | undefined, tags: args.tags as string | undefined, old_text: args.old_text as string | undefined, new_text: args.new_text as string | undefined }));
    }
    default: return `Error: unknown tool "${name}"`;
  }
}
type ChatMessages = NonNullable<Parameters<typeof ai.chat>[0]['messages']>;

async function runIngestLoop(model: string, prompt: string, api: CandidateQueueAPI, maxTurns: number) {
  const tools = buildTools();
  const override = { provider: 'mistral', model, transport: 'http' as const };
  const messages: ChatMessages = [{ role: 'user', content: prompt }];
  let totalCostUsd = 0;
  for (let turn = 1; turn <= maxTurns; turn++) {
    let res;
    // Retry once on transient network error (ECONNRESET etc) — the failure
    // mode observed twice on this exact endpoint was a socket reset, not a
    // model/logic error.
    try {
      res = await ai.chat({ messages, tools, override, temperature: 0.3, maxTokens: 4096, purpose: 'f199.10c-retry' });
    } catch (err) {
      console.log(`  (turn ${turn} network error, retrying once: ${err instanceof Error ? err.message : err})`);
      await new Promise((r) => setTimeout(r, 2000));
      res = await ai.chat({ messages, tools, override, temperature: 0.3, maxTokens: 4096, purpose: 'f199.10c-retry' });
    }
    totalCostUsd += res.usage.costUsd;
    const toolCalls = res.toolCalls;
    if (!toolCalls || toolCalls.length === 0) return { turns: turn, costUsd: totalCostUsd };
    messages.push({ role: 'assistant', content: res.text ?? '', toolCalls });
    for (const tc of toolCalls) {
      let toolResult: string;
      try { toolResult = await dispatchTool(api, tc.name, tc.arguments); }
      catch (err) { toolResult = `Tool error: ${err instanceof Error ? err.message : String(err)}`; }
      messages.push({ role: 'tool', toolCallId: tc.id, content: toolResult });
    }
  }
  return { turns: maxTurns, costUsd: totalCostUsd };
}

const model = 'mistral-large-latest';
const kbId = 'kb-retry-large';
const docId = 'doc-retry-large';
await trail.db.insert(knowledgeBases).values({ id: kbId, tenantId: T, createdBy: U, name: model, slug: kbId, language: 'da' }).run();
await trail.db.insert(documents).values({ id: docId, tenantId: T, knowledgeBaseId: kbId, userId: U, kind: 'source', filename: 'zoneterapibogen-excerpt.md', path: '/', fileType: 'pdf', fileSize: SOURCE_TEXT.length, title: 'Zoneterapibogen (uddrag s.30-44)', content: SOURCE_TEXT, status: 'ready' }).run();
const job: IngestJob = { trail, docId, kbId, tenantId: T, userId: U };
const doc = await trail.db.select().from(documents).where(eq(documents.id, docId)).get();
const kb = await trail.db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).get();
if (!doc || !kb) throw new Error('seed failed');
const prompt = await buildCompilePrompt(trail, job, doc, kb);
const api = createCandidateQueueAPI({ trail, tenantId: T, tenantName: 'F199.10c-retry', userId: U, connector: 'api', ingestJobId: null, defaultKbId: kbId });

console.log(`=== ${model} (retry) ===`);
const result = await runIngestLoop(model, prompt, api, 30);
const neurons = await trail.db.select({ title: documents.title, content: documents.content, filename: documents.filename })
  .from(documents).where(and(eq(documents.knowledgeBaseId, kbId), eq(documents.kind, 'wiki'))).all();
const allContent = neurons.map((n) => n.content ?? '').join('\n\n');
const found = FACTS.filter((f) => allContent.includes(f.needle));
const missing = FACTS.filter((f) => !allContent.includes(f.needle));
console.log(`turns=${result.turns} cost=$${result.costUsd.toFixed(6)} neurons=${neurons.length}`);
console.log(`fact recall: ${found.length}/${FACTS.length} (${Math.round((found.length / FACTS.length) * 100)}%)`);
if (missing.length > 0) console.log(`MISSING: ${missing.map((m) => `${m.id}(${m.needle})`).join(', ')}`);

await trail.close();
process.exit(0);
