/**
 * F152 — Per-KB ingest backend settings.
 *
 * GET /api/v1/knowledge-bases/:kbId/ingest-settings  — current effective
 *   resolution: per-KB columns + env-derived fallback. Returns overrides
 *   + the chain that resolveIngestChain() would produce right now so the
 *   UI can render preview without re-implementing chain logic client-side.
 *
 * PATCH /api/v1/knowledge-bases/:kbId/ingest-settings  — curator-set
 *   override. Body fields:
 *     ingestBackend?: 'claude-cli' | 'openrouter' | null
 *     ingestModel?: string | null
 *     ingestFallbackChain?: ChainStep[] | null
 *   Setting any field to null clears that override (chain resolution
 *   falls back to env / hardcoded default).
 *
 * Mirrors F159's chat-settings.ts for the chat side. Lives in its own
 * file rather than under ingest.ts because settings-mgmt is a separate
 * admin surface from the ingest pipeline itself.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { knowledgeBases } from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { resolveKbId } from '@trail/core';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';
import {
  resolveIngestChain,
  type ChainStep,
} from '../services/ingest/chain.js';

export const ingestSettingsRoutes = new Hono();

ingestSettingsRoutes.use('*', requireAuth);

const ChainStepSchema = z.object({
  backend: z.enum(['claude-cli', 'openrouter']),
  model: z.string().min(1),
  translationModel: z.string().min(1).optional(),
});

const PatchBodySchema = z
  .object({
    ingestBackend: z.enum(['claude-cli', 'openrouter']).nullable().optional(),
    ingestModel: z.string().min(1).nullable().optional(),
    ingestFallbackChain: z.array(ChainStepSchema).min(1).nullable().optional(),
  })
  .strict();

ingestSettingsRoutes.get('/knowledge-bases/:kbId/ingest-settings', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  const kb = await trail.db
    .select({
      ingestBackend: knowledgeBases.ingestBackend,
      ingestModel: knowledgeBases.ingestModel,
      ingestFallbackChain: knowledgeBases.ingestFallbackChain,
    })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenant.id)))
    .get();
  if (!kb) return c.json({ error: 'Knowledge base not found' }, 404);

  const effectiveChain = resolveIngestChain(
    {
      ingestBackend: kb.ingestBackend ?? null,
      ingestModel: kb.ingestModel ?? null,
      ingestFallbackChain: kb.ingestFallbackChain ?? null,
    },
    {
      INGEST_BACKEND: process.env.INGEST_BACKEND,
      INGEST_MODEL: process.env.INGEST_MODEL,
      INGEST_FALLBACK_CHAIN: process.env.INGEST_FALLBACK_CHAIN,
    },
  );

  return c.json({
    overrides: {
      ingestBackend: kb.ingestBackend,
      ingestModel: kb.ingestModel,
      ingestFallbackChain: kb.ingestFallbackChain ? safeParse(kb.ingestFallbackChain) : null,
    },
    effectiveChain,
  });
});

ingestSettingsRoutes.patch('/knowledge-bases/:kbId/ingest-settings', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }

  const update: Record<string, string | null> = {};
  if ('ingestBackend' in parsed.data) {
    update.ingestBackend = parsed.data.ingestBackend ?? null;
  }
  if ('ingestModel' in parsed.data) {
    update.ingestModel = parsed.data.ingestModel ?? null;
  }
  if ('ingestFallbackChain' in parsed.data) {
    update.ingestFallbackChain = parsed.data.ingestFallbackChain
      ? JSON.stringify(parsed.data.ingestFallbackChain)
      : null;
  }

  if (Object.keys(update).length === 0) {
    return c.json({ error: 'no_fields_to_update' }, 400);
  }

  await trail.db
    .update(knowledgeBases)
    .set(update)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenant.id)))
    .run();

  const kb = await trail.db
    .select({
      ingestBackend: knowledgeBases.ingestBackend,
      ingestModel: knowledgeBases.ingestModel,
      ingestFallbackChain: knowledgeBases.ingestFallbackChain,
    })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenant.id)))
    .get();

  const effectiveChain = resolveIngestChain(
    {
      ingestBackend: kb?.ingestBackend ?? null,
      ingestModel: kb?.ingestModel ?? null,
      ingestFallbackChain: kb?.ingestFallbackChain ?? null,
    },
    {
      INGEST_BACKEND: process.env.INGEST_BACKEND,
      INGEST_MODEL: process.env.INGEST_MODEL,
      INGEST_FALLBACK_CHAIN: process.env.INGEST_FALLBACK_CHAIN,
    },
  );

  return c.json({
    overrides: {
      ingestBackend: kb?.ingestBackend ?? null,
      ingestModel: kb?.ingestModel ?? null,
      ingestFallbackChain: kb?.ingestFallbackChain ? safeParse(kb.ingestFallbackChain) : null,
    },
    effectiveChain,
  });
});

function safeParse(s: string): ChainStep[] | null {
  try {
    return JSON.parse(s) as ChainStep[];
  } catch {
    return null;
  }
}
