/**
 * F159 Phase 1 — prompt construction helpers.
 * F160 Phase 2 — audience-aware persona templates with per-KB overrides.
 *
 * `buildSystemPrompt` is the system-role text the chat-LLM sees first.
 * Three audiences (curator / tool / public) map to three persona-template
 * markdown files in `apps/server/src/assets/personas/`. Each template
 * contains a `{{TRAIL_CONTEXT}}` placeholder that gets replaced with
 * the per-call wiki-context block (or removed entirely when the call
 * has no retrieved context to share).
 *
 * Per-KB persona overrides (knowledge_bases.chat_persona_tool /
 * chat_persona_public) are appended to the resolved template under a
 * `## KB-specific persona` header so curators can sharpen tone without
 * rewriting the whole template. `curator` audience has no per-KB
 * override — admin tone is shared across all KBs the curator owns.
 *
 * Template files are read fresh on every call. They are tiny (~2KB),
 * filesystem reads are sub-millisecond, and not caching keeps the
 * dev-edit loop instant. If this ever shows up in profiling we can
 * add an in-process cache with mtime invalidation; until then,
 * simplicity wins.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSecrets } from '@trail/shared';
import type { Audience } from '../audience.js';

export interface PriorTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SystemPromptInput {
  /** "Development Tester" — used in the prompt so Claude doesn't pass
   *  a guessed slug to MCP tools. Null when the chat is cross-KB. */
  currentTrailName: string | null;
  /** Pre-formatted "Wiki Context (from content search)" block, or
   *  empty string when retrieveContext found nothing. */
  context: string;
  /**
   * F160 — which persona-template to load. Defaults to `curator` for
   * back-compat with pre-F160 callers (admin chat). External Bearer
   * routes pass `tool` or `public` explicitly.
   */
  audience?: Audience;
  /**
   * F160 — per-KB persona override appended under "## KB-specific
   * persona". Pass null/undefined when KB has no override (default).
   * Ignored entirely for `curator` audience — see module header.
   */
  kbPersonaOverride?: string | null;
  /**
   * KB.language (ISO-639-1 like "da", "en"). Threaded into the system
   * prompt as a hard instruction so the model doesn't fall back to
   * English on short queries ("Jedi?") that can't be language-detected.
   * Defaults to 'da' to match Christian's Danish-first stance.
   */
  kbLanguage?: string;
  /**
   * Total non-archived Neuron count in the current Trail. The chat only ever
   * *sees* the handful of most-relevant Neurons in the Wiki Context, so when
   * asked a meta-question ("how many Neurons do you have?") it would otherwise
   * guess from the visible sources (Christian, 2026-07-02: answered "5" for a
   * 55-Neuron Trail). Given here so the model can answer the total truthfully.
   */
  neuronCount?: number;
}

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const PERSONA_DIR = resolve(THIS_DIR, '../../assets/personas');

function loadTemplate(audience: Audience): string {
  const file = `chat-${audience}.md`;
  return readFileSync(resolve(PERSONA_DIR, file), 'utf8');
}

function languageDirective(code: string): string {
  // Map common ISO codes to a clear English instruction. The model
  // gets confused by raw codes ("answer in 'da'") so we expand to
  // a recognizable noun-phrase. Default Danish for unknown codes —
  // matches Christian's primary tenant locale.
  const c = code.toLowerCase();
  if (c.startsWith('da')) return 'Always answer in Danish (dansk). Never English.';
  if (c.startsWith('en')) return 'Always answer in English. Never Danish.';
  if (c.startsWith('de')) return 'Always answer in German (Deutsch). Never English.';
  if (c.startsWith('sv')) return 'Always answer in Swedish (svenska). Never English.';
  if (c.startsWith('no')) return 'Always answer in Norwegian (norsk). Never English.';
  return 'Always answer in Danish (dansk). Never English.';
}

