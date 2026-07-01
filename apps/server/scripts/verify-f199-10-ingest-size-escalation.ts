/**
 * F199.10 — empirical validation: does mistral-small-latest actually LOSE
 * facts on a longer (5-10 page equivalent) source compared to
 * mistral-large-latest? Christian's exact worry: "vi skulle jo nødigt miste
 * gode neuroner" on bigger sources if we default everything to small.
 *
 * Builds a ~6-page-equivalent Danish source (10 sections, ~14k chars) with an
 * explicit FACT LEDGER of 30 distinct concrete facts embedded in the text.
 * After each model compiles it via the REAL ingest tool-loop (same harness as
 * verify-f199-9-ingest-mistral.ts), greps the produced Neurons against the
 * ledger and reports a HARD fact-recall percentage — not a subjective read.
 *
 * Run from apps/server: set -a; source ../../.env; set +a; bun run scripts/verify-f199-10-ingest-size-escalation.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, documents, type TrailDatabase } from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { ai } from '../src/lib/ai.js';
import type { Tool } from '@broberg/ai-sdk';
import type { CandidateQueueAPI } from '@trail/core';
import { createCandidateQueueAPI } from '@trail/core';
import { buildCompilePrompt, type IngestJob } from '../src/services/ingest.js';

if (!process.env.MISTRAL_API_KEY) {
  console.error('✗ no MISTRAL_API_KEY in env'); process.exit(1);
}

const T = 't-f199-10', U = 'u-f199-10';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f199-10-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }
const trail: TrailDatabase = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();
await trail.db.insert(tenants).values({ id: T, slug: 'f199-10', name: 'F199.10', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f199-10@local.trail', displayName: 'F199.10', role: 'owner', onboarded: true }).run();

// ── A ~6-page Danish source (10 sections) with 30 ledgered facts ──────────
const FACTS: Array<{ id: string; needle: string }> = [
  { id: 'F1', needle: '256-bit AES' }, { id: 'F2', needle: '90 dage' }, { id: 'F3', needle: 'to-faktor' },
  { id: 'F4', needle: '12 tegn' }, { id: 'F5', needle: 'YubiKey' }, { id: 'F6', needle: '5 forsøg' },
  { id: 'F7', needle: '15 minutter' }, { id: 'F8', needle: 'VPN' }, { id: 'F9', needle: 'WireGuard' },
  { id: 'F10', needle: 'split-tunneling' }, { id: 'F11', needle: '30 GB' }, { id: 'F12', needle: 'Tigris' },
  { id: 'F13', needle: '24 timer' }, { id: 'F14', needle: 'CISO' }, { id: 'F15', needle: '72 timer' },
  { id: 'F16', needle: 'Datatilsynet' }, { id: 'F17', needle: 'GDPR' }, { id: 'F18', needle: '6 år' },
  { id: 'F19', needle: 'krypteret backup' }, { id: 'F20', needle: '3 kopier' }, { id: 'F21', needle: 'Stockholm' },
  { id: 'F22', needle: 'patches' }, { id: 'F23', needle: '7 dage' }, { id: 'F24', needle: 'kritiske sårbarheder' },
  { id: 'F25', needle: 'penetrationstest' }, { id: 'F26', needle: 'årligt' }, { id: 'F27', needle: 'USB-porte' },
  { id: 'F28', needle: 'whitelisting' }, { id: 'F29', needle: 'phishing-test' }, { id: 'F30', needle: 'kvartalsvis' },
];

const SOURCE_TEXT = `# IT-sikkerhedspolitik — WebHouse

Denne politik beskriver de tekniske og organisatoriske sikkerhedskrav for alle medarbejdere
og systemer hos WebHouse, gældende fra 1. januar 2026.

## 1. Kryptering
Alle bærbare enheder skal have diskkryptering aktiveret med mindst 256-bit AES. Krypteringsnøgler
skal roteres hver 90 dage. Manglende kryptering på en enhed medfører øjeblikkelig inddragelse af
adgang til virksomhedens systemer.

## 2. Adgangskontrol
Alle medarbejdere skal bruge to-faktor-autentificering på samtlige interne systemer. Adgangskoder
skal være mindst 12 tegn lange og kan ikke genbruges fra de seneste 10 adgangskoder. Administratorer
skal bruge en fysisk YubiKey som anden faktor. Efter 5 forsøg med forkert adgangskode låses kontoen
i 15 minutter.

## 3. Fjernadgang
Fjernadgang til interne systemer sker udelukkende via VPN baseret på WireGuard-protokollen.
Split-tunneling er ikke tilladt — al trafik routes gennem virksomhedens netværk. Forbindelser der
er inaktive i mere end 8 timer afbrydes automatisk.

## 4. Datalagring
Kundedata må maksimalt fylde 30 GB pr. tenant uden forudgående godkendelse fra IT-ledelsen.
Alt cloud-lager skal ligge hos Tigris (S3-kompatibelt, EU-hosted). Data må ikke kopieres til
lokale drev uden eksplicit undtagelse godkendt af CISO.

## 5. Hændelseshåndtering
Sikkerhedshændelser skal rapporteres til CISO inden for 24 timer efter opdagelse. Hvis hændelsen
involverer persondata, skal Datatilsynet underrettes inden for 72 timer i henhold til GDPR-reglerne.
En intern hændelsesrapport skal udarbejdes inden for en uge.

## 6. Logning og opbevaring
Adgangslogs og sikkerhedslogs skal opbevares i mindst 6 år af hensyn til revision og compliance.
Logs skal gemmes som krypteret backup med mindst 3 kopier, geografisk adskilt — én kopi skal
ligge i en anden region end produktionen (typisk Stockholm).

## 7. Patch-håndtering
Sikkerhedsopdateringer (patches) skal installeres senest 7 dage efter udgivelse for almindelige
opdateringer. Kritiske sårbarheder med aktiv udnyttelse i naturen skal patches inden for 24 timer.

## 8. Test og audit
Der gennemføres en ekstern penetrationstest årligt af en uafhængig sikkerhedsleverandør. Resultater
gennemgås af ledelsen og kritiske fund skal udbedres inden 30 dage.

## 9. Fysisk og perifer sikkerhed
USB-porte på alle virksomhedsenheder er som udgangspunkt deaktiveret. Tilladte USB-enheder styres
via en whitelisting-mekanisme administreret af IT. Undtagelser kræver skriftlig godkendelse.

## 10. Awareness og træning
Alle medarbejdere modtager en intern phishing-test kvartalsvis. Medarbejdere der klikker på en
test-phishing-mail skal gennemføre et obligatorisk sikkerhedskursus inden for 14 dage.`;

console.log(`Source: ${SOURCE_TEXT.length} chars, ~${Math.round(SOURCE_TEXT.length / 2500)} page-equivalents, ${FACTS.length} ledgered facts.\n`);

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
    const res = await ai.chat({ messages, tools, override, temperature: 0.3, maxTokens: 4096, purpose: 'f199.10-verify' });
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

async function testModel(model: string) {
  const kbId = `kb-${model.replace(/[^a-z0-9]/g, '-')}`;
  const docId = `doc-${model.replace(/[^a-z0-9]/g, '-')}`;
  await trail.db.insert(knowledgeBases).values({ id: kbId, tenantId: T, createdBy: U, name: model, slug: kbId, language: 'da' }).run();
  await trail.db.insert(documents).values({ id: docId, tenantId: T, knowledgeBaseId: kbId, userId: U, kind: 'source', filename: 'it-sikkerhedspolitik.md', path: '/', fileType: 'text/markdown', fileSize: SOURCE_TEXT.length, title: 'IT-sikkerhedspolitik', content: SOURCE_TEXT, status: 'ready' }).run();

  const job: IngestJob = { trail, docId, kbId, tenantId: T, userId: U };
  const doc = await trail.db.select().from(documents).where(eq(documents.id, docId)).get();
  const kb = await trail.db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).get();
  if (!doc || !kb) throw new Error('seed failed');
  const prompt = await buildCompilePrompt(trail, job, doc, kb);
  const api = createCandidateQueueAPI({ trail, tenantId: T, tenantName: 'F199.10', userId: U, connector: 'api', ingestJobId: null, defaultKbId: kbId });

  console.log(`=== ${model} ===`);
  const result = await runIngestLoop(model, prompt, api, 20);
  const neurons = await trail.db.select({ title: documents.title, content: documents.content, filename: documents.filename })
    .from(documents).where(and(eq(documents.knowledgeBaseId, kbId), eq(documents.kind, 'wiki'))).all();
  const allContent = neurons.map((n) => n.content ?? '').join('\n\n');
  const found = FACTS.filter((f) => allContent.includes(f.needle));
  const missing = FACTS.filter((f) => !allContent.includes(f.needle));
  console.log(`turns=${result.turns} cost=$${result.costUsd.toFixed(6)} neurons=${neurons.length}`);
  console.log(`fact recall: ${found.length}/${FACTS.length} (${Math.round((found.length / FACTS.length) * 100)}%)`);
  if (missing.length > 0) console.log(`MISSING: ${missing.map((m) => `${m.id}(${m.needle})`).join(', ')}`);
  console.log('');
  return { model, turns: result.turns, costUsd: result.costUsd, neuronCount: neurons.length, recall: found.length, missing: missing.map((m) => m.id) };
}

const small = await testModel('mistral-small-latest');
const large = await testModel('mistral-large-latest');

console.log('=== SUMMARY ===');
for (const r of [small, large]) {
  console.log(`${r.model}: turns=${r.turns} cost=$${r.costUsd.toFixed(6)} neurons=${r.neuronCount} recall=${r.recall}/${FACTS.length} missing=[${r.missing.join(',')}]`);
}

await trail.close();
process.exit(0);
