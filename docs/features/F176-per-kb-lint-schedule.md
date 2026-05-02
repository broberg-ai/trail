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

## Secondary Pain Points

- **Ingen UI til at se eller ændre kadencen.** Curator kan kun ændre den ved at edit'e env-var + redeploy. F176 settings-tab giver dem direkte håndtag.
- **Ingen synlig "next scheduled run"-info.** Curator har ingen anelse om hvornår næste pass fyrer — de skal kigge i logs. F176 viser "Last lint pass: 2026-05-01 02:14 / Next scheduled: 2026-05-08 02:14" som status-card.
- **`knowledge_bases.lint_policy`-kolonne eksisterer allerede** (default 'trusting') men styrer kun reaktiv-runner-policy, ikke schedule. F176 udvider per-KB lint-config-pattern naturligt.
- **F174 Action-Zone Governance + F32 lint-scheduler bør koordineres** — yellow-zone digest-mode (F174 Phase 4) skal aligne med lint-pass cadence så Starter-tier kunders ugentlige digest faktisk indeholder en frisk lint-pass.

## Verification baseline (current state, 2026-05-02)

Inden vi designer over status quo, dokumenter hvad der faktisk er:

| Aspekt | Status |
|---|---|
| Env-var `TRAIL_LINT_SCHEDULE_HOURS` | Default 24, 0 disables |
| Env-var `TRAIL_LINT_INITIAL_DELAY_SECONDS` | Default 14400 (4h) |
| Per-KB schedule-felt | **Findes ikke** |
| Activity-log integration | ✅ `lint.scheduled` + `lint.completed` events skrives korrekt |
| Local DB scheduled-passes logged | **0** (kun 1 manual fra 2026-05-02 15:27) |
| Manual-trigger-API | `POST /api/v1/knowledge-bases/:kbId/lint` virker |
| Settings UI | Ingen lint-cadence-tab |
| Idempotent-skip (F158) | ✅ aktiv — brain at rest = 0 LLM-calls |
| Sampling (F118) | ✅ aktiv — `TRAIL_CONTRADICTION_SAMPLE_SIZE=500` default |

Implication: F176's leverance er strikt UX/config — lint-mekanikken nedenunder er allerede solid takket være F118 + F158.

## Solution

### Schema-ændring (single migration)

```sql
-- 0031_per_kb_lint_schedule.sql
ALTER TABLE knowledge_bases ADD COLUMN lint_schedule_days INTEGER
  CHECK (lint_schedule_days IS NULL OR (lint_schedule_days >= 1 AND lint_schedule_days <= 90));

-- NULL = use global env-var fallback
-- 1..90 = explicit per-KB cadence in days
```

`NULL` betyder "brug global default" (env-var). En curator kan eksplicit sætte en værdi 1-90, og scheduler bruger den per-KB.

### Scheduler-ændring

I `apps/server/src/services/lint-scheduler.ts`, skift fra at iterere alle KB'er per global tick til at evaluere hver KB's egen schedule:

```typescript
// Pseudo-code
for (const kb of allKbs) {
  const cadenceDays = kb.lintScheduleDays ?? GLOBAL_DEFAULT_DAYS;
  const lastPassAt = await lastPassTimestamp(kb.id);
  const nextDueAt = lastPassAt
    ? addDays(lastPassAt, cadenceDays)
    : addDays(kb.createdAt, cadenceDays);

  if (now >= nextDueAt) {
    await runLintPass(kb);
  }
}
```

Tick-frequency på selve scheduler-loopet (hvor ofte vi *evaluerer* alle KBs) er stadig fast (default 1 time eller 30 min) — det er kun *hvilke KBs der lint'es på en given tick* der bliver per-KB. Det betyder en KB med `lint_schedule_days=1` lint'es hver dag, mens en med `lint_schedule_days=30` lint'es hver måned, og scheduler-loopet selv er konstant (cheap SQL-query).

Boot-delay reduceres fra 4h → 5min så lokal dev-flow virker:

