-- F200.1 — per-KB contradiction-lint toggle.
--
-- Additive, default 1 (enabled) → existing KBs are untouched (contradiction
-- lint fires as before). When set to 0, contradiction-lint's runForEvent
-- skips emission for that KB entirely — the root-cause throttle for
-- high-volume session KBs (e.g. buddy-sessions) where auto-approved
-- near-duplicate Neurons flood the queue with contradiction-alert candidates.
ALTER TABLE knowledge_bases ADD COLUMN contradiction_lint_enabled INTEGER NOT NULL DEFAULT 1;
