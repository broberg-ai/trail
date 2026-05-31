-- F182.1 — Memory Lifecycle: per-Neuron confidence + supersession + signal log.
--
-- Additive only. `confidence` defaults 0.7 so every existing Neuron starts with
-- a neutral score until the F182.3 decay job recomputes it. `superseded_by_neuron_id`
-- is a self-FK (TEXT — documents.id is a text uuid in this schema, NOT the integer
-- the generic F182 plan-doc assumed). `confidence_signals` is the append-only
-- reinforcement-event log the decay job reads (integer autoincrement PK, text FKs
-- to documents.id). Per-tenant decay-rate (tau) config lives in tenants.settings_json
-- — no new column.

ALTER TABLE `documents` ADD `confidence` real DEFAULT 0.7 NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `confidence_last_recomputed_at` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `superseded_by_neuron_id` text REFERENCES documents(id);--> statement-breakpoint
CREATE TABLE `confidence_signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`neuron_id` text NOT NULL,
	`signal_type` text NOT NULL,
	`weight` real NOT NULL,
	`source_neuron_id` text,
	`recorded_at` integer NOT NULL,
	`metadata` text,
	FOREIGN KEY (`neuron_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_neuron_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_confidence_signals_neuron` ON `confidence_signals` (`neuron_id`,`recorded_at`);