```
TRAIL_LINT_INITIAL_DELAY_SECONDS=300   # 5 min default (was 14400 = 4h)
```

5 min er nok til at queue-backfill får første run efter restart uden at konkurrere med scheduled-pass.

### Default-værdier

- **`GLOBAL_DEFAULT_DAYS = 7`** — flytter default fra 1 dag til 1 uge. Matcher Wang's artikel + Trail's kuratorisk rytme + F174 yellow-digest-cadence.
- Eksisterende KB'er (oprettet før F176) har `lint_schedule_days = NULL` → falder tilbage til global env-var, men env-var-default flyttes også til 7 dage (`TRAIL_LINT_SCHEDULE_DAYS=7`, en ny env-var der replacer `TRAIL_LINT_SCHEDULE_HOURS`).
- `TRAIL_LINT_SCHEDULE_HOURS` bevares som backward-compat — hvis sat, vinder den over `_DAYS`. Logges som deprecated på boot.

### Settings UI

Ny tab i `apps/admin/src/panels/settings/` (eller udvidelse af eksisterende lint-config-panel hvis det findes):

```
┌─────────────────────────────────────────────────────────────┐
│ Lint Schedule                                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Hvor ofte skal trail kontrollere KB'en for orphans, stale,  │
│ og modsigelser?                                              │
│                                                              │
│ Cadence:  [ 7 dage (weekly)            ▾ ]                   │
│           ┌──────────────────────────────┐                   │
│           │ 1 dag (daily)                │                   │
│           │ 3 dage                       │                   │
│           │ ✓ 7 dage (weekly) — anbefalet│                   │
│           │ 14 dage                      │                   │
│           │ 30 dage (monthly)            │                   │
│           │ 60 dage                      │                   │
│           │ 90 dage (quarterly)          │                   │
│           └──────────────────────────────┘                   │
│                                                              │
│ ℹ Anbefales: 7 dage (weekly) for de fleste KB'er. Brug       │
│   1-3 dage hvis KB'en ser daglige ingests. Brug 30+ dage     │
│   for stabile reference-KB'er der sjældent ændrer sig.       │
│                                                              │
│ ┌─ Status ─────────────────────────────────────────────────┐ │
│ │ Last lint pass:    2026-04-30 02:14 (2 dage siden)       │ │
│ │ Next scheduled:    2026-05-07 02:14 (om 5 dage)          │ │
│ │ Findings i sidste pass: 3 orphans, 0 stale, 1 contradict.│ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ [ Kør lint nu ]   [ Gem ændringer ]                          │
└─────────────────────────────────────────────────────────────┘
```

Anbefalingen er **eksplicit i UI** — ikke bare i docs eller plan-doc. Curator skal kunne se "weekly er default for en grund" uden at læse en feature-plan.

### Status-data sourcing

`Last lint pass` + `Next scheduled` kommer fra activity_log:

```typescript
// GET /api/v1/knowledge-bases/:kbId/lint/status
{
  scheduleDays: 7,
  lastPassAt: '2026-04-30T02:14:00Z',
  nextScheduledAt: '2026-05-07T02:14:00Z',
  lastPassFindings: { orphans: 3, stale: 0, contradictions: 1 },
  lastPassElapsedMs: 1842,
}
```

Ingen ny tabel — ren aggregering over `activity_log WHERE kind IN ('lint.scheduled', 'lint.completed') AND knowledge_base_id = ?`.

## Non-Goals

