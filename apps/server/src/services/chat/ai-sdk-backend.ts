/**
 * F190.3 — chat backend on @broberg/ai-sdk. WIRED (live in runChat).
 *
 * Requires @broberg/ai-sdk ≥0.3.1, which serializes the tool-loop on both the
 * openai/openrouter path (0.3.0) and the anthropic-direct path (0.3.1, F8.7):
 * assistant `tool_calls`/`tool_use` blocks + `role:"tool"` → `tool_result`. Trail
 * flagged the original gap (intercom #2639). Tool-loop verified converging.
 *
 * Replaces the F159 claude-cli / openrouter / claude-api backends with ONE
 * backend that issues each turn via the shared `ai.chat()` client and runs the
 * MCP tool-loop with Trail's in-process `invokeTrailMcpTool` router. ai-sdk owns
 * provider failover (anthropic-direct → openrouter chain); Trail owns the
 * tool-execution loop — exactly the facade-vs-agent-runtime boundary ai-sdk drew
 * (intercom #2548).
 *
 * Non-streaming (chat route returns the full answer as JSON), so `ai.chat()`
 * suffices — no `ai.chatStream` dependency.
 */
import { ai } from '../../lib/ai.js';
import type { Tool, ChatResult } from '@broberg/ai-sdk';

// The exact message-array type ai.chat() accepts (schema-derived — stricter
// than the exported Message interface re: image byte types; chat is text-only).
type ChatMessages = NonNullable<Parameters<typeof ai.chat>[0]['messages']>;
import { invokeTrailMcpTool, mcpToolsToFunctionSpecs, type ToolContext } from './mcp-router.js';
import { tenants } from '@trail/db';
import { eq } from 'drizzle-orm';
import type { ChatBackend, ChatBackendId, ChatBackendInput, ChatBackendResult } from './backend.js';

// F199.1 — Chat flipped to Mistral (EU-direct) primary. Fallback is gemini-flash
// via OpenRouter — a NON-Anthropic safety net; the prior anthropic/claude-sonnet
// failover leg was removed so nothing silently falls back to Anthropic. The
// primary provider is env-reversible: CHAT_PROVIDER=anthropic + CHAT_MODEL=
// claude-haiku-4-5-20251001 restores the pre-F199 path. The primary model still
// honours input.model so a per-call modelOverride keeps working.
const CHAT_PRIMARY_PROVIDER = process.env.CHAT_PROVIDER ?? 'mistral';
const CHAT_FALLBACK = [
  { provider: 'openrouter', model: 'google/gemini-2.5-flash', transport: 'http' as const },
];

/** ai-sdk Tool[] from the trail MCP tool registry (prefixed names, JSON-schema
 *  params) — same definitions the OpenAI/OpenRouter path used. */
function toAiSdkTools(): Tool[] {
  return mcpToolsToFunctionSpecs().map((s) => ({
    name: s.function.name,
    description: s.function.description,
    parameters: s.function.parameters,
  }));
}

/** Map the actually-used route back onto the existing ChatBackendId enum so
 *  chat_turns.backend stamping keeps its meaning without a schema change. */
function providerToBackendId(provider: string, transport: string): ChatBackendId {
  if (transport === 'subprocess') return 'claude-cli';
  if (provider === 'anthropic') return 'claude-api';
  return 'openrouter';
}

export class AiSdkChatBackend implements ChatBackend {
  // Nominal id; the real route taken is reported via result.backendUsed.
  readonly id: ChatBackendId = 'claude-api';

  async run(input: ChatBackendInput): Promise<ChatBackendResult> {
    const t0 = Date.now();
    const ctx = await this.buildToolContext(input);
    const tools = toAiSdkTools();
    const primary = { provider: CHAT_PRIMARY_PROVIDER, model: input.model, transport: 'http' as const };

    const messages: ChatMessages = [
      ...input.history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: input.userMessage },
    ];

    let totalCostUsd = 0;
    let lastProvider = primary.provider;
    let lastModel = primary.model;
    let sawCost = false;

    for (let turn = 0; turn < input.maxTurns; turn++) {
      const res: ChatResult = await ai.chat({
        system: input.systemPrompt,
        messages,
        tools,
        override: primary,
        fallback: CHAT_FALLBACK,
        maxTokens: 2048,
        purpose: 'chat',
        labels: { tenantId: input.tenantId, kbId: input.knowledgeBaseId },
      });
      totalCostUsd += res.usage.costUsd;
      if (res.usage.costUsd > 0) sawCost = true;
      lastProvider = res.usage.provider;
      lastModel = res.usage.model;

      if (res.toolCalls && res.toolCalls.length > 0) {
        // Append the assistant's tool-call turn, then each tool result, and loop.
        messages.push({ role: 'assistant', content: res.text ?? '', toolCalls: res.toolCalls });
        for (const tc of res.toolCalls) {
          const result = await invokeTrailMcpTool(tc.name, tc.arguments, ctx);
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            content: result.content.map((c) => c.text).join('\n'),
          });
        }
        continue;
      }

      // Final answer. costCents NULL when every turn was $0 (subprocess/Max),
      // matching the pre-F190 claude-cli semantics for chat_turns.cost_cents.
      return {
        answer: res.text ?? '',
        costCents: sawCost ? Math.round(totalCostUsd * 100) : null,
        backendUsed: providerToBackendId(lastProvider, primary.transport),
        modelUsed: lastModel,
        stepsAttempted: 1,
        elapsedMs: Date.now() - t0,
      };
    }

    throw new Error(`AiSdkChatBackend exceeded maxTurns=${input.maxTurns} without final answer`);
  }

  private async buildToolContext(input: ChatBackendInput): Promise<ToolContext> {
    const tenant = await input.trail.db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .get();
    return {
      trail: input.trail,
      tenantId: input.tenantId,
      defaultKbId: input.knowledgeBaseId,
      tenantName: tenant?.name ?? 'unknown',
    };
  }
}
