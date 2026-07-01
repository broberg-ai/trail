/**
 * F199.10 — Mistral (EU, direct) ingest backend.
 *
 * Mirrors OpenRouterBackend's tool-loop exactly, but pins
 * `override:{provider:'mistral'}` instead of 'openrouter' — true EU
 * residency (api.mistral.ai) for the largest customer-data surface in
 * Trail (ingest sees the WHOLE source document), not a US transit via
 * OpenRouter. See docs/features/F199-ai-provider-exit-deanthropic.md and
 * F199.10's plan-doc for the empirical model-choice rationale.
 */

import { ai } from '../../lib/ai.js';
import type { Tool } from '@broberg/ai-sdk';
import type {
  IngestBackend,
  IngestBackendInput,
  IngestBackendResult,
} from './backend.js';
import type { CandidateQueueAPI } from '@trail/core';

const MAX_TOOL_RESPONSE_BYTES = 50_000;

type ChatMessages = NonNullable<Parameters<typeof ai.chat>[0]['messages']>;

export class MistralBackend implements IngestBackend {
  readonly id = 'mistral' as const;

  async run(input: IngestBackendInput): Promise<IngestBackendResult> {
    if (!input.candidateApi) {
      throw new Error('MistralBackend requires candidateApi in input (runner must pass it)');
    }
    // No per-tenant Mistral key yet — tenant_secrets only has openrouter/
    // anthropic columns. Always use the shared `ai` client (engine-level
    // MISTRAL_API_KEY), matching every other Mistral-migrated service
    // (chat, vision, contradiction-lint, etc.) in F199.
    const client = ai;

    const t0 = Date.now();
    const api = input.candidateApi;
    const tools = buildTools();
    const override = { provider: 'mistral', model: input.model, transport: 'http' as const };
    const labels = {
      tenantId: input.env.TRAIL_TENANT_ID ?? '',
      kbId: input.env.TRAIL_KNOWLEDGE_BASE_ID ?? '',
    };

    const messages: ChatMessages = [{ role: 'user', content: input.prompt }];

    let totalCostUsd = 0;
    let totalTurns = 0;
    let lastModel = input.model;
    const modelTrail: Array<{ turn: number; model: string }> = [];

    for (let turn = 1; turn <= input.maxTurns; turn++) {
      const elapsed = Date.now() - t0;
      if (elapsed > input.timeoutMs) {
        throw new Error(`mistral timed out after ${Math.round(elapsed / 1000)}s`);
      }

      const res = await client.chat({
        messages,
        tools,
        override,
        temperature: 0.3,
        maxTokens: 4096,
        purpose: 'ingest',
        labels,
      });

      totalTurns = turn;
      lastModel = res.usage.model || input.model;
      modelTrail.push({ turn, model: lastModel });
      totalCostUsd += res.usage.costUsd;

      const toolCalls = res.toolCalls;
      if (!toolCalls || toolCalls.length === 0) {
        break;
      }

      messages.push({ role: 'assistant', content: res.text ?? '', toolCalls });
      for (const tc of toolCalls) {
        let toolResult: string;
        try {
          toolResult = await dispatchTool(api, tc.name, tc.arguments);
        } catch (err) {
          toolResult = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (toolResult.length > MAX_TOOL_RESPONSE_BYTES) {
          toolResult = toolResult.slice(0, MAX_TOOL_RESPONSE_BYTES) + '\n\n[truncated at 50K chars]';
        }
        messages.push({ role: 'tool', toolCallId: tc.id, content: toolResult });
      }
    }

    return {
      turns: totalTurns,
      durationMs: Date.now() - t0,
      costCents: Math.round(totalCostUsd * 100),
      modelTrail,
    };
  }
}

// ── Tool dispatch (identical shape to OpenRouterBackend) ────────────────

async function dispatchTool(
  api: CandidateQueueAPI,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case 'guide': {
      const r = await api.guide();
      return formatGuide(r);
    }
    case 'search': {
      const r = await api.search({
        knowledge_base: typeof args.knowledge_base === 'string' ? args.knowledge_base : undefined,
        mode: args.mode === 'search' ? 'search' : 'list',
        query: typeof args.query === 'string' ? args.query : undefined,
        path: typeof args.path === 'string' ? args.path : '*',
        kind: args.kind === 'source' || args.kind === 'wiki' || args.kind === 'any' ? args.kind : 'any',
      });
      return formatSearch(r);
    }
    case 'read': {
      const path = typeof args.path === 'string' ? args.path : '';
      if (!path) return 'Error: path is required';
      const r = await api.read({
        knowledge_base: typeof args.knowledge_base === 'string' ? args.knowledge_base : undefined,
        path,
      });
      return formatRead(r);
    }
    case 'write': {
      const command = args.command as 'create' | 'str_replace' | 'append';
      if (command !== 'create' && command !== 'str_replace' && command !== 'append') {
        return `Error: unknown command "${String(command)}"; expected create|str_replace|append`;
      }
      const r = await api.write({
        knowledge_base: typeof args.knowledge_base === 'string' ? args.knowledge_base : undefined,
        command,
        path: typeof args.path === 'string' ? args.path : undefined,
        title: typeof args.title === 'string' ? args.title : undefined,
        content: typeof args.content === 'string' ? args.content : undefined,
        tags: typeof args.tags === 'string' ? args.tags : undefined,
        old_text: typeof args.old_text === 'string' ? args.old_text : undefined,
        new_text: typeof args.new_text === 'string' ? args.new_text : undefined,
      });
      return formatWrite(r);
    }
    default:
      return `Error: unknown tool "${name}" (expected guide|search|read|write)`;
  }
}

