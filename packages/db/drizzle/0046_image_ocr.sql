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
--> statement-breakpoint
-- F238 — REBUILD, og den linje er ikke valgfri.
--
-- Et contentless FTS5-indeks oprettet over EKSISTERENDE rækker er tomt, og en
-- senere DELETE fyrer en trigger der vil fjerne en post der aldrig blev
-- indsat: "SQLITE_CORRUPT_VTAB: database disk image is malformed".
--
-- Uden den her brød denne migration billedsletning for alle tre tenants,
-- inklusive en kunde. Det er også derfor 0048 findes: databaser der allerede
-- havde kørt 0046 skulle repareres bagefter.
--
-- På en frisk database er den et no-op. Det er præcis derfor fejlen var
-- usynlig i udvikling.
INSERT INTO `document_images_ocr_fts`(`document_images_ocr_fts`) VALUES('rebuild');
