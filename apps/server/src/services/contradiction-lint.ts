/**
 * F19 axis 3 — contradiction detection as a background subscriber.
 *
 * Subscribes to the engine's broadcaster. When a candidate_approved event
 * fires for a wiki-kind resulting document, fetch the new Neuron, find its
 * top-K semantically similar existing Neurons via FTS5, run a Haiku
 * pair-compare, and emit `contradiction-alert` candidates for the curator.
 *
 * Deliberately POST-approval (reactive), not pre-approval (blocking):
 *
 *  - Pre-approval would add 1-3s LLM latency to every auto-approved POST.
 *    Human curators wouldn't notice; bulk buddy F39 ingest would.
 *  - Post-approval matches F19's published semantic ("no contradictions")
 *    because contradiction-alert candidates sit in the queue until a human
 *    decides which side is right. The Neuron is live, but so is the
 *    dispute, which is the correct state.
 *
 * The checker is idempotent via lintFingerprint (see runLint). Re-emitting
 * the same pair skips if a pending/approved alert already exists.
 */
import { documents, knowledgeBases, queueCandidates, type TrailDatabase } from '@trail/db';
import { and, eq, like, ne } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  createCandidate,
  detectContradictions,
  type ContradictionCandidate,
  type ContradictionChecker,
  type LlmContradictionResult,
  type NewNeuron,
} from '@trail/core';
import type { CandidateApprovedEvent } from '@trail/shared';
import { broadcaster } from './broadcast.js';
import { ai } from '../lib/ai.js';
import { decideSupersession } from './supersession.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const BACKEND = process.env.TRAIL_CONTRADICTION_BACKEND ?? (ANTHROPIC_API_KEY ? 'api' : 'cli');
// F199.7 — contradiction-lint stays on mistral-LARGE (EU), not small: the
// calibration set (verify-contradiction-lint-calibration.ts) showed small-latest
// over-flags a coverage-difference as a contradiction (4/5), the exact over-flag
// that drives bad F182.5 auto-supersessions; large-latest is 5/5. Accuracy here
// outweighs the ~20× cost because a false contradiction corrupts memory lifecycle.
const MODEL = process.env.TRAIL_CONTRADICTION_MODEL ?? 'mistral-large-latest';
// F158 — kill-switch for the idempotent skip. Set to '1' to force a
// full re-scan regardless of cached signatures. Useful when:
//   - prompt or model env changed and you want fresh evaluations
//   - debugging a suspected false-skip
const FORCE_RESCAN = process.env.TRAIL_CONTRADICTION_FORCE_RESCAN === '1';

/**
 * F158 — content-signature for idempotent skip. Hash of (neuron-id +
 * neuron-version + sorted peer-id:version pairs). When unchanged from
 * the previous successful scan, the entire LLM-call loop is bypassed.
 *
 * Includes TOP_K + MODEL so any config change forces a fresh scan
 * (prevents stale skips after we tune the prompt or swap model).
 */
