-- F112.1 — Per-Neuron opt-in to share user-note with chat + external
-- integrations.
--
-- F112 hard-coded "user_note never reaches LLM context" as a default.
-- This relaxes the default to opt-in: curator can flip a checkbox
-- per-Neuron when they want their own formulation included alongside
-- the LLM body in chat answers and /retrieve responses.
--
-- Default 0 (= same as F112 behaviour). All existing notes stay
-- private unless the curator explicitly opts each one in.

ALTER TABLE `documents` ADD COLUMN `user_note_share` integer NOT NULL DEFAULT 0;
