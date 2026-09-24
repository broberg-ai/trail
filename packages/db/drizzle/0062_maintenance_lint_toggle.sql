-- F200.3 — per-KB toggle for the maintenance lint detectors (stale, orphans,
-- faded heuristics). Additive, default 1 (enabled) → existing KBs unchanged.
-- When 0, the scheduled lint pass skips those detectors for the KB. Measured
-- 24/9 2026: buddy-sessions got 943 "Stale Neuron" candidates in one weekly
-- pass while contradiction lint was already off there.
ALTER TABLE knowledge_bases ADD COLUMN maintenance_lint_enabled INTEGER NOT NULL DEFAULT 1;
