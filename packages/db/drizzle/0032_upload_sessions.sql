-- F180 — Resumable chunked uploads
--
-- Tracks server-side staging of chunked uploads so a browser reload
-- mid-upload can resume from `received_bytes` instead of starting
-- over. One row per active uploadId; rows survive engine restart and
-- get reaped by upload-session-gc.ts when expires_at passes.
--
-- Cascades:
--   - tenants → cascade delete (curator account closes)
--   - knowledge_bases → cascade delete (KB removed mid-upload)
--   - documents → cascade delete (the staging document row)
--
-- temp_path is the full filesystem path of the partial file under
-- storage's _tmp/ subtree. GC unlinks before deleting the row.
--
-- Indexes:
--   1. tenant + status → "active uploads for this tenant" (resume scan)
--   2. document_id → reverse-lookup from a document row
--   3. expires_at → GC scan, partial WHERE status='uploading' to keep small

CREATE TABLE `upload_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  `knowledge_base_id` text NOT NULL REFERENCES `knowledge_bases`(`id`) ON DELETE CASCADE,
  `document_id` text NOT NULL REFERENCES `documents`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`),
  `filename` text NOT NULL,
  `content_length` integer NOT NULL,
  `content_hash` text NOT NULL,
  `received_bytes` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'uploading'
    CHECK (`status` IN ('uploading', 'complete', 'aborted', 'expired')),
  `temp_path` text NOT NULL,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now')),
  `expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_upload_sessions_tenant` ON `upload_sessions`(`tenant_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_upload_sessions_doc` ON `upload_sessions`(`document_id`);
--> statement-breakpoint
CREATE INDEX `idx_upload_sessions_expires` ON `upload_sessions`(`expires_at`) WHERE `status` = 'uploading';
