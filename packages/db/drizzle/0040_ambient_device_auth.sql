-- F201.2 — Ambient device-auth (RFC 8628-lite).
-- api_keys.scope: 'full' (default, existing behaviour) or 'ambient'
-- (candidates-write + search/chat read only — enforced in requireAuth).
ALTER TABLE `api_keys` ADD COLUMN `scope` text NOT NULL DEFAULT 'full';
--> statement-breakpoint
CREATE TABLE `ambient_device_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`device_name` text NOT NULL,
	`api_key_id` text NOT NULL,
	`token_once` text,
	`kb_ids` text NOT NULL,
	`created_at` text NOT NULL DEFAULT (datetime('now')),
	`expires_at` text NOT NULL,
	`claimed_at` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ambient_device_codes_hash` ON `ambient_device_codes` (`code_hash`);
