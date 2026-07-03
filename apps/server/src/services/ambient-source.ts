/**
 * F201.13 — ambient raw material as first-class Trail **Sources**.
 *
 * Ambient capture (dictated speech, screen OCR, screen images) is RAW material —
 * exactly what Trail already models as a Source (the input that compiles into
 * curated wiki Neurons). "Det ER JO en Source" (Christian, 2026-07-03). So instead
 * of the old candidate-first path (which let F201.11 distill REWRITE the words and
 * discarded the raw), an ambient capture becomes a `kind='source'` document,
 * stored VERBATIM and permanent. The distill runs later as the source's *compile*
 * step, emitting a separate Neuron linked back via `document_references` (Phase 2)
 * — it never touches this source body.
 *
 * Zero-migration: `documents.kind` already has 'source'; `documents.file_type` is
 * open text, so the three new types need no schema change.
 *
 * Ship-dark behind TRAIL_AMBIENT_SOURCES=1 (house rule: a new path stays inert
 * until its env flag is set). The old /queue/candidates path keeps working until
 * the source path is proven (no naked cutover — harness contract).
 */
import { documents, type TrailDatabase } from '@trail/db';
import { eq, sql } from 'drizzle-orm';
import { chunkText, storeChunks } from './chunker.js';

/** The three ambient source fileTypes (open-text on `documents.file_type`). */
export const AMBIENT_SOURCE_FILE_TYPES = ['ambient-speech', 'ambient-ocr', 'ambient-image'] as const;
export type AmbientSourceFileType = (typeof AMBIENT_SOURCE_FILE_TYPES)[number];

/** Ship-dark gate — the source-create path is inert until this is set. */
export function isAmbientSourcesEnabled(): boolean {
  return process.env.TRAIL_AMBIENT_SOURCES === '1';
}

export interface CreateAmbientSourceInput {
  fileType: AmbientSourceFileType;
  /** Raw material, VERBATIM. For speech this is the ordbog-corrected true words. */
  content: string;
  title?: string;
  /** Apple's pre-correction STT output — kept for debug / training / mining. */
  rawTranscript?: string;
  /** 'audio' | 'ocr' | 'image' — which capture produced it. */
  source?: string;
}

/**
 * Create a `kind='source'` document from raw ambient material. The content is
 * stored byte-for-byte (never distilled here). Returns the inserted document row.
 */
export async function createAmbientSource(
  trail: TrailDatabase,
  ctx: { tenantId: string; kbId: string; userId: string },
  input: CreateAmbientSourceInput,
) {
  const id = crypto.randomUUID();
  const filename = `${input.fileType}-${Date.now()}.md`;
  const title = input.title?.trim() || firstLine(input.content) || input.fileType;
  const metadata = JSON.stringify({
    connector: 'trail-ambient-capture',
    source: input.source ?? null,
    ...(input.rawTranscript ? { rawTranscript: input.rawTranscript } : {}),
  });

  await trail.db
    .insert(documents)
    .values({
      id,
      tenantId: ctx.tenantId,
      knowledgeBaseId: ctx.kbId,
      userId: ctx.userId,
      kind: 'source',
      filename,
      title,
      path: '/',
      fileType: input.fileType,
      fileSize: Buffer.byteLength(input.content, 'utf8'),
      // Raw text is already complete — there is no file-format extraction step,
      // so 'ready' is honest. The Phase 2 distill compile emits a SEPARATE Neuron
      // and does NOT rewrite this source body (that's the whole point).
      status: 'ready',
      content: input.content,
      metadata,
      version: 1,
      // F145 — inline per-KB seq (same pattern as uploads.ts / candidates.ts).
      seq: sql<number>`COALESCE((SELECT MAX(${documents.seq}) FROM ${documents} WHERE ${documents.knowledgeBaseId} = ${ctx.kbId}), 0) + 1`,
    })
    .run();

  // FTS so the raw is searchable in the same Sources surface as uploads.
  if (input.content.trim()) {
    await storeChunks(trail, id, ctx.tenantId, ctx.kbId, chunkText(input.content));
  }

  return trail.db.select().from(documents).where(eq(documents.id, id)).get();
}

function firstLine(s: string): string | undefined {
  const line = s.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  return line ? line.slice(0, 120) : undefined;
}
