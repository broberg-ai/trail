-- F229.1: per-KB minimum image entropy. A solid-colour image has an entropy
-- near 0; a photograph or diagram is 5+. NULL = no filter, so every existing
-- Trail keeps the behaviour it had before this column.
--
-- Stored as REAL, not INTEGER: the useful thresholds live between 0 and 1
-- (measured on Sanne's 1.557 images, the solid-colour bucket ends at 0.5), and
-- an integer column could only express "off" or "discard almost everything".
ALTER TABLE `knowledge_bases` ADD `min_image_entropy` real;
