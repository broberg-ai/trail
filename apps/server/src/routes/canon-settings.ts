/**
 * F275.2 — de to kontakter, læst og skrevet ét sted.
 *
 * GET   /api/v1/knowledge-bases/:kbId/canon-settings
 * PATCH /api/v1/knowledge-bases/:kbId/canon-settings
 *
 * Svaret bærer IKKE bare de to gemte værdier. Det bærer også den UDREGNEDE
 * tilstand pr. konnektor — `satUdAfKraft` — fordi AC#3 kræver at brugeren kan SE
 * at en konnektor-kontakt der står på TIL er sat ud af kraft af hovedafbryderen.
 * Regnede panelet det ud selv, ville to steder kunne blive uenige, og uenigheden
 * ville vise sig som en kontakt der lyver om sin egen virkning.
 *
 * Konnektor-listen er MÅLT på Brain'ens egne kilder, ikke taget fra det statiske
 * register i @trail/shared. `broberg-ai-site-sync` — den konnektor hele featuren
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
  konnektorTilstand,
  laesSlukkedeKonnektorer,
  skrivSlukkedeKonnektorer,
  type KanonKontakter,
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
    konnektor: z.object({ id: z.string().min(1), kanon: z.boolean() }).optional(),
  })
  .strict()
  .refine((b) => b.brain !== undefined || b.konnektor !== undefined, {
    message: 'intet at ændre',
  });

/** Konnektor-id'er der faktisk optræder på denne Brains kilder, med antal. */
async function maaltKonnektorer(
  trail: { db: { all: (q: unknown) => Promise<unknown[]> } },
  kbId: string,
): Promise<{ id: string; antalKilder: number }[]> {
  // json_extract frem for LIKE: en konnektor hvis id er en delstreng af en anden
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
    .map((r) => ({ id: r.id as string, antalKilder: Number(r.n) || 0 }));
}

function byg(kontakter: KanonKontakter, maalte: { id: string; antalKilder: number }[]) {
  // De gemte FRA-id'er tages med selv om ingen kilde bærer dem lige nu — ellers
  // ville en kontakt brugeren selv har slået fra forsvinde fra skærmen, og han
  // ville ikke kunne slå den til igen.
  const ids = Array.from(new Set([...maalte.map((m) => m.id), ...kontakter.slukkedeKonnektorer]));
  const antal = new Map(maalte.map((m) => [m.id, m.antalKilder]));
  return {
    brain: kontakter.brain,
    slukkedeKonnektorer: kontakter.slukkedeKonnektorer,
    konnektorer: ids.map((id) => {
      const t = konnektorTilstand(kontakter, id);
      return {
        id,
        label: (CONNECTORS as Record<string, { label?: string } | undefined>)[id]?.label ?? id,
        antalKilder: antal.get(id) ?? 0,
        egenKontakt: t.egenKontakt,
        satUdAfKraft: t.satUdAfKraft,
        virker: t.virker,
      };
    }),
  };
}

async function laes(trail: ReturnType<typeof getTrail>, kbId: string, tenantId: string) {
  const kb = await trail.db
    .select({
      brain: knowledgeBases.newVersionIsCanon,
      off: knowledgeBases.canonOffConnectors,
    })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenantId)))
    .get();
  if (!kb) return null;
  return { brain: kb.brain, slukkedeKonnektorer: laesSlukkedeKonnektorer(kb.off) } as KanonKontakter;
}

canonSettingsRoutes.get('/knowledge-bases/:kbId/canon-settings', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  const kontakter = await laes(trail, kbId, tenant.id);
  if (!kontakter) return c.json({ error: 'Knowledge base not found' }, 404);

  return c.json(byg(kontakter, await maaltKonnektorer(trail as never, kbId)));
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

  const nu = await laes(trail, kbId, tenant.id);
  if (!nu) return c.json({ error: 'Knowledge base not found' }, 404);

  const brain = parsed.data.brain ?? nu.brain;
  let slukkede = [...nu.slukkedeKonnektorer];
  if (parsed.data.konnektor) {
    const { id, kanon } = parsed.data.konnektor;
    slukkede = kanon ? slukkede.filter((x) => x !== id) : [...slukkede, id];
  }

  await trail.db
    .update(knowledgeBases)
    .set({
      newVersionIsCanon: brain,
      canonOffConnectors: skrivSlukkedeKonnektorer(slukkede),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenant.id)))
    .run();

  // LÆS TILBAGE fra databasen frem for at ekko'e det vi lige sendte. En
  // kolonne ORM'en taber lydløst ser ellers ud som en gemning der lykkedes —
  // og det er nøjagtig den fejlform husreglen om gem-bevis findes for.
  const efter = await laes(trail, kbId, tenant.id);
  if (!efter) return c.json({ error: 'Knowledge base not found' }, 404);

  return c.json(byg(efter, await maaltKonnektorer(trail as never, kbId)));
});