function formatGuide(r: Awaited<ReturnType<CandidateQueueAPI['guide']>>): string {
  let out = `# trail — How It Works\n\nThree layers:\n1. **Sources** (immutable raw inputs)\n2. **Wiki** at /neurons/ (compiled markdown + [[wiki-links]])\n3. **Schema** (conventions)\n\n## Tools\n- guide — this message\n- search — list or FTS a KB\n- read — fetch single doc or glob\n- write — create / str_replace / append wiki pages\n\n## Knowledge bases for ${r.tenantName}\n`;
  if (r.kbs.length === 0) {
    out += '\nNo knowledge bases yet.\n';
  } else {
    for (const kb of r.kbs) {
      out += `\n- **${kb.name}** (\`${kb.slug}\`) — ${kb.sourceCount} sources, ${kb.wikiPageCount} wiki pages`;
      if (kb.description) out += `\n  ${kb.description}`;
    }
  }
  return out;
}

function formatSearch(r: Awaited<ReturnType<CandidateQueueAPI['search']>>): string {
  if (!r.ok) {
    if (r.error === 'kb-not-found') return `KB "${r.kbInput ?? '(default)'}" not found.`;
    if (r.error === 'search-mode-requires-query') return 'Search query required for search mode.';
    return 'Unknown error';
  }
  if (r.mode === 'search') {
    let out = `## Search results for "${r.query}" in ${r.kbName}\n\n`;
    if (r.docs.length === 0 && r.chunks.length === 0) return out + 'No results found.\n';
    out += `### Documents (${r.docs.length})\n`;
    for (const d of r.docs) {
      const prefix = d.seqId ? `\`${d.seqId}\` ` : '';
      out += `- ${prefix}[${d.kind}] \`${d.path}${d.filename}\` — ${d.title ?? d.filename}\n`;
    }
    out += `\n### Chunks (${r.chunks.length})\n`;
    for (const c of r.chunks) {
      out += `- chunk #${c.chunkIndex}: ${c.content.slice(0, 200)}...\n`;
    }
    return out;
  }
  let out = `## ${r.kbName} — ${r.docs.length} documents\n\n`;
  for (const d of r.docs) {
    const icon = d.status === 'ready' ? '✓' : d.status === 'processing' ? '⏳' : '•';
    const prefix = d.seqId ? `\`${d.seqId}\` ` : '';
    out += `${icon} ${prefix}[${d.kind}] \`${d.path}${d.filename}\` — ${d.title ?? d.filename} (${d.fileType})\n`;
  }
  return out;
}

