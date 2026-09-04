-- F232.1: an image waits in a temp store until something has decided it is
-- worth keeping.
--
-- 'pending' = extracted, bytes in .../images-pending/, not yet judged, and
--             invisible everywhere (gallery, search, retrieval).
-- 'kept'    = judged worth keeping, bytes moved to .../images/.
--
-- DEFAULT 'kept', deliberately: every row that already exists was written
-- before this column and is, by definition, already in the Trail. A default of
-- 'pending' would make Sanne's whole image library vanish the moment the
-- column appeared — a migration that silently empties a customer's gallery.
ALTER TABLE `document_images` ADD `triage` text NOT NULL DEFAULT 'kept';--> statement-breakpoint
CREATE INDEX `idx_doc_images_triage` ON `document_images`(`tenant_id`, `knowledge_base_id`, `triage`);
