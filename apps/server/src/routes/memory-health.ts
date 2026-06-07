/**
 * F182.7 — Memory Health API (engine-side; the admin SPA proxies to it).
 *
 * Three reads + one write backing the Memory Health tab:
 *   GET  /knowledge-bases/:kbId/memory-health  → confidence histogram (5
 *        buckets) + decaying list + superseded chains for one KB.
 *   GET  /memory-health/decay-rates            → effective per-type τ (tenant
 *        overrides merged over defaults) + the defaults for reference.
 *   PUT  /memory-health/decay-rates            → persist τ overrides to
 *        tenants.settings_json; returns the merged effective rates.
 *
 * No LLM, pure SQL. Decay-rate config is tenant-scoped (one decay job per
 * tenant); the histogram/lists are KB-scoped.
 */
import { Hono } from 'hono';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';
import { resolveKbId } from '@trail/core';
import { DEFAULT_DECAY_RATES } from '../services/confidence.js';
import {
  loadDecayRates,
  saveDecayRates,
  loadMemoryDecayEnabled,
  saveMemoryDecayEnabled,
} from '../services/tenant-settings.js';
import { runDecayPass } from '../services/confidence-decay.js';
import { getMemoryHealth } from '../services/memory-health.js';

export const memoryHealthRoutes = new Hono();
memoryHealthRoutes.use('*', requireAuth);

memoryHealthRoutes.get('/knowledge-bases/:kbId/memory-health', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);
  return c.json(await getMemoryHealth(trail, tenant.id, kbId));
});

memoryHealthRoutes.get('/memory-health/decay-rates', async (c) => {
  const trail = getTrail(c);
  const rates = await loadDecayRates(trail);
  const decayEnabled = await loadMemoryDecayEnabled(trail);
  return c.json({ rates, defaults: DEFAULT_DECAY_RATES, decayEnabled });
});

memoryHealthRoutes.put('/memory-health/decay-rates', async (c) => {
  const trail = getTrail(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    rates?: Record<string, number>;
  };
  const rates = await saveDecayRates(trail, body.rates ?? {});
  return c.json({ rates, defaults: DEFAULT_DECAY_RATES });
});

// F195 — toggle memory-decay for this tenant (default OFF). Disabling resets
// every Neuron to full confidence right away: a decay pass with the flag off
// holds all Neurons at 1.0.
memoryHealthRoutes.put('/memory-health/decay-enabled', async (c) => {
  const trail = getTrail(c);
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
  const enabled = body.enabled === true;
  await saveMemoryDecayEnabled(trail, enabled);
  if (!enabled) {
    await runDecayPass(trail);
  }
  return c.json({ decayEnabled: enabled });
});
