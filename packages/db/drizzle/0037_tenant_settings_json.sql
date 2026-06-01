-- F182.7 — per-tenant settings JSON.
--
-- Additive, nullable. Holds `decayRates` (per-Neuron-type τ overrides in days)
-- written by the Memory Health decay-rate sliders and read by the F182.3 decay
-- job; NULL means "use DEFAULT_DECAY_RATES". Room for future per-tenant config
-- without a column-per-setting sprawl.

ALTER TABLE `tenants` ADD `settings_json` text;