function computeContradictionSignature(
  neuronId: string,
  neuronVersion: number,
  peers: Array<{ documentId: string; version: number }>,
): string {
  const peerSig = peers
    .map((p) => `${p.documentId}:v${p.version}`)
    .sort()
    .join('|');
  const input = `topk=${TOP_K}|model=${MODEL}|${neuronId}:v${neuronVersion}|${peerSig}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
const TOP_K = Number(process.env.TRAIL_CONTRADICTION_TOPK ?? 5);
const MIN_CONTENT_CHARS = 200; // skip short stubs — too little signal
const CLI_TIMEOUT_MS = Number(process.env.TRAIL_CONTRADICTION_CLI_TIMEOUT_MS ?? 45_000);

const PROMPT = `You are checking whether two passages from a knowledge wiki contradict each other.

Return ONLY a single line of valid JSON matching this TypeScript shape:
  { "contradicts": boolean, "newQuote"?: string, "existingQuote"?: string, "summary"?: string }

Rules:
- A contradiction means the two passages make claims that cannot both be true given standard reading. Differences in focus, phrasing, or coverage are NOT contradictions.
- If contradicts is true, include short direct quotes from each passage (max 200 chars each) showing the conflict.
- If contradicts is false, return {"contradicts": false}. No other fields needed.
- Do not explain your reasoning. Just the JSON.`;

/**
 * Resolve the checker backend once. Exposed so the scheduler (F32.2 full
 * pass) can reuse the same configuration as the reactive subscriber.
 */
export function makeContradictionChecker(): ContradictionChecker {
  // F190.2 / F199.7 — single discrete call through @broberg/ai-sdk (Mistral
  // primary, Mistral fallback, transport:http, EU). Replaces the prior
  // BACKEND-switched claude-cli + direct-Anthropic-fetch checkers.
  return async (newContent, existingContent, labels): Promise<LlmContradictionResult> => {
    const userContent = [
      '## New passage',
      newContent.slice(0, 4000),
      '',
      '## Existing passage',
      existingContent.slice(0, 4000),
    ].join('\n');
    try {
      const res = await ai.chat({
        system: PROMPT,
        messages: [{ role: 'user', content: userContent }],
        override: { provider: 'mistral', model: MODEL, transport: 'http' },
        fallback: [{ provider: 'mistral', model: 'mistral-small-latest', transport: 'http' }],
        maxTokens: 300,
        purpose: 'contradiction-lint',
        // F190.6 — per-tenant cost attribution (supplied per-doc by runForEvent).
        ...(labels ? { labels } : {}),
      });
      const json = res.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
      const parsed = JSON.parse(json) as LlmContradictionResult;
      if (typeof parsed.contradicts !== 'boolean') return { contradicts: false };
      return parsed;
    } catch {
      // Malformed / call failed → "no signal" so the next pair gets evaluated.
      return { contradicts: false };
    }
  };
}

export function startContradictionLint(trail: TrailDatabase): () => void {
  const checker = makeContradictionChecker();

  // Rate-limit: only one event being processed at any time. If a second
  // candidate_approved fires while we're busy, queue it; if more than N
  // queue up, drop the oldest (a background lint is nice-to-have, not a
  // critical path).
  //
  // At Sanne-scale, approving 22 orphan Neurons in one batch would trigger
  // 22 events × 5 similars × 1-3s each. Sequentially that's safe; parallel
  // via claude -p would spawn 110 subprocesses at once — not safe.
  const runner = new SerialRunner(trail, checker);

  const unsubscribe = broadcaster.subscribe((event) => {
    if (event.type !== 'candidate_approved') return;
    runner.enqueue(event);
  });

  console.log(`  contradiction-lint: listening (backend=${BACKEND}, model=${MODEL}, top_k=${TOP_K})`);
  return unsubscribe;
}

/**
 * Scan a single Neuron for contradictions against its top-K similar peers.
 * Re-used by the scheduled full pass (F32.2). Idempotent via lintFingerprint;
 * re-scanning the same Neuron produces no duplicate candidates.
 */
export async function scanDocForContradictions(
  trail: TrailDatabase,
  documentId: string,
  checker: ContradictionChecker,
): Promise<void> {
  // Fabricate a CandidateApprovedEvent shape so we can reuse runForEvent as
  // the single code path — every field the runner actually reads (documentId)
  // is populated; the rest are scaffolding for the event union.
  await runForEvent(
    trail,
    {
      type: 'candidate_approved',
      tenantId: '',
      kbId: '',
      candidateId: '',
      documentId,
      autoApproved: false,
    },
    checker,
  );
}

class SerialRunner {
  private queue: CandidateApprovedEvent[] = [];
  private running = false;
  private readonly maxQueue = 64;

  constructor(
    private readonly trail: TrailDatabase,
    private readonly check: ContradictionChecker,
  ) {}

  enqueue(event: CandidateApprovedEvent): void {
    if (this.queue.length >= this.maxQueue) {
      // Drop oldest — the newest events are the most likely to still matter.
      this.queue.shift();
    }
    this.queue.push(event);
    this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift()!;
        try {
          await runForEvent(this.trail, event, this.check);
        } catch (err) {
          console.error('[contradiction-lint] unhandled error:', err);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

async function runForEvent(
  trail: TrailDatabase,
  event: CandidateApprovedEvent,
  check: ContradictionChecker,
): Promise<void> {
  const doc = await trail.db
    .select({
      id: documents.id,
      filename: documents.filename,
      title: documents.title,
      path: documents.path,
      content: documents.content,
      kind: documents.kind,
      tenantId: documents.tenantId,
      knowledgeBaseId: documents.knowledgeBaseId,
      userId: documents.userId,
      version: documents.version,
      lastContradictionScanSignature: documents.lastContradictionScanSignature,
    })
    .from(documents)
    .where(eq(documents.id, event.documentId))
    .get();

  if (!doc || doc.kind !== 'wiki' || !doc.content) return;
  if (doc.content.length < MIN_CONTENT_CHARS) return;
  // F102 — the auto-maintained glossary is definitional vocabulary, not
  // claims. A glossary entry that says "Connector: source of attribution"
  // is not in conflict with a Neuron detailing the connector pipeline —
  // they're different scopes, and the lint's similarity retrieval is
  // prone to flag them anyway. Skip glossary docs as the subject side
  // (the findSimilarNeurons filter below skips them as the counterparty
  // side too).
  if (doc.path === '/neurons/' && doc.filename === 'glossary.md') return;

  // F200.1 — per-KB contradiction-lint toggle. High-volume session KBs
  // (e.g. buddy-sessions) flip this OFF so auto-approved near-duplicate
  // Neurons stop flooding the queue with contradiction-alert candidates.
  // Checked BEFORE findSimilarNeurons so the per-pair LLM cost is skipped too.
  const kbRow = await trail.db
    .select({ enabled: knowledgeBases.contradictionLintEnabled })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, doc.knowledgeBaseId))
    .get();
  if (kbRow && kbRow.enabled === false) {
    console.log(
      `[contradiction-lint] "${doc.filename}": KB ${doc.knowledgeBaseId} has contradiction-lint disabled (F200.1) — skipping`,
    );
    return;
  }

  const similars = await findSimilarNeurons(trail, doc);
  if (similars.length === 0) return;

  // F158 — idempotent skip. Compute signature over (this Neuron's
  // version, peer-id+version pairs). If unchanged from last successful
  // scan, the LLM-result would be identical too — skip the calls.
  // FORCE_RESCAN env-knob bypasses this for debugging/model-changes.
  const signature = computeContradictionSignature(doc.id, doc.version, similars);
  if (!FORCE_RESCAN && doc.lastContradictionScanSignature === signature) {
    console.log(
      `[contradiction-lint] "${doc.filename}": signature unchanged, skipping (saved ${similars.length} LLM call${similars.length === 1 ? '' : 's'})`,
    );
    return;
  }

  const neuron: NewNeuron = {
    documentId: doc.id,
    filename: doc.filename,
    title: doc.title,
    content: doc.content,
    version: doc.version,
  };

  // F190.6 — tag the per-pair LLM cost with this Neuron's tenant + KB. The
  // scheduled full-pass (scanDocForContradictions) fabricates an event with
  // empty tenantId/kbId, but `doc` is the real row here, so labels are accurate.
  const findings = await detectContradictions(neuron, similars, check, {
    tenantId: doc.tenantId,
    kbId: doc.knowledgeBaseId,
  });

  // F158 — stamp signature on every successful completion (zero or more
  // findings). Signature update happens BEFORE the early return on empty
  // findings, so the next pass with same versions skips the LLM work.
  await trail.db
    .update(documents)
    .set({ lastContradictionScanSignature: signature })
    .where(eq(documents.id, doc.id))
    .run();

  if (findings.length === 0) return;

  // Emit each finding as a contradiction-alert candidate. Actor kind='system'
  // keeps createdBy null so F19 policy evaluates it like any other pipeline
  // write. `contradiction-alert` is NOT in TRUSTED_KINDS — even at confidence
  // 0.75 it lands pending, which is exactly what we want: a human adjudicates
  // contradictions, not a policy.
  for (const f of findings) {
    const existingFp = await hasExistingFingerprint(trail, doc.knowledgeBaseId, doc.tenantId, f.fingerprint);
    if (existingFp) continue;

    try {
      // F182.5 — if one side dominates on confidence + source-count, emit a
      // 'supersede' candidate (auto-approves via metadata.autoSupersede)
      // INSTEAD of the contradiction-alert. When neither dominates,
      // decideSupersession returns null and we fall through to the normal
      // curator-review alert below.
      const newId = (f.details as { newDocumentId?: string }).newDocumentId ?? doc.id;
      const existingId = (f.details as { existingDocumentId?: string }).existingDocumentId;
      const decision = existingId
        ? await decideSupersession(trail, doc.tenantId, newId, existingId)
        : null;

      if (decision) {
        const { candidate, approval } = await createCandidate(
          trail,
          doc.tenantId,
          {
            knowledgeBaseId: doc.knowledgeBaseId,
            kind: 'supersede',
            title: f.title,
            content: f.content,
            metadata: JSON.stringify({
              op: 'supersede',
              source: 'supersession-lint',
              lintFingerprint: f.fingerprint,
              targetNeuronId: decision.targetNeuronId,
              replacementNeuronId: decision.replacementNeuronId,
              confidenceDelta: decision.confidenceDelta,
              autoSupersede: true,
              ...f.details,
            }),
            confidence: decision.replacementConfidence,
            actions: [
              {
                id: 'supersede',
                effect: 'supersede',
                args: {
                  documentId: decision.targetNeuronId,
                  replacementNeuronId: decision.replacementNeuronId,
                },
                label: { en: 'Supersede' },
                explanation: {
                  en: `Mark the older Neuron superseded by the newer one (Δconfidence ${decision.confidenceDelta.toFixed(2)}). The old page is preserved, not deleted.`,
                },
              },
            ],
          },
          { id: 'system:supersession-lint', kind: 'system' },
        );
        broadcaster.emit({
          type: 'candidate_created',
          tenantId: candidate.tenantId,
          kbId: candidate.knowledgeBaseId,
          candidateId: candidate.id,
          kind: candidate.kind,
          title: candidate.title,
          status: approval ? 'approved' : 'pending',
          autoApproved: !!approval,
          confidence: candidate.confidence,
          createdBy: candidate.createdBy,
        });
        if (approval) {
          broadcaster.emit({
            type: 'candidate_resolved',
            tenantId: candidate.tenantId,
            kbId: candidate.knowledgeBaseId,
            candidateId: candidate.id,
            actionId: approval.actionId,
            effect: approval.effect,
            documentId: approval.documentId,
            autoApproved: true,
          });
        }
        continue;
      }

      const { candidate, approval } = await createCandidate(
        trail,
        doc.tenantId,
        {
          knowledgeBaseId: doc.knowledgeBaseId,
          kind: f.kind,
          title: f.title,
          content: f.content,
          metadata: JSON.stringify({ op: 'create', source: 'contradiction-lint', lintFingerprint: f.fingerprint, ...f.details }),
          confidence: f.confidence,
          actions: f.actions,
        },
        { id: 'system:contradiction-lint', kind: 'system' },
      );
      // Broadcast so admin badges + panels react the same way they do to a
      // human POST /queue/candidates. Bypassing the broadcaster means
      // silent writes — the badge stays stuck at its old value until the
      // next reconnect or focus refresh.
      broadcaster.emit({
        type: 'candidate_created',
        tenantId: candidate.tenantId,
        kbId: candidate.knowledgeBaseId,
        candidateId: candidate.id,
        kind: candidate.kind,
        title: candidate.title,
        status: approval ? 'approved' : 'pending',
        autoApproved: !!approval,
        confidence: candidate.confidence,
        createdBy: candidate.createdBy,
      });
      if (approval) {
        // Universal "candidate just resolved" signal — badge + panels listen
        // to this regardless of which action ran.
        broadcaster.emit({
          type: 'candidate_resolved',
          tenantId: candidate.tenantId,
          kbId: candidate.knowledgeBaseId,
          candidateId: candidate.id,
          actionId: approval.actionId,
          effect: approval.effect,
          documentId: approval.documentId,
          autoApproved: true,
        });
        // Narrow doc-producing signal — reference-extractor, backlink-
        // extractor and this same contradiction-lint listen here. Only fires
        // for approve-effect resolutions that actually produced a document.
        if (approval.effect === 'approve' && approval.documentId) {
          broadcaster.emit({
            type: 'candidate_approved',
            tenantId: candidate.tenantId,
            kbId: candidate.knowledgeBaseId,
            candidateId: candidate.id,
            documentId: approval.documentId,
            autoApproved: true,
          });
        }
      }
    } catch (err) {
      console.error('[contradiction-lint] failed to emit candidate:', err);
    }
  }

  console.log(`[contradiction-lint] "${doc.filename}": ${findings.length} contradiction${findings.length === 1 ? '' : 's'} emitted`);
}

async function findSimilarNeurons(
  trail: TrailDatabase,
  doc: { id: string; title: string | null; content: string | null; knowledgeBaseId: string; tenantId: string },
): Promise<ContradictionCandidate[]> {
  // Pre-filter via FTS5 — take the longest non-trivial terms from the new
  // Neuron's title + leading content as the query. Avoids O(n²) pair-compare
  // across the whole KB. Top-K closest Neurons are passed to the LLM.
  const query = buildSearchQuery(doc.title, doc.content ?? '');
  if (!query) return [];

  const hits = await trail.searchDocuments(query, doc.knowledgeBaseId, doc.tenantId, TOP_K + 1);
  const wikiHits = hits.filter((h) => h.kind === 'wiki' && h.id !== doc.id).slice(0, TOP_K);
  if (wikiHits.length === 0) return [];

  // Fetch full content for each hit — searchDocuments returns highlight
  // snippets only, and the LLM needs the body to reason about the claim.
  const results: ContradictionCandidate[] = [];
  for (const hit of wikiHits) {
    const row = await trail.db
      .select({
        id: documents.id,
        filename: documents.filename,
        path: documents.path,
        title: documents.title,
        content: documents.content,
        version: documents.version,
      })
      .from(documents)
      .where(and(eq(documents.id, hit.id), ne(documents.kind, 'source')))
      .get();
    if (!row || !row.content || row.content.length < MIN_CONTENT_CHARS) continue;
    // F102 — glossary is definitional; never treat as a contradiction
    // counterparty. See subject-side skip in runForEvent for the symmetric
    // guard that fires when the glossary ITSELF is the newly-approved doc.
    if (row.path === '/neurons/' && row.filename === 'glossary.md') continue;
    results.push({
      documentId: row.id,
      filename: row.filename,
      title: row.title,
      content: row.content,
      version: row.version,
    });
  }
  return results;
}

function buildSearchQuery(title: string | null, content: string): string {
  // Pick meaningful tokens: 5+ char words from title + first 500 chars of
  // content, lowercased, deduped. OR them together as FTS5 prefix terms.
  const seed = `${title ?? ''} ${content.slice(0, 500)}`;
  const terms = Array.from(
    new Set(
      seed
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 5),
    ),
  ).slice(0, 8);
  if (terms.length === 0) return '';
  return terms.map((t) => `"${t}"*`).join(' OR ');
}

async function hasExistingFingerprint(
  trail: TrailDatabase,
  kbId: string,
  tenantId: string,
  fingerprint: string,
): Promise<boolean> {
  const row = await trail.db
    .select({ id: queueCandidates.id })
    .from(queueCandidates)
    .where(
      and(
        eq(queueCandidates.knowledgeBaseId, kbId),
        eq(queueCandidates.tenantId, tenantId),
        like(queueCandidates.metadata, `%"lintFingerprint":"${fingerprint}"%`),
      ),
    )
    .get();
  return !!row;
}

// F190.2 — makeCliChecker (claude-cli) + makeAnthropicChecker (direct fetch)
// removed; makeContradictionChecker above now issues one discrete call through
// @broberg/ai-sdk (F199.7: Mistral primary → Mistral fallback, EU).
