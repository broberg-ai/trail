-- F97 — Activity Log
--
-- Central, append-only record of every meaningful action on a Trail
-- engine. One table, one subscriber, one timeline UI. Answers
-- "who did what when" for every surface the admin touches.
--
-- Most events come from the broadcaster (F87 SSE bus). 6 explicit
-- call-sites in routes/services/ fill the gaps for events the
-- broadcaster doesn't cover (auth login/logout, kb.create/update,
-- source.uploaded, lint.scheduled/completed).
--
-- Append-only by convention — no UPDATE, no DELETE paths in code.
-- Tenant cascade-delete handles cleanup.
--
-- Indexes: 5 access patterns
--   1. tenant + time → "what happened today on this tenant" (default panel view)
--   2. kb + time → "what happened in this Trail" (filter by KB)
--   3. tenant + actor + time → "what did this user do this week"
--   4. tenant + subject → "show all events for this Neuron/source/candidate"
--   5. tenant + kind + time → "all candidate.rejected events this month"

CREATE TABLE `activity_log` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  `knowledge_base_id` text REFERENCES `knowledge_bases`(`id`) ON DELETE CASCADE,
  `actor_id` text REFERENCES `users`(`id`),
  `actor_kind` text NOT NULL,
  `kind` text NOT NULL,
  `subject_type` text NOT NULL,
  `subject_id` text,
  `summary` text NOT NULL,
  `metadata` text,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `idx_activity_tenant_time` ON `activity_log`(`tenant_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_activity_kb_time` ON `activity_log`(`knowledge_base_id`, `created_at`) WHERE `knowledge_base_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_activity_actor` ON `activity_log`(`tenant_id`, `actor_id`, `created_at`) WHERE `actor_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_activity_subject` ON `activity_log`(`tenant_id`, `subject_type`, `subject_id`) WHERE `subject_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_activity_kind` ON `activity_log`(`tenant_id`, `kind`, `created_at`);
