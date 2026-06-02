/**
 * F159 — Chat backend factory + runChat() orchestrator.
 *
 * Phase 1 ships only the Claude CLI backend; Phase 2 adds OpenRouter
 * + Claude-API. The factory is dynamic-import-based so the AWS-style
 * SDK lift for OpenRouter doesn't enter the cold-boot path until a
 * tenant actually requests that backend.
 *
 * `runChat()` is the route's single entry point. Phase 1: single-step
 * chain, no fallback (matches pre-F159 behaviour exactly). Phase 2
 * adds the chain-fallback loop on `isFallbackEligible` errors.
 */

import { ClaudeCLIChatBackend } from './claude-cli-backend.js';
import { AiSdkChatBackend } from './ai-sdk-backend.js';
import { resolveChatChain, DEFAULT_CHAT_MODEL, type ChainResolutionInput } from './chain.js';
import type {
  ChatBackend,
  ChatBackendId,
  ChatBackendInput,
  ChatBackendResult,
} from './backend.js';

export type { ChatBackend, ChatBackendId, ChatBackendInput, ChatBackendResult } from './backend.js';
export type { ChainStep, ChainResolutionInput } from './chain.js';
export { resolveChatChain, DEFAULT_CHAT_MODEL } from './chain.js';
export { buildSystemPrompt, buildCliPrompt, type PriorTurn } from './build-prompt.js';

export async function createChatBackend(id: ChatBackendId): Promise<ChatBackend> {
  switch (id) {
    case 'claude-cli':
      return new ClaudeCLIChatBackend();
    case 'openrouter': {
      // F159 Phase 2a — landed.
      const { OpenRouterChatBackend } = await import('./openrouter-backend.js');
      return new OpenRouterChatBackend();
    }
    case 'claude-api': {
      // F159 Phase 2b — direct Anthropic API for low-latency premium chats.
      // Code-complete and typecheck-verified; end-to-end probe deferred
      // until ANTHROPIC_API_KEY is available in .env.
      const { ClaudeAPIBackend } = await import('./claude-api-backend.js');
      return new ClaudeAPIBackend();
    }
  }
}

export interface RunChatInput
  extends Omit<ChatBackendInput, 'model'>,
    Pick<ChainResolutionInput, 'kb'> {
  /** Optional explicit model — overrides chain resolution. */
  modelOverride?: string;
}

/**
 * Resolve the chat chain, run each step until one succeeds.
 *
 * Phase 4 (this code) advances to the next step on `isFallbackEligible`
 * errors — rate-limits, 5xx, network/connection errors, missing
 * `claude` binary. Hard errors (4xx user-error, content-policy
 * refusal, validation) bubble up immediately; they wouldn't succeed
 * on the next backend either, and silent fall-through would mask
 * real bugs.
 */
export async function runChat(input: RunChatInput): Promise<ChatBackendResult> {
  // F190.3 — chat runs through @broberg/ai-sdk (≥0.3.1, which fixed tool-loop
  // message serialization on BOTH the openai/openrouter and anthropic paths).
  // ai-sdk owns provider failover (anthropic-direct → openrouter chain); Trail
  // owns the MCP tool-loop inside AiSdkChatBackend. The legacy F159
  // chain/createChatBackend + claude-cli/openrouter/claude-api backends remain
  // only for the chat-settings config-display route; runChat no longer uses them
  // (full retirement is a follow-up that also removes the chat-backend config UX).
  const backend = new AiSdkChatBackend();
  return backend.run({
    ...input,
    model: input.modelOverride ?? DEFAULT_CHAT_MODEL,
  });
}

/**
 * Decide whether a backend failure should advance to the next chain
 * step or bubble up as a hard error. Mirror of F149's same-name
 * predicate in services/ingest/runner.ts.
 *
 *   ELIGIBLE (advance):
 *     - "Executable not found" (no claude binary in prod)
 *     - "ENOTFOUND" / "ECONNREFUSED" / "ETIMEDOUT" (network)
 *     - HTTP 429 (rate-limit), HTTP 5xx (provider error)
 *     - "exceeded maxTurns" (this backend ran out of headroom — try
 *       another model with different reasoning shape)
 *
 *   NOT ELIGIBLE (throw immediately):
 *     - HTTP 4xx (auth, validation, malformed body)
 *     - Anthropic-style content-policy refusal
 *     - Generic Error without a recognisable signal — assume
 *       user-error, don't waste budget on the next backend
 */
export function isFallbackEligible(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // CLI binary not on PATH — F159's headline reason for fallback.
  if (lower.includes('executable not found') || lower.includes('enoent')) return true;
  // Network failures.
  if (lower.includes('enotfound') || lower.includes('econnrefused') || lower.includes('etimedout')) return true;
  if (lower.includes('aborterror') || lower.includes('aborted')) return true;
  // Provider 429 / 5xx.
  if (/\b(429|5\d\d)\b/.test(msg)) return true;
  // maxTurns exhaustion — this backend gave up; try another shape.
  if (lower.includes('exceeded maxturns')) return true;
  return false;
}
