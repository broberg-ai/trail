/**
 * F263.1 — jobkøens HTTP-flade.
 *
 * En arbejder (i dag `/local-ingest`-skillen, senere Mac-klienten eller den
 * lokale webserver) claimer arbejde, holder det i live med hjerteslag, og
 * afleverer resultatet gennem de endepunkter der ALLEREDE findes.
 *
 * DER KOMMER INGEN NY SKRIVEVEJ IND I BASEN. Resultatet går stadig gennem
 * `/wiki-write` og `/local-compiled` — de samme ruter den håndkørte vej har
 * brugt hele aftenen. Det er dét der gør at alle eksisterende spærrer
 * (publikums-filter, hemmeligheds-scrubning, kandidat-køen, auto-godkendelse)
 * stadig gælder uden at nogen skal huske at kopiere dem herind. En parallel
 * skrivevej med sine egne kopier af de spærrer er præcis hvordan man lækker
 * en intern Neuron til en kundes chat.
 *
 * SHIP DARK: `awaiting_local_compile` og dens to gamle endepunkter er U RØRTE.
 * Køen lever ved siden af indtil en klient beviseligt drænner den i drift.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';
import {
  claimCompileJobs, heartbeatCompileJob, compileQueueStatus, COMPILE_LEASE_MS,
} from '../services/compile-queue.js';

export const compileJobRoutes = new Hono();

compileJobRoutes.use('/compile-jobs/*', requireAuth);

/**
 * Arbejderens navn.
 *
 * Et menneskeligt navn, ikke et tilfældigt id: det ender i brugerfladen som
 * «kompileres på Christians MacBook» (F263.4). Længden er begrænset så et
 * felt der ved et uheld får hele en fejlbesked ikke kan fylde en kolonne.
 */
const WorkerSchema = z.object({
  worker: z.string().min(1).max(80),
  limit: z.number().int().min(1).max(25).optional(),
});

/** POST /api/v1/compile-jobs/claim — tag arbejde. */
compileJobRoutes.post('/compile-jobs/claim', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const parsed = WorkerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'worker (1-80 tegn) er påkrævet', detail: parsed.error.issues }, 400);
  }

  const jobs = await claimCompileJobs(trail, tenant.id, {
    worker: parsed.data.worker,
    limit: parsed.data.limit ?? 1,
  });

  // PROMPTEN LÆGGES IKKE MED — der peges på det endepunkt der allerede
  // bygger den. `/local-ingest` henter den fra netop den adresse i dag, og en
  // anden vej til samme prompt ville være to steder at rette
  // kompilerings-kontrakten. Svaret bærer adressen så arbejderen ikke skal
  // konstruere den selv.
  const medPrompt = jobs.map((j) => ({
    ...j,
    promptUrl: `/api/v1/knowledge-bases/${j.knowledgeBaseId}/documents/${j.id}/compile-prompt`,
    completeUrl: `/api/v1/documents/${j.id}/local-compiled`,
  }));

  return c.json({ jobs: medPrompt, leaseMs: COMPILE_LEASE_MS }, 200);
});

/** POST /api/v1/compile-jobs/:id/heartbeat — jeg arbejder stadig. */
compileJobRoutes.post('/compile-jobs/:id/heartbeat', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const parsed = z.object({ worker: z.string().min(1).max(80) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'worker er påkrævet' }, 400);

  const r = await heartbeatCompileJob(trail, tenant.id, {
    docId: c.req.param('id'),
    worker: parsed.data.worker,
  });

  // 409 og ikke 404: jobbet FINDES sandsynligvis, det er bare ikke dit
  // længere. En arbejder der får 404 leder efter en forsvunden kilde; en der
  // får 409 ved at den er blevet overtaget og skal stoppe.
  if (!r.ok) {
    return c.json({
      error: 'jobbet er ikke (længere) dit',
      detail: 'Leasen er udløbet og en anden arbejder kan have overtaget det. Stop arbejdet på denne kilde.',
    }, 409);
  }
  return c.json({ ok: true, leaseUntil: r.leaseUntil }, 200);
});

/** GET /api/v1/compile-jobs/status — hvad venter, hvem arbejder. */
compileJobRoutes.get('/compile-jobs/status', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  return c.json(await compileQueueStatus(trail, tenant.id), 200);
});
