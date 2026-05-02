-- F165.1 — Vision derivatives (WebP) for >5MB images
--
-- Anthropic's Messages API rejects images > 5 MB. Phone photos and
-- high-res scans regularly cross that line, so vision_description
-- silently stays NULL. F165.1 generates a WebP-encoded, dimension-
-- capped derivative alongside the original; the Vision backend reads
-- the derivative; the original stays untouched in storage (hard
-- requirement — Trail is becoming the customer's Brand Intelligence
-- Base, lossless retention is non-negotiable).
--
-- Nullable column. Filled when a derivative exists; NULL when (a)
-- the original was already small enough to skip generation, or
-- (b) we haven't generated one yet. ensureDerivative() is the
-- single writer.

ALTER TABLE `document_images` ADD COLUMN `vision_derivative_path` text;