function formatRead(r: Awaited<ReturnType<CandidateQueueAPI['read']>>): string {
  if (!r.ok) {
    if (r.error === 'kb-not-found') return `KB "${r.kbInput ?? '(default)'}" not found.`;
    return `Document "${r.pathArg}" not found in ${r.kbName}.`;
  }
  if (r.kind === 'single') {
    const seqPrefix = r.doc.seqId ? `<!-- ${r.doc.seqId} -->\n` : '';
    return seqPrefix + (r.doc.content || '_No content_');
  }
  if (r.docs.length === 0) return 'No documents match.';
  let out = '';
  for (const d of r.docs) {
    const header = d.seqId ? `\n\n---\n## ${d.path}${d.filename}  \`${d.seqId}\`\n\n` : `\n\n---\n## ${d.path}${d.filename}\n\n`;
    out += header + (d.content || '_No content_');
  }
  if (r.truncatedAt !== null) {
    out += `\n\n---\n_Truncated: ${r.docs.length - r.truncatedAt} more documents not shown._\n`;
  }
  return out;
}

function formatWrite(r: Awaited<ReturnType<CandidateQueueAPI['write']>>): string {
  if (!r.ok) {
    switch (r.error) {
      case 'kb-not-found': return `KB "${r.kbInput ?? '(default)'}" not found.`;
      case 'title-required': return 'Title required for create.';
      case 'locate-failed': return `Error: ${r.hint}`;
      case 'old-text-not-found': return `old_text not found in ${r.target}.`;
      case 'old-text-ambiguous': return `old_text found ${r.occurrences} times in ${r.target} — must be unique. Add more surrounding context.`;
      case 'doc-not-found': return `Document "${r.target}" not found in ${r.kbName}.`;
      case 'missing-fields': return `Error: ${r.hint}`;
      case 'unknown-command': return `Unknown command: ${r.command}`;
    }
  }
  if (r.command === 'create') {
    return r.approved
      ? `Created \`${r.path}${r.filename}\` — "${r.title}"`
      : `Create queued for curator review.`;
  }
  if (r.command === 'str_replace' || r.command === 'append') {
    const verb = r.command === 'str_replace' ? 'Updated' : 'Appended to';
    return r.approved
      ? `${verb} \`${r.path}${r.filename}\` (v${r.newVersion})`
      : `${r.command === 'append' ? 'Append' : 'Update'} queued for curator review on ${r.path}${r.filename}.`;
  }
  return 'Write completed.';
}

function buildTools(): Tool[] {
  return [
    {
      name: 'guide',
      description: "List the tenant's knowledge bases and explain how trail works. Call this first when you're unsure which KB to write to.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'search',
      description: 'Browse or FTS-search documents in a knowledge base. Use mode="list" for a file-tree (default); mode="search" for keyword FTS.',
      parameters: {
        type: 'object',
        properties: {
          knowledge_base: { type: 'string', description: 'Name, slug, or id of the KB. Omit to use the active KB from context.' },
          mode: { type: 'string', enum: ['list', 'search'], description: 'list = file tree, search = FTS.' },
          query: { type: 'string', description: 'Search query (required for search mode).' },
          path: { type: 'string', description: 'Path filter glob (e.g. "/neurons/*").' },
          kind: { type: 'string', enum: ['source', 'wiki', 'any'], description: 'Filter by document kind.' },
        },
        required: [],
      },
    },
    {
      name: 'read',
      description: 'Read document content from a knowledge base. Accepts a single path or a glob (e.g. "/neurons/*.md"). For large files, a 120K-char cap applies.',
      parameters: {
        type: 'object',
        properties: {
          knowledge_base: { type: 'string', description: 'Name, slug, or id of the KB.' },
          path: { type: 'string', description: 'Full path (e.g. "/neurons/overview.md") or glob (e.g. "/neurons/*.md").' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write',
      description: 'Create or edit wiki pages via the Curation Queue. Supports create / str_replace / append.',
      parameters: {
        type: 'object',
        properties: {
          knowledge_base: { type: 'string', description: 'Name, slug, or id of the KB.' },
          command: { type: 'string', enum: ['create', 'str_replace', 'append'], description: 'create = new wiki page; str_replace = find/replace; append = add to end.' },
          path: { type: 'string', description: 'Directory path for create (default "/neurons/"). Ignored for str_replace/append — use `title` for the full doc path.' },
          title: { type: 'string', description: 'For create: the new page title. For str_replace/append: the full document path (e.g. "/neurons/overview.md").' },
          content: { type: 'string', description: 'Content for create or append.' },
          tags: { type: 'string', description: 'Comma-separated tags (create only).' },
          old_text: { type: 'string', description: 'Text to find (str_replace only).' },
          new_text: { type: 'string', description: 'Replacement text (str_replace only).' },
        },
        required: ['command'],
      },
    },
  ];
}
