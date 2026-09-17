-- F275.2 — de to kontakter: «en ny udgave af samme kilde bliver automatisk kanon».
--
-- Begge default TIL (ejerens afgørelse 16/9 2026). Additiv: en eksisterende Brain
-- får `1` og opfører sig derfor som featuren tilsiger fra det sekund linten
-- respekterer identiteten (F275.3) — ikke før.
--
-- `canon_off_connectors` gemmer de SLUKKEDE konnektorer, ikke de tændte. Det er
-- det der gør at en konnektor vi aldrig har set før automatisk står TIL. Gemte vi
-- de tændte, ville en frisk konnektor være FRA indtil nogen rørte den.
ALTER TABLE `knowledge_bases` ADD COLUMN `new_version_is_canon` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_bases` ADD COLUMN `canon_off_connectors` text;