- **Ikke per-rule cadence.** Hele lint-pakken (orphans + stale + contradictions + link-check) kører på samme cadence. Hvis curator vil have "contradiction kun ugentlig, orphans dagligt" er det et separat F-nummer.
- **Ikke sub-day cadence.** Minimum 1 dag, maks 90 dage. Sub-day handles via reactive-runner (F32) som er event-driven, ikke schedule.
- **Ikke automatic adjustment baseret på KB-aktivitet.** Cadence er manuel. Et hypotetisk "smart-schedule"-feature kunne detektere at en KB ikke har set ingest i 30 dage og automatisk slow'e cadence — men det er post-F176.
- **Ikke email/notification ved scheduled-pass-completion.** Curator ser status i UI når de selv tilgår; ingen push. Ugentlig digest-email er F174 Phase 4's område.
- **Ikke per-tenant override.** F176 er per-KB. Tier-defaults håndteres af F122 plan-limits når det lander.
- **Ikke retroaktiv re-application.** Eksisterende KB'er beholder `NULL`-værdi → falder tilbage til env-var-default. Curator kan opt-in til eksplicit værdi via settings.

## Technical Design

### 1. Migration `0031_per_kb_lint_schedule.sql`

```sql
ALTER TABLE knowledge_bases ADD COLUMN lint_schedule_days INTEGER
  CHECK (lint_schedule_days IS NULL OR (lint_schedule_days >= 1 AND lint_schedule_days <= 90));

CREATE INDEX idx_knowledge_bases_lint_schedule
  ON knowledge_bases(tenant_id, lint_schedule_days)
  WHERE lint_schedule_days IS NOT NULL;
```

### 2. Scheduler-update i `apps/server/src/services/lint-scheduler.ts`

```typescript
// New env-var (replaces _HOURS for clarity)
const SCHEDULE_DAYS_DEFAULT = Number(process.env.TRAIL_LINT_SCHEDULE_DAYS ?? 7);

// Backward-compat: TRAIL_LINT_SCHEDULE_HOURS overrides if set
const LEGACY_HOURS = process.env.TRAIL_LINT_SCHEDULE_HOURS;
const effectiveDefaultDays = LEGACY_HOURS
  ? Number(LEGACY_HOURS) / 24
  : SCHEDULE_DAYS_DEFAULT;

// Tick-frequency: how often scheduler-loop EVALUATES
const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Boot-delay: was 4h, now 5min
const INITIAL_DELAY_MS = Number(process.env.TRAIL_LINT_INITIAL_DELAY_SECONDS ?? 300) * 1000;

async function tick() {
  const allKbs = await trail.db.query.knowledgeBases.findMany({
    where: (kb, { isNull }) => isNull(kb.archivedAt),
  });

  for (const kb of allKbs) {
    const cadenceDays = kb.lintScheduleDays ?? effectiveDefaultDays;
    const lastPass = await lastScheduledPassFor(kb.id);
    const lastPassAt = lastPass ?? kb.createdAt;
    const nextDueAt = addDays(new Date(lastPassAt), cadenceDays);

    if (Date.now() >= nextDueAt.getTime()) {
      await runLintPassForKb(kb, 'scheduled');
    }
  }
}

setInterval(tick, TICK_INTERVAL_MS);
setTimeout(tick, INITIAL_DELAY_MS); // first evaluation
```

### 3. New endpoint: `GET /api/v1/knowledge-bases/:kbId/lint/status`

Returns aggregate fra activity_log:

```typescript
app.get('/api/v1/knowledge-bases/:kbId/lint/status', async (c) => {
  const kbId = c.req.param('kbId');
  const tenantId = c.get('tenantId');

  const lastCompleted = await trail.db
    .select()
    .from(activityLog)
    .where(and(
      eq(activityLog.tenantId, tenantId),
      eq(activityLog.knowledgeBaseId, kbId),
      eq(activityLog.kind, 'lint.completed'),
    ))
    .orderBy(desc(activityLog.createdAt))
    .limit(1);

  const kb = await loadKb(kbId);
  const cadenceDays = kb.lintScheduleDays ?? effectiveDefaultDays;

  return c.json({
    scheduleDays: cadenceDays,
    isExplicit: kb.lintScheduleDays !== null,
    lastPassAt: lastCompleted[0]?.createdAt ?? null,
    nextScheduledAt: lastCompleted[0]
      ? addDays(new Date(lastCompleted[0].createdAt), cadenceDays).toISOString()
      : null,
    lastPassFindings: lastCompleted[0]
      ? JSON.parse(lastCompleted[0].metadata).findings
      : null,
    lastPassElapsedMs: lastCompleted[0]
      ? JSON.parse(lastCompleted[0].metadata).elapsedMs
      : null,
  });
});
```

