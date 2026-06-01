/**
 * F182.7 — per-tenant settings (tenants.settings_json).
 *
 * Currently the single source for per-Neuron-type decay rates (τ, days): the
 * Memory Health sliders write here and the F182.3 decay job reads here. A
 * missing/blank value for a type falls back to DEFAULT_DECAY_RATES, so the
 * stored object only needs to carry the types a curator actually tuned.
 */
import { tenants, type TrailDatabase } from '@trail/db';
import { eq } from 'drizzle-orm';
import type { NeuronType } from '@trail/shared';
import { DEFAULT_DECAY_RATES } from './confidence.js';

const VALID_TYPES = Object.keys(DEFAULT_DECAY_RATES) as NeuronType[];
const MIN_TAU = 1;
const MAX_TAU = 3650; // 10y — generous ceiling; pinning is the "never decays" path.

function parseSettings(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The tenant's effective decay rates: stored overrides merged over defaults. */
export async function loadDecayRates(trail: TrailDatabase): Promise<Record<NeuronType, number>> {
  const row = await trail.db.select({ s: tenants.settingsJson }).from(tenants).limit(1).get();
  const merged = { ...DEFAULT_DECAY_RATES };
  const stored = parseSettings(row?.s ?? null).decayRates as Record<string, unknown> | undefined;
  if (stored) {
    for (const type of VALID_TYPES) {
      const v = stored[type];
      if (typeof v === 'number' && Number.isFinite(v) && v >= MIN_TAU) {
        merged[type] = Math.min(MAX_TAU, Math.round(v));
      }
    }
  }
  return merged;
}

/**
 * Persist per-type τ overrides into tenants.settings_json (merging with any
 * existing settings), then return the effective merged-over-defaults rates.
 * Invalid/out-of-range values are ignored rather than rejected.
 */
export async function saveDecayRates(
  trail: TrailDatabase,
  partial: Record<string, number>,
): Promise<Record<NeuronType, number>> {
  const row = await trail.db
    .select({ id: tenants.id, s: tenants.settingsJson })
    .from(tenants)
    .limit(1)
    .get();
  if (!row) throw new Error('tenant-settings: no tenant row to write');

  const settings = parseSettings(row.s);
  const rates = (settings.decayRates as Record<string, number> | undefined) ?? {};
  for (const type of VALID_TYPES) {
    const v = partial[type];
    if (typeof v === 'number' && Number.isFinite(v)) {
      rates[type] = Math.max(MIN_TAU, Math.min(MAX_TAU, Math.round(v)));
    }
  }
  settings.decayRates = rates;
  await trail.db
    .update(tenants)
    .set({ settingsJson: JSON.stringify(settings) })
    .where(eq(tenants.id, row.id))
    .run();

  return loadDecayRates(trail);
}
