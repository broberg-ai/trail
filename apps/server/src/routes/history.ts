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
import {
  auditEventLogCoverage, repairEventLogCoverage,
  takeBrainVersion, listBrainVersions, getBrainVersion,
  diffBrainVersion, restoreBrainVersion, resolveKbId, coverage,
} from '@trail/core';
import { sweepKb } from '../services/indexer.js';
import { chunkText, storeChunks } from '../services/chunker.js';
import { requireAuth, getTenant, getTrail, getUser } from '../middleware/auth.js';

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

/**
 * F253.2 — mærkerne.
 *
 * `knowledgeBaseId` er PÅKRÆVET her, i modsætning til dæknings-ruten: et mærke
 * hører til én videnbase, og et mærke uden KB ville være en grænse for
 * ingenting.
 */
historyRoutes.get('/knowledge-bases/:kbId/brain-versions', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);
  return c.json({ versions: await listBrainVersions(trail, tenant.id, kbId) });
});

historyRoutes.post('/knowledge-bases/:kbId/brain-versions', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const user = getUser(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  const body: { label?: string; reason?: string } = await c.req
    .json<{ label?: string; reason?: string }>()
    .catch(() => ({}));
  const label = (body.label ?? '').trim();
  if (!label) return c.json({ error: 'label er påkrævet — et mærke uden navn er et mærke ingen finder igen' }, 400);

  const version = await takeBrainVersion(trail, {
    tenantId: tenant.id,
    knowledgeBaseId: kbId,
    label,
    reason: (body.reason as 'manual') ?? 'manual',
    createdBy: user?.id ?? null,
  });
  return c.json(version, 201);
});

/** F253.3 — hvad ville en tilbagerulning gøre? Rører intet. */
historyRoutes.get('/brain-versions/:id/diff', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  try {
    const d = await diffBrainVersion(trail, tenant.id, c.req.param('id'));
    return c.json(d);
  } catch (err) {
    return c.json({ error: String((err as Error).message) }, 404);
  }
});

/**
 * F253.3 — udfør den.
 *
 * Søgeindekset bygges om for hver rørt side. Kernen kan ikke selv gøre det
 * (chunker'en bor her i serveren), så den tager det som et tilbagekald — og
 * svaret bærer `searchIndexStale`, så en kalder der glemte det ikke kan tro
 * indekset er friskt.
 */
historyRoutes.post('/brain-versions/:id/restore', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const user = getUser(c);
  try {
    const version = await getBrainVersion(trail, tenant.id, c.req.param('id'));
    if (!version) return c.json({ error: 'Ukendt hjerne-version' }, 404);

    const result = await restoreBrainVersion(trail, tenant.id, c.req.param('id'), {
      actorId: user?.id ?? null,
      rebuildChunks: async (documentId, content) => {
        const chunks = content.trim() ? chunkText(content) : [];
        await storeChunks(trail, documentId, tenant.id, version.knowledgeBaseId, chunks);
      },
    });
    return c.json(result);
  } catch (err) {
    // En afvisning her er en FORVENTET tilstand (ufuldstændig log), ikke et
    // nedbrud — den skal kunne læses af et menneske, ikke logges som 500.
    return c.json({ error: String((err as Error).message) }, 409);
  }
});

/**
 * F254.1 — indekseringens tilstand og bagfyldning.
 *
 * `GET  /knowledge-bases/:kbId/index` — hvor stor en del er dækket?
 * `POST /knowledge-bases/:kbId/index` — fej: indeksér alt der mangler eller
 *   er forældet. Er både bagfyldningen OG det kontinuerlige sikkerhedsnet, og
 *   det er med vilje samme kode: en fejer der kun bruges én gang bliver aldrig
 *   afprøvet, og en der kører hver dag er bevist hver dag.
 */
historyRoutes.get('/knowledge-bases/:kbId/index', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);
  const cov = await coverage(trail, tenant.id, kbId);
  return c.json({ knowledgeBaseId: kbId, databasePath: trail.path, ...cov });
});

historyRoutes.post('/knowledge-bases/:kbId/index', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  // ?max= gør det muligt at måle prisen på ti stykker før resten køres. Et tal
  // ingen har set før en kørsel på 6.796 Neuroner er et gæt.
  const maxRaw = Number(c.req.query('max'));
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : undefined;

  const before = await coverage(trail, tenant.id, kbId);
  const r = await sweepKb(trail, tenant.id, kbId, { max });
  return c.json({
    knowledgeBaseId: kbId,
    databasePath: trail.path,
    before: {
      embedded: before.embedded, chunks: before.chunks, ratio: before.ratio,
      byKind: before.byKind,
    },
    ...r,
    costUsd: r.costCents / 100,
    // Både «jeg skrev N» og «basen er nu dækket X» — to forskellige påstande,
    // og kun den anden betyder noget.
  });
});
