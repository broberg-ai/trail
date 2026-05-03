-- F112 — User Notes / "Your Take" field (Luhmann friction)
--
-- A space where the curator writes their own thinking about a Neuron,
-- separate from the LLM-compiled body. Survives re-ingest because
-- it lives on documents (its own column) rather than inside `content`,
-- which the compile pipeline rewrites.
--
-- Privacy stance: NEVER passed to the LLM as chat context. The whole
-- point of the Luhmann pattern is the user formulating ideas in their
-- own words; surfacing them back via chat would defeat the friction.
--
-- Nullable (no default) — existing rows stay untouched and the
-- absence of a note is meaningful (no UI banner, no export section).

ALTER TABLE `documents` ADD COLUMN `user_note` text;