### 4. New endpoint: `PATCH /api/v1/knowledge-bases/:kbId`

Allerede eksisterer (tenant-update). Tilføj `lintScheduleDays` til accepted body:

```typescript
const UpdateKbSchema = z.object({
  // ... existing fields
  lintScheduleDays: z.number().int().min(1).max(90).nullable().optional(),
});
```

### 5. Settings UI tab

`apps/admin/src/panels/settings/lint-schedule.tsx` (ny fil):

```tsx
const SCHEDULE_OPTIONS = [
  { value: 1, label: '1 dag (daily)' },
  { value: 3, label: '3 dage' },
  { value: 7, label: '7 dage (weekly)', recommended: true },
  { value: 14, label: '14 dage' },
  { value: 30, label: '30 dage (monthly)' },
  { value: 60, label: '60 dage' },
  { value: 90, label: '90 dage (quarterly)' },
];

function LintScheduleTab({ kbId }: { kbId: string }) {
  const { data: status } = useSWR(`/api/v1/knowledge-bases/${kbId}/lint/status`);
  const [days, setDays] = useState(status?.scheduleDays ?? 7);

  return (
    <Panel title="Lint Schedule">
      <Description>
        Hvor ofte skal trail kontrollere KB'en for orphans, stale, og modsigelser?
      </Description>

      <Select value={days} onChange={setDays} options={SCHEDULE_OPTIONS} />

      <Recommendation>
        Anbefales: 7 dage (weekly) for de fleste KB'er. Brug 1-3 dage hvis KB'en
        ser daglige ingests. Brug 30+ dage for stabile reference-KB'er der
        sjældent ændrer sig.
      </Recommendation>

      <StatusCard>
        <Row label="Last lint pass">{relativeTime(status?.lastPassAt)}</Row>
        <Row label="Next scheduled">{relativeTime(status?.nextScheduledAt)}</Row>
        <Row label="Findings sidst">
          {status?.lastPassFindings?.orphans ?? 0} orphans,{' '}
          {status?.lastPassFindings?.stale ?? 0} stale,{' '}
          {status?.lastPassFindings?.contradictions ?? 0} contradictions
        </Row>
      </StatusCard>

      <ActionRow>
        <Button onClick={runLintNow}>Kør lint nu</Button>
        <Button primary onClick={save} disabled={days === status?.scheduleDays}>
          Gem ændringer
        </Button>
      </ActionRow>
    </Panel>
  );
}
```

## Interface

### Database

`knowledge_bases.lint_schedule_days INTEGER NULL` (1-90 eller NULL).

### API

- `GET /api/v1/knowledge-bases/:kbId/lint/status` — returns schedule + status
- `PATCH /api/v1/knowledge-bases/:kbId` — accepter `lintScheduleDays` i body
- `POST /api/v1/knowledge-bases/:kbId/lint` (eksisterer) — manual trigger uændret

### Env-vars

- `TRAIL_LINT_SCHEDULE_DAYS=7` (ny default; replacerer `_HOURS`)
- `TRAIL_LINT_INITIAL_DELAY_SECONDS=300` (sænket fra 14400)
- `TRAIL_LINT_SCHEDULE_HOURS` (deprecated; honoreres for backward-compat, log advarsel ved boot)

### Admin UI

Ny tab "Lint Schedule" i settings-panel pr. KB.

## Rollout

**Phase 1 — Migration + scheduler-update (0.5 dag).** Migration 0031, scheduler læser per-KB med fallback til env-var, boot-delay sænkes til 5min. Default global cadence flyttes fra 24h til 7d. Activity-log uændret.

