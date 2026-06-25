import { Hono } from 'hono';
import {
  documents,
  documentImages,
  knowledgeBases,
  chatSessions,
  chatTurns,
  type TrailDatabase,
} from '@trail/db';
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm';
import { requireAuth, getTenant, getUser, getTrail } from '../middleware/auth.js';
import { ChatRequestSchema } from '@trail/shared';
import { resolveKbId, stripClaimAnchors } from '@trail/core';
import {
  HEURISTIC_PATH,
  computeConfidence,
  isFaded,
  isPinned,
  rewriteWikiLinks,
} from '@trail/shared';
import { recordAccess } from '../services/access-tracker.js';
import { recordReinforcement } from '../services/reinforcement.js';
import { loadNeuronConfidence, isChatVisible, confidenceOf } from '../services/chat-confidence.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChat, buildSystemPrompt, type PriorTurn } from '../services/chat/index.js';
import { consumeCredits } from '../services/credits.js';
import {
  parseAudienceParam,
  defaultAudienceForAuth,
  type Audience,
} from '../services/audience.js';
import { stripForAudience } from '../services/chat/postprocess.js';
import type { AppBindings } from '../app.js';

// F159 Phase 1 bumped default from 5 to 8. Chat with tool use needs
// headroom: a typical compound query (search → read → search → read →
// answer) is already 4 turns; one extra for self-correction is 5;
// no headroom for the model to refine. 8 gives space while 60s
// timeout still bounds wall-clock.
//
// CHAT_MODEL + ANTHROPIC_API_KEY now live inside the chat backends —
// see services/chat/{chain,claude-cli-backend}.ts.
const CHAT_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS ?? 60_000);
const CHAT_MAX_TURNS = Number(process.env.CHAT_MAX_TURNS ?? 8);
// How many historical turn-pairs to replay into each new turn. 10 turns
// = 5 exchanges, which is ~2500 tokens at typical verbosity — trivial
// against Haiku's 200k context but plenty for "what did you just offer
// me?" follow-ups. Individual turn content is truncated to 2000 chars
// to bound the worst-case (a curator pasting a wall of text).
const CHAT_HISTORY_TURNS = Number(process.env.CHAT_HISTORY_TURNS ?? 10);
const CHAT_HISTORY_MAX_CHARS_PER_TURN = 2000;

// F156 Phase 1 — per-session conversation cap. After N user-turns in
// the same chat_session, the next prompt is rejected and the UI prompts
// the curator to start a new chat. Distinct from CHAT_MAX_TURNS (which
// caps tool-iterations *within* one assistant response). Default 6 is
// a development knob; hard limits per tier land with F156 Phase 4 +
// the tier_caps table. Env-tunable so we can flip it during testing
// without redeploying.
const CHAT_MAX_TURNS_PER_SESSION = Number(process.env.CHAT_MAX_TURNS_PER_SESSION ?? 6);

// Resolve the trail MCP entrypoint from this file's location, not from
// `process.cwd()`. Early version did the latter and broke when the engine
// was launched via `bun run --cwd apps/server` (scripts/trail), because
// cwd then was apps/server — which doesn't contain apps/mcp. Claude spawned
// a nonexistent MCP, silently got no tools, and answered "sorry, tools
// unavailable". Resolving from __dirname makes the path correct regardless
// of how the engine was started.
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = resolve(THIS_DIR, '../../../../apps/mcp/src/index.ts');

// Whitelist of trail MCP tools the chat LLM is allowed to call. All
// read-only — write/delete stay out so chat never mutates state without
// going through the Queue. The CLI backend joins this on `,` for the
// `--allowedTools` flag; OpenRouter / Claude-API backends iterate it
// to build their `tools: [...]` array — so we keep the list shape and
// let backends format as needed.
const CHAT_ALLOWED_TOOL_LIST: ReadonlyArray<string> = [
  'mcp__trail__guide',
  'mcp__trail__search',
  'mcp__trail__read',
  'mcp__trail__count_neurons',
  'mcp__trail__count_sources',
  'mcp__trail__queue_summary',
  'mcp__trail__recent_activity',
  'mcp__trail__trail_stats',
];

export const chatRoutes = new Hono<AppBindings>();

chatRoutes.use('*', requireAuth);

