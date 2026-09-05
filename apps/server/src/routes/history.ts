/**
 * F253.1 — hændelses-loggens dækning, målt på den DATABASE DER FAKTISK SERVERER.
 *
 * DENNE RUTE FINDES PÅ GRUND AF EN MÅLT FEJL, ikke af principielle grunde.
 *
 * Dækningen blev først bygget som et script der tager en FILSTI
 * (`verify-event-log-coverage.ts /data/<slug>/trail.db`). Det virkede, og det
 * målte den forkerte database: efter F222.3 serveres broberg-ai og
 * sanne-andersen fra sqld på trail-db-001 (`TRAIL_DB_REMOTE`), mens den gamle
 * fil bliver liggende på motorens disk — med vilje, indtil ejeren selv har
 * verificeret flytningen.
 *
 * Så scriptet fandt 2 revner, reparerede dem, og læste 0 tilbage — alt sammen
 * i en kopi ingen bruger. Rapporten var internt konsistent og handlede om
 * ingenting. Den samme fil fik mig også til at melde 37 dubletter i en base
 * hvor der er nul.
 *
 * EN FILSTI ER ET GÆT PÅ HVOR DATA ER. `getTrail(c)` er et OPSLAG. Ruten her
 * bruger tenant-poolen, altså præcis den forbindelse der besvarer alle andre
 * kald — så spørgsmålet «hvilken database målte du?» ikke kan stilles igen.
 */
import { Hono } from 'hono';
import { auditEventLogCoverage, repairEventLogCoverage } from '@trail/core';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';

export const historyRoutes = new Hono();

historyRoutes.use('*', requireAuth);

/** Mål dækningen. Rører intet. */
historyRoutes.get('/history/coverage', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = c.req.query('knowledgeBaseId');

  const report = await auditEventLogCoverage(trail, tenant.id, kbId);
  return c.json({
    tenant: tenant.slug,
    databasePath: trail.path, // hvilken base der BLEV målt — aldrig underforstået
    ...report,
  });
});

/**
 * Luk revnerne. Additiv: der lægges en indhentnings-hændelse pr. skredet
 * Neuron, intet overskrives, og intet dokument ændres.
 *
 * Svaret bærer BÅDE reparationens eget tal OG en frisk gen-måling, fordi de er
 * to forskellige påstande: «jeg skrev 2 rækker» og «basen har nu 0 revner».
 * Kun den anden er den der betyder noget.
 */
historyRoutes.post('/history/coverage/repair', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = c.req.query('knowledgeBaseId');

  const before = await auditEventLogCoverage(trail, tenant.id, kbId);
  const repaired = await repairEventLogCoverage(trail, tenant.id, before.gaps);
  const after = await auditEventLogCoverage(trail, tenant.id, kbId);

  return c.json({
    tenant: tenant.slug,
    databasePath: trail.path,
    gapsBefore: before.gaps.length,
    eventsWritten: repaired,
    gapsAfter: after.gaps.length,
    intact: after.intact,
  });
});
