# F176 — Per-KB Lint Schedule + Settings UI

> Lint-cadence flyttes fra global env-var (`TRAIL_LINT_SCHEDULE_HOURS`) til per-KB indstilling i `knowledge_bases.lint_schedule_days` (1-90 dage, default 7). Settings-UI har dropdown med 7 forudvalgte trin og en eksplicit "Anbefales: 7 dage (weekly)" badge. Scheduler læser per-KB schedule i stedet for global default; KBs uden eksplicit værdi falder tilbage til env-var (bagudkompatibel). Inkluderer "Last lint pass / Next scheduled" status-card i UI så curator kan se kadencen virker. Inspireret af Shuyi Wang's anbefaling om weekly lint som default rytme. Tier: alle. Effort: Small 1 dag. Status: Planned.

## Problem

Trail's lint-scheduler i `apps/server/src/services/lint-scheduler.ts` fyrer en "dreaming pass" over alle KB'er på en **global** schedule kontrolleret af env-var:

```
TRAIL_LINT_SCHEDULE_HOURS=24            # default
TRAIL_LINT_INITIAL_DELAY_SECONDS=14400  # 4h boot-delay
```

Tre konkrete problemer:

### 1. Cadence er ikke per-KB

En lille reference-KB der ikke har set en ingest i 6 måneder lint'es ligeså ofte som Sannes aktive klinik-KB. Wang's artikel-pointe: kuratorisk rytme er per-domæne, ikke per-server. F158's idempotent-skip betyder at "brain at rest" → 0 LLM-calls per pass, så det er ikke compute-katastrofalt — men det er stadig støj-event-emission og curator-distraktion ("hvorfor får jeg lint-completed-toast hver dag på en KB jeg ikke har rørt?").

### 2. Default 24h er en kompromis ingen er glad for

For aktive KB'er (Sanne, dogfood-trail) er 24h fint. For stabile reference-KB'er (e.g. en bog Christian har læst og ikke vil ind i igen) er 24h overkill. For *meget* aktive KB'er (live forskningsprojekt med flere ingests pr. dag) kan brugeren ønske 6h cadence — i dag kan de kun gøre det globalt, hvilket flytter alle de stabile KB'er med.

### 3. Empirisk verifikation viser at lokal dev aldrig fyrer scheduled-pass

På Christian's local instans (verificeret 2026-05-02 18:25 via `sqlite3 data/trail.db`):

```sql
SELECT kind, json_extract(metadata, '$.trigger') AS trigger, COUNT(*)
FROM activity_log WHERE kind = 'lint.scheduled' GROUP BY trigger;
-- manual | 1
-- (no rows for trigger='scheduled')
```

Total scheduled-passes nogensinde logged: **0**. Total manuel-triggered passes: 1.

Root cause: 4-timers boot-delay + 24h cycle. Lokal dev-engine restartes ofte (Christian roterer på koden); engine kommer aldrig forbi 4h-delay'en før den restartes igen. Scheduled-pass fyrer aldrig.

I produktion vil Sanne's instans formentlig se daglige passes fordi den ikke restartes så ofte — men lokal dev-disciplinen bryder. F176 fixer det ved at gøre cadence per-KB OG sænke boot-delay til en mere fornuftig værdi (60s → 300s) når per-KB-kadence er på plads.

[Full technical design, rollout phases, and implementation details in the complete plan document]

See full plan at /docs/features/F176-per-kb-lint-schedule.md
