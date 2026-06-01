-- F182.8 — curator-pin as decay EXEMPTION.
--
-- Additive only. `confidence_pinned` is a persistent boolean state (default
-- false) set by a curator; when true the F182.3 decay job short-circuits and
-- holds confidence at 1.0 instead of applying the recency-decay formula. A
-- pinned fact (Newton's laws) never decays out of visibility regardless of age.
-- `confidence_pinned_at` (epoch ms) + `confidence_pinned_by` (user id) capture
-- the audit who/when. Unpinning (back to false) returns the Neuron to the
-- normal formula on the next decay pass.

ALTER TABLE `documents` ADD `confidence_pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `confidence_pinned_at` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `confidence_pinned_by` text;