**Phase 2 — API endpoints + UI (0.5 dag).** GET status, PATCH lintScheduleDays, settings-tab med dropdown + recommendation badge + status-card.

**Backward compatibility:** alle eksisterende KB'er har `lint_schedule_days = NULL` → falder tilbage til env-var. Hvis Christian har `TRAIL_LINT_SCHEDULE_HOURS=24` sat lokalt, vinder den (boot-warning logged). Hvis ingen env-var → 7-dages default.

**Verification step (krævet før close):** efter Phase 1 deploy, vent 6+ timer på production engine, så `lint.scheduled` events skal optræde i activity_log med `trigger='scheduled'`. På local dev, sæt `TRAIL_LINT_SCHEDULE_DAYS=0.01` (15 min) til verify-script, run engine 30 min, assert at scheduled events fyrer.

## Success Criteria

- Migration 0031 land'er; eksisterende KB'er har `lint_schedule_days = NULL`.
- Per-KB schedule overstyrer global default når sat.
- Settings-UI viser dropdown med 7 trin + "Anbefalet: 7 dage" badge.
- Status-card viser "Last pass / Next scheduled / Findings sidst" med korrekt data fra activity_log.
- `lint.scheduled` events fyrer på production engine inden for 24h af første KB's `nextDueAt`.
- Manual trigger virker uændret (regression-test).
- Verify-script på local: `TRAIL_LINT_SCHEDULE_DAYS=0.01` + 30 min engine-uptime → minimum 1 scheduled event i activity_log.
- Default cadence flyttet fra "1 dag" til "7 dage" — verificeret via boot-log + DB-default + UI-default.

## Impact Analysis

### Files created

- `packages/db/src/migrations/0031_per_kb_lint_schedule.sql`
- `apps/admin/src/panels/settings/lint-schedule.tsx`
- `apps/server/scripts/verify-lint-schedule.ts` (verify-script per CLAUDE.md hard rule)

### Files modified

- `apps/server/src/services/lint-scheduler.ts` — per-KB evaluering, sænket boot-delay, ny env-var
- `apps/server/src/routes/knowledge-bases.ts` — udvid PATCH-endpoint, tilføj `/lint/status`
- `apps/admin/src/panels/settings.tsx` — register ny lint-schedule-tab
- `packages/db/src/schema.ts` — `lintScheduleDays` på `knowledgeBases`
- `packages/shared/src/schemas.ts` — `UpdateKbSchema.lintScheduleDays`

### Blast radius

- Eksisterende KB'er uændrede med NULL-værdi.
- Default global cadence flyttes 24h → 7d. Inactive KB'er der i dag lint'es daglig (med 0 findings takket være F158) bliver nu ugentlig — net mindre støj, samme dækning.
- Aktive KB'er kan eksplicit sætte 1 dag og få samme cadence som i dag.
- Production-instans (Sanne på engine-001): ingen ændring i opførsel medmindre Christian opt-in til 1-dag eller anden cadence.

### Breaking changes

`TRAIL_LINT_SCHEDULE_HOURS` deprecated (ikke fjernet). Boot-log warner. Ingen API breaks.

### Test plan

- [ ] `pnpm typecheck` clean
- [ ] Unit: scheduler bruger per-KB værdi når sat, falder tilbage til env-var når NULL
- [ ] Unit: UpdateKbSchema validerer 1-90 range, accepterer null
- [ ] Integration: PATCH /knowledge-bases/:kbId med `lintScheduleDays: 14` opdaterer DB
- [ ] Integration: GET /knowledge-bases/:kbId/lint/status returnerer korrekt schedule + last pass
- [ ] Verify-script: `bun run apps/server/scripts/verify-lint-schedule.ts` setter cadence=0.01 dag, kører engine 30 min, asserter ≥1 scheduled-event i activity_log
- [ ] Manual: settings-UI dropdown viser 7 trin + recommended-badge på 7-dage
- [ ] Manual: status-card viser "om 5 dage" relative-time format
- [ ] Regression: F32 manual lint-trigger virker uændret