chatRoutes.post('/chat', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const user = getUser(c);
  const body = ChatRequestSchema.parse(await c.req.json());

  // F135 — accept slug or UUID in body.knowledgeBaseId. Resolve to
  // canonical UUID before any FK-scoped queries run.
  const resolvedKbId = body.knowledgeBaseId
    ? await resolveKbId(trail, tenant.id, body.knowledgeBaseId)
    : null;
  if (body.knowledgeBaseId && !resolvedKbId) {
    return c.json({ error: 'Knowledge base not found' }, 404);
  }

  // Scope to either a specific KB (validating it belongs to this tenant) or all
  // the tenant's KBs. The old code fetched by id alone without a tenant check,
  // which was fine single-tenant but dangerous when F40.2 lands — fixing now.
  // F159 Phase 3: include the chat-backend override columns so resolveChatChain
  // can honour per-KB curator settings.
  const kbColumns = {
    id: knowledgeBases.id,
    name: knowledgeBases.name,
    // KB.language threaded into buildSystemPrompt so the model gets a
    // hard "answer in <lang>" directive instead of the soft "match
    // the question's language" rule (which fails on short queries).
    language: knowledgeBases.language,
    chatBackend: knowledgeBases.chatBackend,
    chatModel: knowledgeBases.chatModel,
    chatFallbackChain: knowledgeBases.chatFallbackChain,
    // F160 Phase 2 — per-KB persona overrides for tool/public audiences.
    chatPersonaTool: knowledgeBases.chatPersonaTool,
    chatPersonaPublic: knowledgeBases.chatPersonaPublic,
  };
  // Chat is ALWAYS scoped to the SINGLE Trail (KB) the user is in — it is the
  // brain of THAT Trail, never a global search across the tenant's KBs. The UI
  // always sends the current Trail as knowledgeBaseId. Without one, only
  // auto-resolve when the tenant has exactly one KB; otherwise refuse rather
  // than silently search everything (which leaked unrelated KBs' sources — e.g.
  // another tenant-KB's PDFs — into answers).
  const kbs = await trail.db
    .select(kbColumns)
    .from(knowledgeBases)
    .where(
      resolvedKbId
        ? and(eq(knowledgeBases.id, resolvedKbId), eq(knowledgeBases.tenantId, tenant.id))
        : eq(knowledgeBases.tenantId, tenant.id),
    )
    .all();

  if (!resolvedKbId && kbs.length > 1) {
    return c.json(
      {
        error:
          'Specify which Trail to chat with (knowledgeBaseId) — chat is scoped to a single Trail, not a global search.',
        code: 'knowledge_base_required',
      },
      400,
    );
  }
  if (kbs.length === 0) {
    return c.json({
      answer: 'No knowledge bases found for this tenant. Create a wiki first and add sources.',
    });
  }

  // F156 Phase 1 — gate before any LLM work. Count user-turns already
  // persisted in this session; if at/over the cap, reject 429 so the
  // UI can render the "start ny chat" prompt without burning a Gemini
  // call. Tenant-scoped via join — a sessionId from another tenant
  // returns 0 here and falls into the normal new-session path below.
  if (body.sessionId) {
    const userTurnCount = await countUserTurns(trail, body.sessionId, tenant.id);
    if (userTurnCount >= CHAT_MAX_TURNS_PER_SESSION) {
      return c.json(
        {
          error: 'Session turn limit reached',
          code: 'session_turn_cap_reached',
          turnsUsed: userTurnCount,
          turnsLimit: CHAT_MAX_TURNS_PER_SESSION,
        },
        429,
      );
    }
  }

  // F160 Phase 2 — audience determines persona AND now (2026-05-20)
  // whether retrieveContext surfaces images. Compute it before
  // retrieval so the same value flows into both layers.
  const authType = c.get('authType');
  const audience: Audience =
    parseAudienceParam(body.audience ?? null) ?? defaultAudienceForAuth(authType);

  const { context, citations, images } = await retrieveContext(
    trail,
    body.message,
    kbs.map((kb) => kb.id),
    tenant.id,
    audience,
  );

  // F144 follow-up: multi-turn memory. If the client pinned a sessionId,
  // replay the last N turn-pairs so the LLM sees its own prior offer and
  // the user's short follow-up ("Ja det vil jeg gerne") as one coherent
  // conversation. Without this, every turn looks like a cold-start and
  // short confirmations fail to resolve.
  const priorTurns = body.sessionId
    ? await loadPriorTurns(trail, body.sessionId, tenant.id, CHAT_HISTORY_TURNS)
    : [];

  // Name the Trail the user is currently in so Claude doesn't pass a
  // guessed slug to tools. All structural tools accept an optional
  // knowledge_base arg, but when omitted they default to the Trail scoped
  // via env (TRAIL_KNOWLEDGE_BASE_ID) — which is always the *current* KB.
  const currentTrailName = kbs.length === 1 ? kbs[0]!.name : null;

  // F160 Phase 2 — per-KB persona override. audience + authType
  // already resolved above (before retrieveContext) so we re-use
  // those values here rather than recomputing.
  const primaryKbForPrompt = resolvedKbId
    ? (kbs.find((k) => k.id === resolvedKbId) ?? kbs[0]!)
    : kbs[0]!;
  const kbPersonaOverride =
    audience === 'tool'
      ? primaryKbForPrompt.chatPersonaTool
      : audience === 'public'
        ? primaryKbForPrompt.chatPersonaPublic
        : null;
  const systemPrompt = buildSystemPrompt({
    currentTrailName,
    context,
    audience,
    kbPersonaOverride,
    // Thread KB.language so the model gets a hard "answer in <lang>"
    // directive. Default 'da' matches the schema-level default.
    kbLanguage: primaryKbForPrompt?.language ?? 'da',
  });

  // F30 — server-side render of [[wiki-links]] into `[display](href)`
  // markdown. Consumers (widget, API clients, non-admin integrators)
  // receive `renderedAnswer` ready to pass to their own markdown→HTML
  // renderer without writing their own wiki-link parser. Admin already
  // runs `rewriteWikiLinks` client-side so the second pass is a no-op
  // (all `[[...]]` are gone). Cross-KB resolution uses the tenant's
  // full KB list so `[[kb:other-trail/Page]]` resolves to the sister
  // KB when it exists.
  const primaryKbId = resolvedKbId ?? kbs[0]!.id;
  const tenantKbSlugMap = await buildKbSlugMap(trail, tenant.id);
  const renderAnswer = (raw: string): string =>
    rewriteWikiLinks(raw, {
      currentKbId: primaryKbId,
      resolveKbSlug: (slug) => tenantKbSlugMap.get(slug) ?? null,
    });

  // F159 Phase 1: route the run through the new ChatBackend interface.
  // Phase 1 always resolves to a single-step Claude-CLI chain — same
  // bytes out as the pre-F159 hand-rolled spawnClaude call. Phase 2
  // adds OpenRouter + Claude-API backends + chain fallback; Phase 3
  // adds cost stamping into chat_turns.
  // F159 Phase 3: per-KB chain override loaded above; pass through.
  const primaryKb = kbs.find((k) => k.id === primaryKbId) ?? kbs[0]!;

  try {
    const result = await runChat({
      trail,
      systemPrompt,
      userMessage: body.message,
      history: priorTurns,
      maxTurns: CHAT_MAX_TURNS,
      timeoutMs: CHAT_TIMEOUT_MS,
      tenantId: tenant.id,
      knowledgeBaseId: primaryKbId,
      userId: user.id,
      mcpServerPath: MCP_SERVER_PATH,
      toolNames: CHAT_ALLOWED_TOOL_LIST,
      kb: {
        chatBackend: primaryKb.chatBackend,
        chatModel: primaryKb.chatModel,
        chatFallbackChain: primaryKb.chatFallbackChain,
      },
    });
    // F160 Phase 2 — strip wiki-links + "Kilder:"-section for tool /
    // public audiences. Admin (curator) keeps the raw markdown.
    const answer = stripForAudience(result.answer, audience);
    const sessionId = await persistTurnPair(
      trail,
      tenant.id,
      user.id,
      primaryKbId,
      body.sessionId ?? null,
      body.message,
      answer,
      citations,
      result.elapsedMs,
      result.costCents,
      result.backendUsed,
      result.modelUsed,
    );
    // F182.4 — the Neurons cited in a delivered answer are a reinforcement
    // signal distinct from the retrieval-time 'access' read (plan-doc open
    // question 6). Fire-and-forget; citations are deduped by documentId in
    // retrieveContext, so one chat-cite per Neuron per answer.
    for (const cite of citations) {
      recordReinforcement(trail, {
        neuronId: cite.documentId,
        signalType: 'chat-cite',
      });
    }
    // F156 Phase 1 — surface where this session sits relative to its
    // turn-cap so the UI can show the soft warning at N-1 and the
    // hard "start ny chat" prompt at N. Counted AFTER the persist
    // above so the freshly-landed user-turn is included.
    const turnsUsed = sessionId ? await countUserTurns(trail, sessionId, tenant.id) : 1;
    // F22 leak-prevention defense-in-depth: even though stripClaimAnchors
    // runs on the input context, a creative model could still emit
    // `{#claim-xxx}` if it learned the pattern from earlier turns or
    // training. Strip at the answer-output layer too so the user-facing
    // payload is guaranteed clean across both `answer` and
    // `renderedAnswer`.
    const cleanAnswer = stripClaimAnchors(answer);
    return c.json({
      answer: cleanAnswer,
      // For tool / public audience there are no `[[wiki-links]]` left in
      // the answer (postprocess stripped them), so renderedAnswer is
      // identical content but kept for response-shape stability across
      // audiences. Admin curator gets the rewriteWikiLinks pass that
      // resolves to admin-paths.
      renderedAnswer: audience === 'curator' ? renderAnswer(cleanAnswer) : cleanAnswer,
      citations,
      // 2026-05-20 — images surfaced for non-public audiences. Public
      // (Eir-widget) gets undefined here, preserving its text-only
      // contract; curator + tool get the array even when empty so
      // consumers can render an "image carousel" zero-state.
      ...(audience !== 'public' ? { images } : {}),
      sessionId,
      // F159 — surface backend + model on every reply so the admin UI
      // can render a small chip ("answered by gemini-2.5-flash") when
      // we want to show the user which model they got.
      backend: result.backendUsed,
      model: result.modelUsed,
      turnsUsed,
      turnsLimit: CHAT_MAX_TURNS_PER_SESSION,
      // F160 — echo back the resolved audience so the client knows
      // which template was used (useful for debugging integrations).
      audience,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[chat] Error:', msg);
    return c.json({ error: msg }, 500);
  }
});

/**
 * F144 — write the user+assistant turn pair to chat_turns. Session is
 * created on first turn if no sessionId passed; title is derived from
 * the user question (truncated to 60 chars). All DB work here is best-
 * effort: if persistence fails we still return the answer, just without
 * a durable record. Returns the session id for the client to pin to.
 */
async function persistTurnPair(
  trail: TrailDatabase,
  tenantId: string,
  userId: string,
  kbId: string,
  incomingSessionId: string | null,
  userMessage: string,
  assistantAnswer: string,
  citations: Citation[],
  latencyMs: number,
  // F159 Phase 3 — backend audit + cost stamping. NULL on Claude-CLI
  // turns (Max-Plan flat fee). Pre-F159 callers (none post-refactor)
  // would pass undefined and the columns stay NULL.
  costCents: number | null = null,
  backendUsed: string | null = null,
  modelUsed: string | null = null,
): Promise<string | null> {
  try {
    let sessionId = incomingSessionId;
    const now = new Date().toISOString();
    if (!sessionId) {
      sessionId = `chs_${crypto.randomUUID().slice(0, 12)}`;
      await trail.db
        .insert(chatSessions)
        .values({
          id: sessionId,
          tenantId,
          knowledgeBaseId: kbId,
          userId,
          title: deriveSessionTitle(userMessage),
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } else {
      await trail.db
        .update(chatSessions)
        .set({ updatedAt: now })
        .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.tenantId, tenantId)))
        .run();
    }
    const citationsJson = citations.length
      ? JSON.stringify(
          citations.map((c) => ({
            neuronId: c.documentId,
            path: c.path,
            filename: c.filename,
          })),
        )
      : null;
    await trail.db
      .insert(chatTurns)
      .values({
        id: `ctn_${crypto.randomUUID().slice(0, 12)}`,
        sessionId,
        role: 'user',
        content: userMessage,
        createdAt: now,
      })
      .run();
    const assistantTurnId = `ctn_${crypto.randomUUID().slice(0, 12)}`;
    await trail.db
      .insert(chatTurns)
      .values({
        id: assistantTurnId,
        sessionId,
        role: 'assistant',
        content: assistantAnswer,
        citations: citationsJson,
        latencyMs,
        costCents,
        backendUsed,
        modelUsed,
        createdAt: new Date().toISOString(),
      })
      .run();
    // F156 Phase 1 — chat now consumes credits. Pricing-table revision
    // 2026-04-25: with F159's pluggable backends we can measure chat
    // cost honestly via OpenRouter usage.cost (Gemini Flash default
    // ≈ 0.1 credits/turn so Hobby-tier doesn't deplete on normal use).
    // Skip when costCents is null/0 — that's the Claude-CLI Max-Plan
    // path, where Christian's tenant pays $0 per turn.
    if (costCents != null && costCents > 0) {
      try {
        await consumeCredits(trail, tenantId, {
          costCents,
          feature: 'chat',
          relatedChatTurnId: assistantTurnId,
        });
      } catch (err) {
        console.error(
          '[chat] consumeCredits failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }
    return sessionId;
  } catch (err) {
    console.error('[chat] persist-turn failed:', err instanceof Error ? err.message : err);
    return incomingSessionId;
  }
}

function deriveSessionTitle(message: string): string {
  const normalised = message.replace(/\s+/g, ' ').trim();
  if (normalised.length <= 60) return normalised;
  return normalised.slice(0, 57).replace(/[,.!?;:]+$/, '') + '…';
}

/**
 * F30 — lookup table for cross-KB link resolution in server-side
 * chat-answer rendering. Maps `kb-slug` to `kb-id`. Scoped to the
 * caller's tenant. Small enough to compute per-request; a future
 * optimisation would cache with SSE invalidation on KB create/update.
 */
async function buildKbSlugMap(trail: TrailDatabase, tenantId: string): Promise<Map<string, string>> {
  const rows = await trail.db
    .select({ id: knowledgeBases.id, slug: knowledgeBases.slug })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.tenantId, tenantId))
    .all();
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.slug) map.set(r.slug, r.id);
  }
  return map;
}

