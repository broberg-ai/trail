-- F275.5 — «kilden bag denne side er ændret, og siden er ikke set efter siden».
--
-- Sat på de Neuroner der HÆNGER på en afløst kilde — ikke på den der blev
-- kompileret om. NULL = intet at melde, hvilket er hver eksisterende række:
-- additiv, og uden adfærdsændring før noget sætter feltet.
--
-- Epoke-millisekunder, ikke en tekst-dato: feltet sammenlignes, og en
-- tekst-dato med sekund-opløsning er præcis den fælde F278 blev skrevet om.
ALTER TABLE `documents` ADD COLUMN `source_changed_at` integer;--> statement-breakpoint
CREATE INDEX `idx_documents_source_changed` ON `documents` (`knowledge_base_id`,`source_changed_at`);
