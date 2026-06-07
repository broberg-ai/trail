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

/**
 * F195 — per-Trail (per-KB) memory-decay opt-in. **Default OFF** for every KB.
 *
 * Stored as a map in the tenant's settings_json
 * (`{ memoryDecayEnabledByKb: { [kbId]: true } }`) so a single account can have
 * one Trail in full operation (decay ON) while another is still being built
 * (decay OFF). A freshly-loaded Trail has no usage history yet, so age/usage
 * decay would wrongly fade true-but-not-yet-cited knowledge ("everything is
 * fading on day 1"). While a KB is OFF, the decay pass holds its Neurons at full
 * confidence (1.0); supersession + contradiction still apply independently.
 */
const DECAY_ENABLED_KEY = 'memoryDecayEnabledByKb';

function decayEnabledMap(settings: Record<string, unknown>): Record<string, boolean> {
  const raw = settings[DECAY_ENABLED_KEY];
  const out: Record<string, boolean> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = v === true;
  }
  return out;
}

/** The whole per-KB enabled map — load once per decay pass. */
export async function loadDecayEnabledMap(trail: TrailDatabase): Promise<Record<string, boolean>> {
  const row = await trail.db.select({ s: tenants.settingsJson }).from(tenants).limit(1).get();
  return decayEnabledMap(parseSettings(row?.s ?? null));
}

/** Is memory-decay enabled for this specific Trail (KB)? Default false. */
export async function loadKbDecayEnabled(trail: TrailDatabase, kbId: string): Promise<boolean> {
  return (await loadDecayEnabledMap(trail))[kbId] === true;
}

/** Persist the per-KB memory-decay flag into tenants.settings_json. */
export async function saveKbDecayEnabled(
  trail: TrailDatabase,
  kbId: string,
  enabled: boolean,
): Promise<boolean> {
  const row = await trail.db
    .select({ id: tenants.id, s: tenants.settingsJson })
    .from(tenants)
    .limit(1)
    .get();
  if (!row) throw new Error('tenant-settings: no tenant row to write');
  const settings = parseSettings(row.s);
  const map = decayEnabledMap(settings);
  map[kbId] = enabled;
  settings[DECAY_ENABLED_KEY] = map;
  await trail.db
    .update(tenants)
    .set({ settingsJson: JSON.stringify(settings) })
    .where(eq(tenants.id, row.id))
    .run();
  return enabled;
}
