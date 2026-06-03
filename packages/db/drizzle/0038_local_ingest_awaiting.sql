-- F191 — Local Ingest Station: awaiting-local-compile marker.
--
-- Additive, opt-in, default 0 (false) → existing uploads are untouched (the
-- cloud compile still fires). When set, the upload path runs extract but SKIPS
-- the cloud OpenRouter compile and parks the source for the /local-ingest skill
-- to compile in an interactive cc session ($0 Max-plan) via trail MCP write.
ALTER TABLE documents ADD COLUMN awaiting_local_compile INTEGER NOT NULL DEFAULT 0;