export function buildSystemPrompt({
  currentTrailName,
  context,
  audience = 'curator',
  kbPersonaOverride = null,
  kbLanguage = 'da',
  neuronCount,
}: SystemPromptInput): string {
  const template = loadTemplate(audience);

  // Build the {{TRAIL_CONTEXT}} substitution. For audiences that don't
  // need a heavy "Current Trail" section we still want the wiki-context
  // block when present — that's where the LLM gets its facts. Curator
  // audience also gets the explicit Trail name so its MCP tool calls
  // default to the right KB; tool/public audiences typically don't have
  // tool access in the same way (they're called via /chat which lets
  // tools fire, but the trail-name is already implicit in the kbId
  // scope of the request).
  const trailLine = currentTrailName && audience === 'curator'
    ? `## Current Trail\nThe user is currently viewing the Trail called **"${currentTrailName}"**. Always call tools WITHOUT a \`knowledge_base\` argument so they default to this Trail automatically.\n\n`
    : '';
  const contextBlock = context.trim().length > 0
    ? // F197 — egress guardrail: scrub retrieved Neuron content of any leaked
      // credential BEFORE it enters the prompt, so the model can never see (and
      // therefore never echo / stream) a secret that slipped into a Neuron.
      `## Wiki Context (from content search)\n${redactSecrets(context).redacted}`
    : '';
  const trailContext = `${trailLine}${contextBlock}`.trim();

  let prompt = template.replace('{{TRAIL_CONTEXT}}', trailContext);

  // Hard language directive — appended at the END so it's the last
  // instruction the model reads before the user question. Models
  // weight late-instructions more on output-style decisions.
  // Christian flagged 2026-05-06: chat answered "Jedi?" in English
  // because the persona's "answer in same language as the question"
  // soft-rule fails on short queries the model can't language-detect.
  prompt += `\n\n## Language\n${languageDirective(kbLanguage)}`;

  // Grounding hardening. The chat is a "second brain": it answers strictly from
  // the retrieved Neuron context above, and it must NEVER fabricate. A
  // confident-but-wrong answer (an invented date or commit hash) is worse than
  // admitting the knowledge isn't in this Trail's Neurons.
  prompt += `\n\n## Grounding (hard rule)
- Answer ONLY using the Wiki Context above — it is this Trail's Neurons, your sole source of truth here. Do not answer from general/background knowledge.
- If the answer is NOT in the context, say so plainly in the user's language (e.g. "Det har jeg ikke i denne Trails Neuroner."). Do not guess.
- NEVER invent or infer specifics that aren't in the context — no dates, commit hashes, IDs, version numbers, names, or file paths.
- NEVER mention or cite a Neuron, source, path, or filename that does not appear in the Wiki Context above.
- If the Wiki Context is empty, say you have no relevant Neurons for that question.`;

  // Trail-scope facts. The grounding rule above (answer ONLY from Wiki Context)
  // is right for content questions but WRONG for meta-questions about the Trail
  // itself — the total Neuron count isn't in the context, so the model guesses
  // from the visible sources ("5" for a 55-Neuron Trail). Give it the true
  // total as an explicit, authoritative fact it MAY use for scope questions.
  if (typeof neuronCount === 'number') {
    prompt += `\n\n## Trail facts (authoritative — exception to Grounding)
- This Trail contains **${neuronCount} Neuron${neuronCount === 1 ? '' : 'er'}** i alt. The Wiki Context above shows only the few most relevant to the question, NOT the whole Trail.
- When asked about the SIZE or SCOPE of this Trail (e.g. how many Neurons it has), answer with this total — it is authoritative and overrides any number you might infer from how many sources are shown.`;
  }

  // Append per-KB persona override (tool + public only). Curator audience
  // gets the override stripped intentionally — admin tone is global.
  if (audience !== 'curator' && kbPersonaOverride && kbPersonaOverride.trim()) {
    prompt += `\n\n## KB-specific persona\n\n${kbPersonaOverride.trim()}`;
  }

  return prompt;
}

/**
 * Build the single-string prompt for the `claude -p` CLI path. The CLI
 * has no multi-turn message API, so we inline the history as a
 * transcript before the new question. Claude reliably treats this as
 * conversation context when the headings + roles are explicit.
 *
 * For the OpenRouter / Claude-API backends, the same data is sent as
 * a structured `messages: [...]` array — see those backends' run()
 * methods. Same prompt text either way; the structure differs.
 */
export function buildCliPrompt(
  systemPrompt: string,
  history: ReadonlyArray<PriorTurn>,
  currentMessage: string,
): string {
  if (history.length === 0) {
    return `${systemPrompt}\n\n## User Question\n${currentMessage}`;
  }
  const transcript = history
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n\n');
  return `${systemPrompt}\n\n## Prior Conversation (oldest first — use this to resolve short follow-ups like "yes", "do it", "show me")\n${transcript}\n\n## User Question (current turn)\n${currentMessage}`;
}
