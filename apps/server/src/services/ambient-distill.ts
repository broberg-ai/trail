/**
 * F201.11 — ambient distill-compile.
 *
 * Ambient candidates land as a RAW per-window screen dump: ~1/3 real knowledge
 * (decisions, commitments, facts) and ~2/3 noise (tab-lists, UI chrome, code
 * the user was merely reading, OCR fragments). Stored verbatim as Neurons, the
 * noise pollutes memory — fatal once F201.8 auto-approves ambient unattended.
 *
 * This service runs a single cheap LLM pass that EXTRACTS the knowledge and
 * drops the noise, so the candidate the queue stores (and later auto-approves)
 * is clean. A window with no durable knowledge → verdict 'noise' (confidence 0),
 * so it never auto-approves and is prunable in the queue.
 *
 * GDPR: ambient text is personal/client data → the distill routes through the
 * Mistral EU tier only (Paris-hosted), never a US model — the F199 directive.
 * The input is already secret-redacted on-device before it ever reaches here.
 *
 * Ship-dark behind TRAIL_AMBIENT_DISTILL=1. LLM failure → the caller keeps the
 * raw candidate (never lose a capture).
 */
import { AMBIENT_CONNECTOR } from '@trail/shared';
import { ai as defaultAi } from '../lib/ai.js';

const MODEL = process.env.TRAIL_AMBIENT_DISTILL_MODEL ?? 'mistral-small-latest';
/** Coarse confidence for a distilled-knowledge candidate (F201.8 refines). */
const KNOWLEDGE_CONFIDENCE = Number(process.env.TRAIL_AMBIENT_DISTILL_CONFIDENCE ?? 0.8);

export function isAmbientDistillEnabled(): boolean {
  return process.env.TRAIL_AMBIENT_DISTILL === '1';
}

/** True when the candidate's metadata attributes it to ambient capture. */
export function isAmbientCandidate(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  try {
    return (JSON.parse(metadata) as { connector?: string }).connector === AMBIENT_CONNECTOR;
  } catch {
    return false;
  }
}

/** Record the distill verdict on the candidate metadata (audit + F201.8). */
export function stampDistill(metadata: string | null | undefined, verdict: 'knowledge' | 'noise'): string {
  let obj: Record<string, unknown> = {};
  if (metadata) {
    try {
      obj = JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  }
  obj.distill = verdict;
  return JSON.stringify(obj);
}

/** Structural client — the real `ai` satisfies it; tests inject a stub. */
export interface DistillAi {
  chat(args: {
    messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
    override?: { provider: string; model: string; transport?: string };
    fallback?: Array<{ provider: string; model: string; transport?: string }>;
    maxTokens?: number;
    purpose?: string;
    labels?: Record<string, string>;
  }): Promise<{ text: string }>;
}

export interface AmbientDistillInput {
  title: string;
  content: string;
}

export interface AmbientDistillResult {
  verdict: 'knowledge' | 'noise';
  title: string;
  content: string;
  confidence: number;
}

/**
 * Distill one raw ambient capture into extracted knowledge. Returns the input
 * verbatim (unchanged) only via the caller's fallback — on success it returns
 * either the distilled knowledge or a 'noise' verdict.
 */
export async function distillAmbientCapture(
  input: AmbientDistillInput,
  ctx: { tenantId?: string; kbId?: string } = {},
  // The real `ai` client satisfies DistillAi structurally at runtime; the SDK's
  // richer arg type just can't be proven assignable, so the default is cast.
  // Tests inject a plain stub that matches DistillAi directly.
  aiClient: DistillAi = defaultAi as unknown as DistillAi,
): Promise<AmbientDistillResult> {
  const res = await aiClient.chat({
    messages: [{ role: 'user', content: buildDistillPrompt(input.title, input.content) }],
    override: { provider: 'mistral', model: MODEL, transport: 'http' },
    fallback: [{ provider: 'mistral', model: 'mistral-large-latest', transport: 'http' }],
    maxTokens: 700,
    purpose: 'ambient-distill',
    labels: { tenantId: ctx.tenantId ?? '', kbId: ctx.kbId ?? '' },
  });
  return parseDistill(res.text, input);
}

export function buildDistillPrompt(title: string, content: string): string {
  const excerpt = content.length > 6000 ? content.slice(0, 6000) + '\n[afkortet]' : content;
  return `Du er en videns-destillator for et personligt "second brain".
Du får et kort øjebliksbillede (ca. 30 sek.) af hvad der var på en persons arbejdsskærm: app-fokus + OCR-tekst fra vinduerne.

Udtræk KUN holdbar, personlig viden:
- beslutninger personen har truffet
- aftaler / commitments (hvad de har lovet, næste skridt)
- fakta om projekter, personer eller kunder
- konklusioner

IGNORÉR fuldstændigt:
- UI-krom, menuer, fane-lister, knapper, navigation
- kode-snippets, funktioner, config eller artikel-tekst der blot VISES på skærmen — det er noget personen LÆSER, IKKE deres viden. Medtag KUN hvis personen i første person beslutter/vælger/lover noget om det. Tvivl = udelad.
- OCR-fragmenter og halve ord

Vær konservativ: hellere udelade end at opdigte at personen "har implementeret" noget du kun ser som kode på skærmen.

Hvis der IKKE er nogen holdbar personlig viden i øjebliksbilledet, svar PRÆCIST med kun linjen:
VERDICT: NOISE

Ellers svar i PRÆCIS dette format (og intet andet):
VERDICT: KNOWLEDGE
TITEL: <kort dansk titel, max 80 tegn>
VIDEN:
- <ét kort videns-udsagn>
- <ét kort videns-udsagn>
(1-4 punkter, i personens eget sprog, ingen krom)

Øjebliksbillede:
---
${title}

${excerpt}
---`;
}

/**
 * Parse the strict distill format. Robust to minor LLM drift: a NOISE verdict
 * anywhere → noise; otherwise extract TITEL + VIDEN bullets, falling back to
 * the raw body of the reply if the format wobbled.
 */
export function parseDistill(text: string, input: AmbientDistillInput): AmbientDistillResult {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  if (upper.includes('VERDICT: NOISE') || upper.startsWith('NOISE')) {
    return { verdict: 'noise', title: input.title, content: '', confidence: 0 };
  }

  // Title: the TITEL: line, else keep the incoming title.
  const titleMatch = trimmed.match(/^TITEL:\s*(.+)$/im);
  const title = (titleMatch?.[1] ?? input.title).trim().slice(0, 120) || input.title;

  // Knowledge: everything under VIDEN:, else the reply minus the header lines.
  let content: string;
  const videnIdx = trimmed.search(/^VIDEN:\s*$/im);
  if (videnIdx >= 0) {
    content = trimmed.slice(videnIdx).replace(/^VIDEN:\s*$/im, '').trim();
  } else {
    content = trimmed
      .replace(/^VERDICT:\s*KNOWLEDGE\s*$/im, '')
      .replace(/^TITEL:.*$/im, '')
      .trim();
  }

  // Empty knowledge body → treat as noise (the LLM said KNOWLEDGE but gave
  // nothing usable). Never emit an empty-content candidate.
  if (!content) {
    return { verdict: 'noise', title: input.title, content: '', confidence: 0 };
  }
  return { verdict: 'knowledge', title, content, confidence: KNOWLEDGE_CONFIDENCE };
}