## Implementation Steps

1. Migration `0031_per_kb_lint_schedule.sql` + drizzle schema-update.
2. Patch `lint-scheduler.ts` — per-KB evaluering, env-var-rename, sænket boot-delay.
3. Tilføj `/lint/status` endpoint, udvid PATCH `/knowledge-bases/:kbId`.
4. Skriv `apps/server/scripts/verify-lint-schedule.ts` der setter cadence=0.01 og asserter scheduled-event.
5. Skriv `apps/admin/src/panels/settings/lint-schedule.tsx` med dropdown + recommendation + status-card.
6. Register tab i settings-panel routing.
7. Test end-to-end: opret KB, sæt cadence=3 dage, verificér i status-card, kør verify-script.
8. Opdater dogfooding-trail KB'ens egen cadence til 7 dage som canonical example.

## Dependencies

- **F32 Lint Pass** ✅ — eksisterende lint-mekanik forbliver uændret.
- **F97 Activity Log** (in progress) — `lint.scheduled` + `lint.completed` events allerede wired i lint-scheduler. F176 status-API læser fra activity_log.
- **F118 Contradiction-Scan Sampling** ✅ — gør længere cadence fornuftig (sampling capper compute).
- **F158 Idempotent Contradiction-Lint** ✅ — gør "brain at rest = 0 calls" hvilket er fundamentalt for at multi-day cadence er forsvarlig.
- **F174 Action-Zone Governance** (Planned) — yellow-zone digest-mode (Phase 4) bør aligne med 7-dages default lint-cadence.

## Open Questions

- **Skal vi auto-migrate eksisterende KB'er til eksplicit 7-dages værdi i stedet for NULL?** Kontra: NULL = "fall back to global" er en god default; eksplicit værdi binder KB'en. Fordel for eksplicit: settings-UI viser konkret valg i stedet for "(default)". Pragmatik: lad det være NULL; UI rendere "7 dage (default)" når NULL.
- **Bør Sanne's prod KB sættes til 1-dag eksplicit ved deploy?** Sanne har aktiv klinisk content; daglig lint giver mening. Christian beslutter ved deploy-tid.
- **Skal F176 også flytte non-contradiction-lint (orphans + stale + link-check) til samme per-KB schedule?** Forslag: ja — alle scheduled-checks deler `lint_schedule_days` så cadence er één indstilling. Reactive-runner forbliver uafhængig.
- **F176 dogfood-eksempel**: Christian bør sætte trail-research KB til 7 dage ved deploy, så det bliver canonical reference.

## Related Features

- **F32** — fundamentet, uændret
- **F97** — activity-log er vores datastore for "last/next" UI-info
- **F118** — sampling gør længere cadence forsvarlig
- **F158** — idempotent-skip gør weekly default OK selv på inactive KB'er
- **F174** — action-zone yellow-digest aligner med 7-dages cadence

## Effort Estimate

**Small — 1 dag** fordelt over 2 phases:

- Phase 1 schema + scheduler: 0.5 dag
- Phase 2 API + UI: 0.5 dag

Inkluderer typecheck, verify-script, manuel UI-test, regression-test af manual lint-trigger.

## Inspiration

Shuyi Wang, "Should You Actually Try Karpathy's LLM Wiki?" (2026-04-16):

> "In Karpathy's lint check, 'stale claims' are explicitly called out as one of the health checks. My recommendation is to run lint at least once a week, just to turn 'stale' into an observable signal."

Plus Christian's verifikations-disciplin fra CLAUDE.md ("typecheck er ikke verifikation"): F176 plan-doc'en blev skrevet efter at have konstateret empirisk via `sqlite3 data/trail.db` at scheduled-pass aldrig fyrede på lokal dev. F176 fixer det dobbelt — per-KB cadence + sænket boot-delay så lokal dev-restart-flow ikke længere bryder scheduler.
