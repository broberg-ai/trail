-- F226: per-KB minimum image size (smallest side, pixels). NULL = no filter,
-- so every existing Trail keeps the behaviour it had before this column.
ALTER TABLE `knowledge_bases` ADD `min_image_px` integer;