/**
 * Load up to `limit` most-recent turns for a session, returned in
 * chronological order (oldest first) so they replay as a natural
 * conversation. Scoped by sessionId + tenantId via a join so a crafted
 * sessionId from another tenant can't leak turns.
 *
 * Truncates per-turn content to CHAT_HISTORY_MAX_CHARS_PER_TURN so a
 * curator pasting a wall of text doesn't blow the prompt budget.
 */
async function loadPriorTurns(
  trail: TrailDatabase,
  sessionId: string,
  tenantId: string,
  limit: number,
): Promise<PriorTurn[]> {
  try {
    const rows = await trail.db
      .select({ role: chatTurns.role, content: chatTurns.content })
      .from(chatTurns)
      .innerJoin(chatSessions, eq(chatSessions.id, chatTurns.sessionId))
      .where(
        and(eq(chatTurns.sessionId, sessionId), eq(chatSessions.tenantId, tenantId)),
      )
      .orderBy(asc(chatTurns.createdAt))
      .limit(limit)
      .all();
    return rows.map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: truncateForHistory(r.content),
    }));
  } catch (err) {
    console.error('[chat] loadPriorTurns failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

function truncateForHistory(content: string): string {
  if (content.length <= CHAT_HISTORY_MAX_CHARS_PER_TURN) return content;
  return content.slice(0, CHAT_HISTORY_MAX_CHARS_PER_TURN) + '…';
}

/**
 * Count user-turns persisted for a session, scoped via join to tenant
 * so a sessionId from another tenant returns 0 (and the gate falls
 * through to the new-session path). Returns 0 on read errors so a
 * transient DB hiccup doesn't lock the curator out of chatting.
 */
async function countUserTurns(
  trail: TrailDatabase,
  sessionId: string,
  tenantId: string,
): Promise<number> {
  try {
    const row = await trail.db
      .select({ n: sql<number>`count(*)` })
      .from(chatTurns)
      .innerJoin(chatSessions, eq(chatSessions.id, chatTurns.sessionId))
      .where(
        and(
          eq(chatTurns.sessionId, sessionId),
          eq(chatTurns.role, 'user'),
          eq(chatSessions.tenantId, tenantId),
        ),
      )
      .get();
    return Number(row?.n ?? 0);
  } catch (err) {
    console.error('[chat] countUserTurns failed:', err instanceof Error ? err.message : err);
    return 0;
  }
}

interface Citation {
  documentId: string;
  path: string;
  filename: string;
}

interface ChatImage {
  documentId: string;
  filename: string;
  /** Relative URL — admin / site-host proxy injects bearer at fetch time. */
  url: string;
  alt: string;
  page: number | null;
  width: number;
  height: number;
}

/** Hard cap on images surfaced per chat response. Eight is enough for
 * a wall-style answer, small enough that the alt-text block doesn't
 * dominate the LLM's prompt. */
const CHAT_IMAGE_CAP = 8;

async function retrieveContext(
  trail: TrailDatabase,
  query: string,
  kbIds: string[],
  tenantId: string,
  audience: Audience = 'curator',
): Promise<{ context: string; citations: Citation[]; images: ChatImage[] }> {
  const chunks: string[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  let totalChars = 0;
  const MAX_CHARS = 30_000;
  const PER_KB_CHUNKS = 8;
  const PER_KB_DOCS = 4;

  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return { context: '', citations: [], images: [] };

  for (const kbId of kbIds) {
    if (totalChars >= MAX_CHARS) break;

    // F139 — faded heuristics (confidence <0.3, not pinned) are excluded
    // from chat context so stale decision-rules don't drift into new
    // answers. The filter is a Set<documentId> applied after FTS — cheap
    // upfront query, usually 0 rows on KBs that don't use heuristics yet.
    const fadedHeuristicIds = await listFadedHeuristicIds(trail, kbId, tenantId);

    const chunkHits = await trail.searchChunks(ftsQuery, kbId, tenantId, PER_KB_CHUNKS);
    const docHits = await trail.searchDocuments(ftsQuery, kbId, tenantId, PER_KB_DOCS);

    // F182.6 — decay-aware retrieval. Load confidence + pin + supersede state
    // for every candidate Neuron, then hide superseded ones and low-confidence
    // ones (<CHAT_HIDE_BELOW, unless curator-pinned), and rank surviving docs by
    // confidence DESC so fresher/stronger knowledge leads the context
    // (deemphasising the 0.3-0.5 band rather than dropping it). Generalises the
    // F139 faded-heuristic exclusion to all Neuron types.
    const confMap = await loadNeuronConfidence(trail, tenantId, [
      ...chunkHits.map((h) => h.documentId),
      ...docHits.map((h) => h.id),
    ]);

    for (const hit of chunkHits) {
      if (totalChars >= MAX_CHARS) break;
      // Chat answers from NEURONS (the brain), never raw source documents.
      // Sources are compiled into Neurons at ingest; the Neuron is the unit of
      // knowledge a chat question targets. Skip any chunk from a raw source.
      if (hit.kind !== 'wiki') continue;
      if (fadedHeuristicIds.has(hit.documentId)) continue;
      if (!isChatVisible(confMap.get(hit.documentId))) continue;
      const header = hit.headerBreadcrumb ? `[${hit.headerBreadcrumb}] ` : '';
      // F22 leak-prevention: claim-anchor markers must NEVER reach the
      // chat-LLM — if they do, the model can echo them into the
      // user-visible answer. Strip at the chunk-content layer so every
      // backend (claude-cli, openrouter, claude-api) sees clean prose.
      const cleanContent = stripClaimAnchors(hit.content.slice(0, 2500));
      const text = `### chunk ${header}\n${cleanContent}`;
      chunks.push(text);
      totalChars += text.length;
      if (!seen.has(hit.documentId)) {
        seen.add(hit.documentId);
        // F141 — record the chat-context hit. One row per unique Neuron
        // that contributed to a chat answer; counted as actor_kind='user'
        // because it's a user question that pulled this Neuron in. Lets
        // "most-consulted by chat" surface in the F141 insights panel.
        recordAccess(trail, {
          tenantId,
          knowledgeBaseId: kbId,
          documentId: hit.documentId,
          source: 'chat',
          actorKind: 'user',
        });
      }
    }

    const rankedDocs = docHits
      .filter((h) => h.kind === 'wiki' && !fadedHeuristicIds.has(h.id) && isChatVisible(confMap.get(h.id)))
      .sort((a, b) => confidenceOf(confMap, b.id) - confidenceOf(confMap, a.id));
    for (const hit of rankedDocs) {
      if (totalChars >= MAX_CHARS) break;
      if (!seen.has(hit.id)) {
        seen.add(hit.id);
        citations.push({ documentId: hit.id, path: hit.path, filename: hit.filename });
        recordAccess(trail, {
          tenantId,
          knowledgeBaseId: kbId,
          documentId: hit.id,
          source: 'chat',
          actorKind: 'user',
        });
      }
    }
  }

  // F112.1/F112.2 — surface shared user-notes via TWO paths:
  //
  // (1) ENRICH any document already pulled into `seen` by FTS. If
  //     the body matches the question and the curator opted-in to
  //     share their note, the note rides along as context. This is
  //     the meta-data flow: the note follows its parent Neuron into
  //     chat scope regardless of whether the note text itself
  //     matched the query.
  //
  // (2) SUBSTRING-MATCH the literal query against shared notes via
  //     searchUserNotes. Catches the case where ONLY the note has
  //     the relevant content (e.g. curator wrote a private aside
  //     that's now share-opted-in and the question matches it
  //     exactly). Parent doc is added to seen+citations if absent.
  //
  // Order: (1) first so docs already in `seen` claim their note
  // via the typed Drizzle path; (2) second adds note-only hits
  // without re-emitting notes for docs (1) already covered.

  if (seen.size > 0 && totalChars < MAX_CHARS) {
    const docIds = Array.from(seen);
    const enrichedNotes = await trail.db
      .select({
        id: documents.id,
        title: documents.title,
        filename: documents.filename,
        userNote: documents.userNote,
      })
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.userNoteShare, true),
          inArray(documents.id, docIds),
        ),
      )
      .all();
    for (const row of enrichedNotes) {
      if (!row.userNote) continue;
      if (totalChars >= MAX_CHARS) break;
      const label = row.title ?? row.filename;
      const block = `### Curator's reflection on "${label}" (their own words, opt-in shared)\n${row.userNote}`;
      chunks.push(block);
      totalChars += block.length;
    }
  }

  for (const kbId of kbIds) {
    if (totalChars >= MAX_CHARS) break;
    const noteHits = await trail.searchUserNotes(query, kbId, tenantId, 5);
    for (const hit of noteHits) {
      if (seen.has(hit.id)) continue; // already enriched above
      if (totalChars >= MAX_CHARS) break;
      const label = hit.title ?? hit.filename;
      const block = `### Curator's reflection on "${label}" (their own words, opt-in shared)\n${hit.userNote}`;
      chunks.push(block);
      totalChars += block.length;
      seen.add(hit.id);
      citations.push({ documentId: hit.id, path: hit.path, filename: hit.filename });
      recordAccess(trail, {
        tenantId,
        knowledgeBaseId: kbId,
        documentId: hit.id,
        source: 'chat',
        actorKind: 'user',
      });
    }
  }

  // 2026-05-20 — surface images from the retrieved Neurons so downstream
  // consumers (admin chat, external LLM integrations) can render them
  // alongside the answer. Gated on audience: `public` (Eir-widget,
  // unauthenticated callers) gets NO images — Sanne's chat UI stays
  // text-only by design. `curator` + `tool` audiences get up to
  // CHAT_IMAGE_CAP image hits, ordered by (documentId, filename) for
  // deterministic responses across calls.
  //
  // Also injects an "Available images" section into the LLM context
  // when images exist so the model can SAY "here are three pictures
  // of feet" instead of refusing the request. Without this, the LLM
  // is unaware that images exist and apologises that it can't help.
  // Image surfacing for non-public audiences. FTS-first, piggyback-as-filler:
  //
  //   (A) FTS over document_images_fts.vision_description — matches
  //       the query directly against vision-generated alt-text. This
  //       has to run BEFORE piggyback or the cap gets eaten by random
  //       images from text-matched Neurons that have nothing to do
  //       with the visual subject the user asked about. ("vis mig
  //       billeder af gule blomster" → text-retrieval pulls answer-
  //       Neurons about "showing images" with anatomy images attached;
  //       FTS pulls the actual yellow-flower images directly.)
  //
  //   (B) Piggyback fills any remaining slots with images from the
  //       text-retrieved doc set. Useful when the question isn't
  //       primarily visual but the matched Neurons happen to have
  //       embedded figures.
  const images: ChatImage[] = [];
  const seenImageRowIds = new Set<string>();
  if (audience !== 'public') {
    // (A) FTS-first
    if (ftsQuery && kbIds.length > 0) {
      const placeholders = kbIds.map(() => '?').join(',');
      const ftsResult = await trail.execute(
        `SELECT di.id, di.document_id, di.knowledge_base_id, di.filename,
                di.page, di.width, di.height, di.vision_description
           FROM document_images_fts fts
           JOIN document_images di ON di.rowid = fts.rowid
          WHERE fts.vision_description MATCH ?
            AND di.tenant_id = ?
            AND di.knowledge_base_id IN (${placeholders})
          ORDER BY bm25(document_images_fts) ASC
          LIMIT ?`,
        [ftsQuery, tenantId, ...kbIds, CHAT_IMAGE_CAP],
      );
      for (const row of ftsResult.rows as Array<Record<string, unknown>>) {
        if (images.length >= CHAT_IMAGE_CAP) break;
        const imageId = String(row.id);
        if (seenImageRowIds.has(imageId)) continue;
        seenImageRowIds.add(imageId);
        const docId = String(row.document_id);
        const filename = String(row.filename);
        images.push({
          documentId: docId,
          filename,
          url: `/api/v1/documents/${docId}/images/${filename.replace(/^\//, '')}`,
          alt: (row.vision_description as string | null) ?? '',
          page: (row.page as number | null) ?? null,
          width: Number(row.width),
          height: Number(row.height),
        });
        // Adopt the parent doc into seen so the citations array can
        // surface it too. Cheap one-row lookup; only fires for hits.
        if (!seen.has(docId)) {
          seen.add(docId);
          const parent = await trail.db
            .select({ id: documents.id, path: documents.path, filename: documents.filename })
            .from(documents)
            .where(eq(documents.id, docId))
            .get();
          if (parent) {
            citations.push({ documentId: parent.id, path: parent.path, filename: parent.filename });
          }
        }
      }
    }

    // Piggyback path REMOVED 2026-05-21. Previously: when FTS over
    // image alt-text returned 0 hits, we fell back to whatever images
    // the text-retrieved docs had embedded. That filled responses
    // with garbage — "Prøv igen" matched no FTS images so piggyback
    // returned 1 random anatomy diagram from the only text-matched
    // response-Neuron, presented as if it were an answer. FTS-only is
    // the honest contract: surface images whose alt-text actually
    // matches the query, nothing else.
  }

  let context = chunks.join('\n\n---\n\n');
  if (images.length > 0) {
    const block = images
      .map((img, i) => {
        const pageRef = img.page !== null ? ` (page ${img.page})` : '';
        const altOrPlaceholder = img.alt.trim() || '(no alt-text)';
        return `${i + 1}. ${altOrPlaceholder}${pageRef} — url: ${img.url}`;
      })
      .join('\n');
    context += `\n\n---\n\n### Available images in this Trail (you MAY reference them)\n${block}`;
  }

  return { context, citations, images };
}

