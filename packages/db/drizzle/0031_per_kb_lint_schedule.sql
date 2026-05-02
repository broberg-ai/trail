-- F176 — Per-KB lint cadence
--
-- Replaces the global setTimeout/setInterval scheduler with a
-- DB-persisted cadence per KB. Combined with F97 activity_log,
-- the scheduler now queries `lastPassAt` from activity_log
-- instead of holding it in memory — engine restarts no longer
-- reset the timer, missed cycles get caught up automatically.
--
-- Column semantics:
--   NULL          → fall back to global TRAIL_LINT_SCHEDULE_DAYS (default 7)
--   1..90         → that many days between scheduled passes
--   CHECK enforces the range; nullable so existing KBs adopt the
--   global default without a one-shot migration that picks an
--   arbitrary cadence for them.
--
-- Index is partial (WHERE NOT NULL) because most rows will stay
-- NULL — only KBs the curator explicitly tunes get an entry. The
-- (tenant_id, lint_schedule_days) shape lets the scheduler pull
-- "all KBs in this tenant with a custom cadence" cheaply once
-- per-tenant scheduler-mode lands.

ALTER TABLE `knowledge_bases` ADD COLUMN `lint_schedule_days` integer
  CHECK (`lint_schedule_days` IS NULL OR (`lint_schedule_days` >= 1 AND `lint_schedule_days` <= 90));
--> statement-breakpoint
CREATE INDEX `idx_knowledge_bases_lint_schedule`
  ON `knowledge_bases`(`tenant_id`, `lint_schedule_days`)
  WHERE `lint_schedule_days` IS NOT NULL;
