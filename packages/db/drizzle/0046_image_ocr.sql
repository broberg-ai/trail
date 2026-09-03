-- F229.2: OCR text extracted from images, kept SEPARATE from the vision
-- description.
--
-- A description says what the image SHOWS; OCR says what it READS. Merging
-- them into one column would make "the model wrote this about the picture"
-- and "these words are printed in the picture" indistinguishable — and the
-- second is the one a curator can check.
--
-- A SECOND contentless FTS table rather than adding a column to the existing
-- one, deliberately: fts5 cannot ALTER, so widening document_images_fts means
-- DROP + CREATE + rebuild — a one-way door on a production deploy, since a
-- rollback would leave the old code writing a two-column index. Two tables is
-- the additive shape, and the cost is one extra query in image search.
ALTER TABLE `document_images` ADD `ocr_text` text;--> statement-breakpoint
ALTER TABLE `document_images` ADD `ocr_model` text;--> statement-breakpoint
ALTER TABLE `document_images` ADD `ocr_at` text;--> statement-breakpoint
CREATE VIRTUAL TABLE `document_images_ocr_fts` USING fts5(
  `ocr_text`,
  content='document_images',
  content_rowid='rowid'
);--> statement-breakpoint
CREATE TRIGGER `document_images_ocr_fts_insert` AFTER INSERT ON `document_images` BEGIN
  INSERT INTO `document_images_ocr_fts`(`rowid`, `ocr_text`)
  VALUES (new.rowid, new.ocr_text);
END;--> statement-breakpoint
CREATE TRIGGER `document_images_ocr_fts_delete` AFTER DELETE ON `document_images` BEGIN
  INSERT INTO `document_images_ocr_fts`(`document_images_ocr_fts`, `rowid`, `ocr_text`)
  VALUES ('delete', old.rowid, old.ocr_text);
END;--> statement-breakpoint
CREATE TRIGGER `document_images_ocr_fts_update` AFTER UPDATE ON `document_images` BEGIN
  INSERT INTO `document_images_ocr_fts`(`document_images_ocr_fts`, `rowid`, `ocr_text`)
  VALUES ('delete', old.rowid, old.ocr_text);
  INSERT INTO `document_images_ocr_fts`(`rowid`, `ocr_text`)
  VALUES (new.rowid, new.ocr_text);
END;
