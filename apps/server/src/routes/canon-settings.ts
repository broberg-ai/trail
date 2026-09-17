/**
 * F275.2 — de to switches, læst og skrevet ét sted.
 *
 * GET   /api/v1/knowledge-bases/:kbId/canon-settings
 * PATCH /api/v1/knowledge-bases/:kbId/canon-settings
 *
 * Svaret bærer IKKE bare de to gemte værdier. Det bærer også den UDREGNEDE
 * tilstand pr. connector — `overriddenByBrain` — fordi AC#3 kræver at brugeren kan SE
 * at en connector-kontakt der står på TIL er sat ud af kraft af hovedafbryderen.
 * Regnede panelet det ud selv, ville to sites kunne blive uenige, og uenigheden
 * ville vise sig som en kontakt der lyver om sin egen virkning.
 *
 * Konnektor-listen er MÅLT på Brain'ens egne kilder, ikke pickedUp fra det statiske
 * register i @trail/shared. `broberg-ai-site-sync` — den connector hele featuren
 * blev født af — står ikke i registret, så en liste derfra ville mangle netop den
 * kontakt ejeren har brug for.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { knowledgeBases } from '@trail/db';
import { and, eq, sql } from 'drizzle-orm';
import { resolveKbId } from '@trail/core';
import {
  CONNECTORS,
  connectorState,
  readDisabledConnectors,
  writeDisabledConnectors,
  type CanonSwitches,
} from '@trail/shared';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';
import type { AppBindings } from '../app.js';

export const canonSettingsRoutes = new Hono<AppBindings>();

canonSettingsRoutes.use('*', requireAuth);

const PatchBodySchema = z
  .object({
    /** Hovedafbryderen. */
    brain: z.boolean().optional(),
    /** Én konnektors kontakt. Fraværende id'er røres ikke. */
    connector: z.object({ id: z.string().min(1), canon: z.boolean() }).optional(),
  })
  .strict()
  .refine((b) => b.brain !== undefined || b.connector !== undefined, {
    message: 'intet at ændre',
  });

/** Konnektor-id'er der faktisk optræder på denne Brains kilder, med counts. */
async function measuredConnectors(
  trail: { db: { all: (q: unknown) => Promise<unknown[]> } },
  kbId: string,
): Promise<{ id: string; sourceCount: number }[]> {
  // json_extract frem for LIKE: en connector hvis id er en delstreng af en anden
  // ville ellers tælle med i den forkerte række.
  const rows = (await trail.db.all(sql`
    SELECT json_extract(metadata, '$.connector') AS id, COUNT(*) AS n
    FROM documents
    WHERE knowledge_base_id = ${kbId}
      AND json_extract(metadata, '$.connector') IS NOT NULL
    GROUP BY 1
    ORDER BY n DESC
  `)) as { id: unknown; n: unknown }[];
  return rows
    .filter((r) => typeof r.id === 'string' && r.id.length > 0)
    .map((r) => ({ id: r.id as string, sourceCount: Number(r.n) || 0 }));
}

function build(switches: CanonSwitches, measured: { id: string; sourceCount: number }[]) {
  // De gemte FRA-id'er tages med selv om ingen source bærer dem lige nu — ellers
  // ville en kontakt brugeren selv har slået fra forsvinde fra skærmen, og han
  // ville ikke kunne slå den til igen.
  const ids = Array.from(new Set([...measured.map((m) => m.id), ...switches.disabledConnectors]));
  const counts = new Map(measured.map((m) => [m.id, m.sourceCount]));
  return {
    brain: switches.brain,
    disabledConnectors: switches.disabledConnectors,
    connectors: ids.map((id) => {
      const t = connectorState(switches, id);
      return {
        id,
        label: (CONNECTORS as Record<string, { label?: string } | undefined>)[id]?.label ?? id,
        sourceCount: counts.get(id) ?? 0,
        ownSwitch: t.ownSwitch,
        overriddenByBrain: t.overriddenByBrain,
        effective: t.effective,
      };
    }),
  };
}

async function readSwitches(trail: ReturnType<typeof getTrail>, kbId: string, tenantId: string) {
  const kb = await trail.db
    .select({
      brain: knowledgeBases.newVersionIsCanon,
      off: knowledgeBases.canonOffConnectors,
    })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenantId)))
    .get();
  if (!kb) return null;
  return { brain: kb.brain, disabledConnectors: readDisabledConnectors(kb.off) } as CanonSwitches;
}

canonSettingsRoutes.get('/knowledge-bases/:kbId/canon-settings', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  const switches = await readSwitches(trail, kbId, tenant.id);
  if (!switches) return c.json({ error: 'Knowledge base not found' }, 404);

  return c.json(build(switches, await measuredConnectors(trail as never, kbId)));
});

canonSettingsRoutes.patch('/knowledge-bases/:kbId/canon-settings', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  const parsed = PatchBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }

  const current = await readSwitches(trail, kbId, tenant.id);
  if (!current) return c.json({ error: 'Knowledge base not found' }, 404);

  const brain = parsed.data.brain ?? current.brain;
  let disabled = [...current.disabledConnectors];
  if (parsed.data.connector) {
    const { id, canon } = parsed.data.connector;
    disabled = canon ? disabled.filter((x) => x !== id) : [...disabled, id];
  }

  await trail.db
    .update(knowledgeBases)
    .set({
      newVersionIsCanon: brain,
      canonOffConnectors: writeDisabledConnectors(disabled),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenant.id)))
    .run();

  // LÆS TILBAGE fra databasen frem for at ekko'e det vi lige sendte. En
  // kolonne ORM'en taber lydløst ser ellers ud som en gemning der lykkedes —
  // og det er nøjagtig den fejlform husreglen om gem-bevis findes for.
  const after = await readSwitches(trail, kbId, tenant.id);
  if (!after) return c.json({ error: 'Knowledge base not found' }, 404);

  return c.json(build(after, await measuredConnectors(trail as never, kbId)));
});
