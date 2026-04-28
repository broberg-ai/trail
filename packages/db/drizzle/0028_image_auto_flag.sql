-- F163.2 Phase 1 — image auto-flag signal + reason
--
-- New columns on document_images for the Vision-pipeline auto-flag
-- feature. Two complementary signals (Vision-prompt structured
-- marker + regex backstop) both write here:
--   - auto_flag_signal: 0/1 boolean — image has been flagged as
--     low-quality by either Vision or the regex backstop
--   - auto_flag_reason: short tag identifying which detector fired
--     ('vision-prompt-low', 'regex:too-small-and-unclear', etc.)
--     so we can iterate on prompt vs regex separately + render
--     i18n'd tooltip in the UI.
--
-- Defaults: 0 / NULL. Pre-F163.2 rows are implicitly "not flagged"
-- until either:
--   - a Vision re-run stamps them (forward flow), or
--   - the opt-in sweep-job (TRAIL_VISION_AUTO_FLAG_SWEEP=1) does a
--     regex-pass over their existing vision_description.
--
-- Curator-flag (F164 Phase 5 thumbs-down) lives separately in
-- vision_quality_ratings — orthogonal stack: a row can be auto-flagged
-- AND curator-flagged AND curator-up'd, the UI surfaces the union.

ALTER TABLE `document_images` ADD COLUMN `auto_flag_signal` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `document_images` ADD COLUMN `auto_flag_reason` text;
--> statement-breakpoint
CREATE INDEX `idx_doc_images_auto_flag` ON `document_images`(`tenant_id`, `knowledge_base_id`, `auto_flag_signal`)
  WHERE `auto_flag_signal` = 1;