/**
 * F139 — IDs of heuristic Neurons that have faded below the confidence
 * threshold and are NOT pinned. Used by retrieveContext to suppress
 * stale decision-rules from chat context. Returns an empty set when
 * the KB has no heuristic Neurons (the common case today).
 */
async function listFadedHeuristicIds(
  trail: TrailDatabase,
  kbId: string,
  tenantId: string,
): Promise<Set<string>> {
  const rows = await trail.db
    .select({
      id: documents.id,
      content: documents.content,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.knowledgeBaseId, kbId),
        eq(documents.tenantId, tenantId),
        eq(documents.kind, 'wiki'),
        eq(documents.archived, false),
        like(documents.path, `${HEURISTIC_PATH}%`),
      ),
    )
    .all();

  const faded = new Set<string>();
  for (const r of rows) {
    const pinned = isPinned(r.content);
    const confidence = computeConfidence(r.updatedAt, pinned);
    if (isFaded(confidence)) faded.add(r.id);
  }
  return faded;
}

// Common Danish + English function words. The query is an OR of every term, so
// stopwords let irrelevant Neurons accumulate BM25 mass and drown the one that
// actually answers a long natural-language question. Dropping them focuses the
// query on content terms — the recall fix for questions like "Hvornår skiftede
// Trail chat over til Mistral, og hvilken commit?" (was 15 OR-terms incl.
// hvornår/over/til/og/svar/kort/med → now ~6 content terms).
const FTS_STOPWORDS = new Set([
  // Danish
  'og', 'i', 'på', 'til', 'er', 'en', 'et', 'den', 'det', 'de', 'at', 'som', 'med', 'for', 'af', 'der',
  'du', 'jeg', 'vi', 'han', 'hun', 'hvornår', 'hvad', 'hvem', 'hvilken', 'hvilke', 'hvor', 'hvorfor',
  'hvordan', 'kan', 'skal', 'vil', 'har', 'var', 'blev', 'over', 'under', 'ved', 'om', 'men', 'eller',
  'ikke', 'så', 'kort', 'svar', 'mig', 'os', 'din', 'dit', 'min', 'mit', 'denne', 'dette', 'disse',
  // English
  'the', 'a', 'an', 'to', 'of', 'is', 'are', 'was', 'were', 'and', 'or', 'in', 'on', 'with', 'what',
  'when', 'which', 'who', 'how', 'why', 'can', 'should', 'will', 'do', 'does', 'please', 'short',
  'answer', 'me', 'my', 'your', 'it', 'this', 'that',
]);

function sanitizeFtsQuery(raw: string): string {
  const terms = raw
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((t) => t.length >= 2 && !FTS_STOPWORDS.has(t.toLowerCase()))
    .map((t) => `"${t}"*`);
  // Fall back to the full token set if stopword-stripping emptied the query
  // (e.g. a question made entirely of function words) so we never widen to an
  // empty MATCH (which would return zero context for an otherwise-answerable Q).
  if (terms.length === 0) {
    return raw
      .split(/\s+/)
      .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((t) => t.length > 0)
      .map((t) => `"${t}"*`)
      .join(' OR ');
  }
  return terms.join(' OR ');
}
