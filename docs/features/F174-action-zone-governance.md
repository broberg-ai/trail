# F174 — Action-Zone Governance Policy (green/yellow/red)

> Formaliser **handlings-taksonomi** oven på F19's confidence-engine: hver lint-/curator-/auto-action tagges med en zone der dikterer om LLM må udføre den alene (🟢 green), kræver curator-spar (🟡 yellow), eller er off-limits til outsourcing (🔴 red). Ny `action_zone`-kolonne på candidates + zone-aware queue-rendering + "red zone digest"-tab i admin der samler kritiske aktioner ét sted. Komplementer F19 (confidence) og F106 (Solo-mode), erstatter dem ikke. Inspireret af Shuyi Wang's "traffic-light principle" fra "Should You Actually Try Karpathy's LLM Wiki?" (2026-04-16). Tier: alle, default-policy varierer per tier. Effort: Medium 2-3 dage. Status: Planned.

## Problem

Trail's nuværende governance har to akser:
- **F19 Auto-approval** — confidence-baseret: hvis LLM's confidence > threshold → auto-approve, ellers queue.
- **F106 Solo Mode** — bruger-baseret: solo-curators stoler implicit på LLM, alle deres egne candidates auto-approves.

Begge er **binære**: en candidate auto-godkendes eller ej, ud fra ét scalart signal (confidence eller bruger-mode).

Det er ikke nuanceret nok. Shuyi Wang's artikel formulerer det skarpt: i en kompileret wiki er **forskellige typer handlinger fundamentalt forskellige i hvor sikkert LLM må handle alene**:

- 🟢 **Green-zone actions** — pure mekaniske: opdater index.md, generér summaries, fix dead-link-typo, omformatér frontmatter, gen-nummerér rækker. **Ingen tab af mening hvis LLM tager fejl** — det er bookkeeping, fuldt outsourceable.
- 🟡 **Yellow-zone actions** — kræver curator-spar: contradiction adjudication ("hvilken af to modstridende Neurons skal vinde?"), concept merging ("er disse to faktisk samme entity?"), deprecation decisions ("er denne Neuron stadig relevant?"). **Tabt mening hvis LLM tager fejl** — men også uoverkommeligt at gøre alt manuelt.
- 🔴 **Red-zone actions** — aldrig outsource: skrive kerne-fakta uden source-citation, value-judgments ("er denne idé skarp nok til at gemmes?"), final sign-off på publishable content. **Strukturelt brud på Trail's epistemiske grundlag hvis LLM må gøre det alene** — Trail mister sin kuratoriske autoritet.

Trail's nuværende queue blander disse tre i én lang liste sorteret efter `impact × confidence`. En curator der åbner queuen ser side om side: trivielle dead-link-fixes (green), nuancerede contradictions (yellow), og forslag til at skrive nye Neurons fra LLM uden tilstrækkeligt kilde-grundlag (red). Resultat: enten reviewes alt overfladisk (red-zone-fejl slipper igennem), eller alt reviewes dybt (curatoren brænder ud på trivialiteter).

Symptomet ramte allerede tidligere — commit `99c7a92` dokumenterer at Christian måtte mass-dismisse 113 contradiction-alerts fordi de var "noisy"; problemet var ikke at de var forkerte, men at de blandede yellow- og red-niveau aktioner uden differentiering.

## Secondary Pain Points

- **Auto-approval ramme er for grov.** F19 kan kun sætte én confidence-threshold per lint-rule-type; den kan ikke sige "auto-approve dead-link-fixes ved confidence > 0.7, men aldrig auto-approve contradiction-resolutions uanset confidence". Action-zoner gør den distinktion native.
- **Solo-mode er for binær.** F106 fjerner queue-ceremonien for **alle** candidates fra brugerens egne ingests. En solo-bruger der vil have green-zone fixes auto-applied men stadig spar yellow/red har i dag ikke den knap. Action-zoner tillader "Solo-mode med yellow-zone curator-input" som tredje gear.
- **Audit-trail mangler kategorisering.** F97 Activity Log tracker hvad der skete, men ikke i hvilken zone — så support kan ikke svare "hvilke yellow-zone-handlinger har LLM ageret på i sidste uge?" uden manuelt klassificeringsarbejde.
- **Ingen tier-differentieret default.** Hobby/Free skal måske default til "alle yellow auto-resolve" (lavt loft for hvor meget curator-tid de gider lægge), Business skal default til "alle yellow kræver spar" (høj kuratorisk standard). I dag er der ingen tier-axe i policy-engine'en.

## Solution

### Core idé

Tilføj `action_zone: 'green' | 'yellow' | 'red'`-felt til hver action-definition. Beregn zonen deterministisk fra (a) candidate `kind`, (b) action `effect`, og (c) kontekstuelle signaler. Lad zonen styre auto-approval-routing PLUS render-strategy i admin.

### Tre zoner — hård taksonomi

| Zone | Kriterium | Eksempler (eksisterende effects) | Default-policy per tier |
|---|---|---|---|
| 🟢 **Green** | Mekanisk bookkeeping. Ingen tab af mening hvis LLM tager fejl. Reversibel uden datatab. | `auto-link-sources` (orphan-Neuron foreslår sources), `link-fix` (F148 broken-link auto-fix), `tag-suggest` (F92 auto-tag), `glossary-update` (F102 ny term opdaget), `index-rewrite` (next-pass auto-update af generated index) | Hobby: auto-resolve · Starter: auto-resolve · Pro: auto-resolve · Business: auto-resolve · Enterprise: opt-in |
| 🟡 **Yellow** | Kræver kuratorisk vurdering. Tabt mening hvis LLM tager fejl, men uoverkommelig at gøre alt manuelt. Mid-confidence-policy default. | `contradiction-resolution` (F32 contradictions), `merge-concepts` (samme entity i to Neurons), `deprecate-neuron` (gammelt indhold afløst), `reader-feedback-action` (F31), `gap-suggest` (F57) | Hobby: auto-resolve at confidence > 0.85 · Starter: digest-batch ugentlig · Pro: real-time queue · Business: real-time queue · Enterprise: real-time queue |
| 🔴 **Red** | Strukturelt brud hvis outsourcet. Kerne-fakta-write uden source, value-judgment, final sign-off. | `create-source` (lav-confidence, manglende provenance — koblet med F175), `update-canonical-page` (redigér kanonisk Neuron-tekst), `publish-public-neuron` (F131 visibility-flip til public), `merge-publish` (combine + publish in one shot) | Alle tiers: aldrig auto-resolve. Krav: explicit curator-click + bekræftelses-modal. |

### Action-zone routing-flow

```
Candidate genereres af subscriber (lint, ingest, chat-save)
                ↓
        Resolve zone fra (kind, effect)
        i `getActionZone(candidate)` pure function
                ↓
        Tier-default-policy fra tenant.plan
                ↓
        ┌─────────┬──────────┬─────────┐
        ▼ green   ▼ yellow   ▼ red
  auto-approve   conditional   queue m/
   m/ audit      (confidence    "red badge"
                 OR digest)     + bekræftelse
```

### Admin-UI: zone-rendering i queue

- **Queue-listen får zone-badges**: 🟢/🟡/🔴 venstre for hver candidate. Sort-by-zone som default for at red-zone aktioner aldrig bliver begravet under green-zone støj.
- **Ny tab "Red Digest"** ved siden af queue: viser KUN red-zone candidates som dedikeret review-flow med bekræftelses-modal pr. action.
- **Yellow-zone digest-mode** (Starter-tier default): i stedet for live queue-tab, akkumuleres yellow-candidates i en ugentlig "Trail Health Digest"-email + admin-tab. Curator gennemgår batch én gang om ugen i stedet for real-time.

### Per-tenant policy-override

`tenant_action_policies`-tabel (eller utvidelse af eksisterende `tenants.metadata`-JSON):

```sql
ALTER TABLE tenants ADD COLUMN action_policies TEXT; -- JSON
-- Format:
-- {
--   "green": { "auto_resolve": true, "min_confidence": 0.0 },
--   "yellow": { "mode": "real-time" | "digest" | "auto-resolve", "min_confidence": 0.85 },
--   "red": { "require_modal": true, "require_2fa": false }
-- }
```

Tier-defaults kan flippes pr. tenant af den selv (Pro+) eller af support (alle tiers).

## Non-Goals

- **Ikke et erstatning for F19 confidence-engine.** F19 leverer scalart confidence-signal; F174 bygger ovenpå med kategorisk zone-taksonomi. Begge bruges sammen i routing-beslutningen.
- **Ikke et erstatning for F106 Solo-mode.** Solo-mode flytter brugerens egne candidates direkte til "auto-approve uanset zone" — F174 ændrer ikke det. Solo + zone-policy lever side om side: solo-flag overrider grøn auto-approve OG kan vælge at lade yellow-zone forblive interactive eller folde med over i auto.
- **Ikke ML-baseret zone-klassificering.** Zonen er deterministisk fra `(kind, effect)`-mapping. Ingen LLM-call der "vurderer zonen". Hvis en ny effect tilføjes uden zone-mapping → fail-closed til red.
- **Ikke retroaktiv re-klassificering.** Eksisterende candidates beholder deres `auto_approved`-state; F174-tagging gælder fra deploy-tid.
- **Ikke 4. zone for "purple"/"meta"-actions.** Tre zoner er bevidst valgt — 4 zoner skaber decision-paralysis hos curator.
- **Ikke per-Neuron-zone-override.** Zonen følger action, ikke Neuronen. En contradiction på en specifik Neuron er stadig yellow uanset hvor "vigtig" Neuronen er. Pinning af specifikke Neurons håndteres af F139's heuristic-decay-mekanisme.
- **Ikke zone-baseret credit-pricing.** F156's credits-model er ortogonal — yellow-zone-actions koster ikke flere credits end green. Zonen er governance, ikke billing.

## Technical Design

### 1. Action-zone helper

Ny fil `packages/core/src/queue/action-zones.ts`:

```typescript
import type { CandidateKind, ActionEffect } from '@trail/shared';

export type ActionZone = 'green' | 'yellow' | 'red';

const ZONE_MAP: Record<string, ActionZone> = {
  // Green — mekanisk bookkeeping
  'orphan:auto-link-sources': 'green',
  'link-fix:auto-resolve': 'green',
  'tag-suggest:apply': 'green',
  'glossary-update:add-term': 'green',
  'glossary-update:revise-definition': 'green',
  'index-rewrite:next-pass': 'green',

  // Yellow — kræver kuratorisk vurdering
  'contradiction:resolve': 'yellow',
  'contradiction:merge-claims': 'yellow',
  'concept:merge': 'yellow',
  'neuron:deprecate': 'yellow',
  'reader-feedback:action': 'yellow',
  'gap-suggest:add-source': 'yellow',
  'stale:mark-still-relevant': 'yellow',

  // Red — aldrig outsource
  'source:create-canonical': 'red',
  'neuron:update-canonical': 'red',
  'visibility:publish-public': 'red',
  'merge:publish-and-merge': 'red',
};

/**
 * Resolve action-zone from candidate kind + action effect.
 * Fail-closed: unknown combinations → 'red'.
 */
export function getActionZone(
  kind: CandidateKind,
  effect: ActionEffect,
): ActionZone {
  const key = `${kind}:${effect}`;
  return ZONE_MAP[key] ?? 'red';
}

/**
 * Resolve effective auto-approval for a candidate given tenant policy.
 */
export function shouldAutoResolve(
  zone: ActionZone,
  confidence: number,
  policy: TenantActionPolicy,
): boolean {
  switch (zone) {
    case 'green':
      return policy.green.auto_resolve && confidence >= policy.green.min_confidence;
    case 'yellow':
      if (policy.yellow.mode === 'auto-resolve') {
        return confidence >= policy.yellow.min_confidence;
      }
      return false;
    case 'red':
      return false;
  }
}
```

### 2. Schema migration `0029_action_zones.sql`

```sql
-- Tag candidates with their resolved zone for queue-rendering + audit
ALTER TABLE queue_candidates ADD COLUMN action_zone TEXT
  CHECK (action_zone IN ('green', 'yellow', 'red'));

-- Per-tenant policy overrides
ALTER TABLE tenants ADD COLUMN action_policies TEXT; -- JSON

-- Index for digest queries (yellow-zone digest, red-zone digest)
CREATE INDEX idx_candidates_zone_status
  ON queue_candidates(tenant_id, knowledge_base_id, action_zone, status);
```

### 3. Candidate-write integration

I `packages/core/src/queue/candidates.ts createCandidate()`:

```typescript
import { getActionZone } from './action-zones.js';

const zone = getActionZone(input.kind, input.actions[0]?.effect ?? 'unknown');
const policy = await loadTenantPolicy(input.tenantId);

const autoApproved = shouldAutoResolve(zone, input.confidence, policy);

await db.insert(queueCandidates).values({
  ...existing,
  actionZone: zone,
  autoApproved,
  status: autoApproved ? 'approved' : 'pending',
}).run();

// Audit hook: zone is logged in F97 Activity Log
broadcaster.emit({
  type: 'candidate_created',
  zone,
  autoApproved,
  // ...
});
```

### 4. Admin queue UI

`apps/admin/src/panels/queue.tsx`:

```tsx
function ZoneBadge({ zone }: { zone: ActionZone }) {
  const colors = {
    green:  { bg: '#dcfce7', fg: '#166534', icon: '🟢', label: 'Green — auto-OK' },
    yellow: { bg: '#fef3c7', fg: '#854d0e', icon: '🟡', label: 'Yellow — review' },
    red:    { bg: '#fee2e2', fg: '#991b1b', icon: '🔴', label: 'Red — explicit OK' },
  };
  const c = colors[zone];
  return <span style={{ background: c.bg, color: c.fg }} title={c.label}>{c.icon}</span>;
}

// QueueList sort: red > yellow > green (severity desc)
```

Ny route + panel:

```tsx
// apps/admin/src/panels/red-digest.tsx
// Dedicated review flow for red-zone candidates only.
// Each card has a confirmation modal before action fires.
```

### 5. Per-tier default-policy seed

Default-policies indlæses ved tenant-creation per `tenants.plan`:

```typescript
const TIER_DEFAULTS: Record<Plan, TenantActionPolicy> = {
  hobby: {
    green: { auto_resolve: true, min_confidence: 0 },
    yellow: { mode: 'auto-resolve', min_confidence: 0.85 },
    red: { require_modal: true },
  },
  starter: {
    green: { auto_resolve: true, min_confidence: 0 },
    yellow: { mode: 'digest', min_confidence: 0.85 }, // ugentlig batch
    red: { require_modal: true },
  },
  pro: {
    green: { auto_resolve: true, min_confidence: 0 },
    yellow: { mode: 'real-time', min_confidence: 0.85 },
    red: { require_modal: true },
  },
  business: {
    green: { auto_resolve: true, min_confidence: 0 },
    yellow: { mode: 'real-time', min_confidence: 0.85 },
    red: { require_modal: true, require_2fa: false },
  },
  enterprise: {
    green: { auto_resolve: false, min_confidence: 0 }, // opt-in
    yellow: { mode: 'real-time', min_confidence: 0.85 },
    red: { require_modal: true, require_2fa: true },
  },
};
```

## Interface

### API

- `GET /api/v1/queue/candidates?zone=red` — filter på zone (string-param eller enum)
- `GET /api/v1/queue/digest/yellow` — yellow-zone-batch til ugentlig digest-flow
- `POST /api/v1/queue/candidates/:id/resolve` — eksisterer; nu validerer at red-zone har explicit `confirmed: true` body-flag
- `GET /api/v1/tenant/action-policies` — admin-only læs/skriv

### Admin UI

- Queue-tab får zone-filter dropdown (alle / green / yellow / red)
- Sidebar nav får "🔴 Red Digest"-item med badge-count
- Settings-panel får "Action Zones"-tab hvor curator kan justere policy-thresholds

### Per-tenant config

```json
{
  "action_policies": {
    "green": { "auto_resolve": true, "min_confidence": 0.0 },
    "yellow": { "mode": "digest", "min_confidence": 0.85 },
    "red": { "require_modal": true, "require_2fa": false }
  }
}
```

## Rollout

**Phase 1 — Schema + classification (1 dag).** Migration 0029 lander, `action_zones.ts` deployes, `createCandidate` stamper zone. Eksisterende candidates får zone via batch-job (kører ved deploy). UI-rendering uændret endnu — kun data persisteres.

**Phase 2 — UI rendering (0.5 dag).** Zone-badges + sort-by-zone i queue-listen. Stadig én queue-tab; ingen routing-ændring.

**Phase 3 — Routing-policy (0.5 dag).** `shouldAutoResolve()` aktiveres i `createCandidate`; tier-defaults loades; per-tenant override-UI shippes.

**Phase 4 — Red Digest tab + Yellow Digest mode (0.5-1 dag).** Dedikeret red-tab + Starter-tier yellow-digest-batch-flow. Includes explicit confirmation-modal for red-zone resolves.

**Total effort:** Medium 2-3 dage.

**Backward compatibility:** Eksisterende candidates uden zone får retroaktivt tildelt via batch-job (path: `getActionZone` over alle pending candidates). Auto-approved-flag fra F19 forbliver authoritative for historiske rows.

## Success Criteria

- Hver ny candidate har en `action_zone` stamped ved skrivning.
- Red-zone candidates kan IKKE auto-approves uanset confidence eller tier.
- Starter-tier yellow-zone candidates akkumuleres i digest, ikke real-time queue.
- Curator har ét klik fra queue-toppen til "Red Digest" der KUN viser red-zone candidates.
- F97 Activity Log inkluderer `action_zone` på candidate-events så support kan answer "hvilke yellow-zone handlinger blev triggered sidste uge".
- Per-tenant policy-edit i settings tager effekt på næste candidate-creation (ingen redeploy).

## Impact Analysis

### Files created

- `packages/core/src/queue/action-zones.ts` — zone-resolver + tier-defaults
- `packages/core/src/queue/migrations/0029_action_zones.sql`
- `apps/admin/src/panels/red-digest.tsx` — dedikeret review flow
- `apps/admin/src/components/zone-badge.tsx` — visuelt badge
- `apps/admin/src/panels/settings/action-zones.tsx` — per-tenant policy-edit

### Files modified

- `packages/core/src/queue/candidates.ts` — `createCandidate` stamper zone, `shouldAutoResolve` afgør routing
- `apps/server/src/routes/queue.ts` — zone-filter på listing, validation på red-zone resolves
- `apps/admin/src/panels/queue.tsx` — zone-badges + sort-by-zone
- `apps/admin/src/app.tsx` — sidebar-nav får Red Digest entry
- `packages/db/src/schema.ts` — `actionZone` kolonne på `queueCandidates`, `actionPolicies` på `tenants`
- `packages/shared/src/schemas.ts` — `ActionZone` type-export

### Blast radius

- Alle nye candidates får zone — eksisterende routes uændrede.
- Default-policy indlæses one-shot per tenant; eksisterende tenants får migrations-tid policy-row med tier-default.
- Hvis `getActionZone` ikke kan klassificere (ny `kind:effect`-kombination) → fail-closed til 'red' → curator-click krævet. Det er konservativt og hindrer regressioner.

### Breaking changes

Ingen for API-consumers. Curator-UI får én ekstra tab + zone-badges; hverken sletter eller flytter eksisterende UX.

### Test plan

- [ ] `pnpm typecheck` clean
- [ ] Unit: `getActionZone` returnerer 'red' for unknown kombinationer (fail-closed)
- [ ] Unit: `shouldAutoResolve` respekterer per-zone policy
- [ ] Integration: en `auto-link-sources`-candidate i Hobby auto-resolves uden curator-click
- [ ] Integration: en `contradiction:resolve`-candidate i Starter ender i digest, ikke real-time queue
- [ ] Integration: en `source:create-canonical`-candidate kan IKKE auto-approves uanset confidence
- [ ] E2E: opret candidate i hver zone, verificér routing via fly logs + DB-state
- [ ] Verify-script: `apps/server/scripts/verify-action-zones.ts` der seeder candidates i hver zone og asserter zone-stamping

## Implementation Steps

1. Skriv `packages/core/src/queue/action-zones.ts` med `ZONE_MAP`, `getActionZone`, `shouldAutoResolve`, `TIER_DEFAULTS`.
2. Drizzle migration `0029_action_zones.sql` + schema-update.
3. Patch `createCandidate` til at stampe zone + load policy + afgøre auto-approval.
4. Verify-script + unit-test af `getActionZone` over alle kendte `kind:effect`-kombinationer.
5. Admin UI: zone-badge + sort-by-zone + zone-filter.
6. Red Digest panel + bekræftelses-modal.
7. Settings-tab for per-tenant policy-override.
8. F97 Activity Log integration (zone som event-attribute).
9. Batch-job at backfill eksisterende candidates med zone.
10. End-to-end verify-script + manuel test i admin-UI.

## Dependencies

- **F19 Auto-Approval Policy Engine** ✅ — confidence-engine fundamentet zone-policy bygger ovenpå.
- **F32 Lint Pass** ✅ — kilden til mange yellow-zone candidates.
- **F97 Activity Log** (in progress) — zone-attribute logges som event-property.
- **F106 Solo Mode** (Planned) — solo-flag interagerer med zone-policy; design forudsætter at solo overrider grøn auto-approve men yellow-policy stadig spørges.
- **F148 Link Integrity** ✅ + **F150 Admin Link-Report Panel** ✅ — link-fix candidates får zone='green'.
- **F175 Schema-level provenance enforcement** (sister-feature) — sources-required-violations bliver red-zone candidates.

## Open Questions

- **Skal F19's confidence-threshold flyttes til at være per-zone i stedet for global?** Forslag: ja — F19's `auto_approval_threshold`-felt bliver `green_min_confidence`/`yellow_min_confidence`. Kræver migration. Eller: behold F19's threshold som green-default, lad zone-policy override hvor relevant.
- **Hvor lever Yellow Digest-emailen?** Hvis trail-admin sender ugentlige digest-emails, kræver det Resend-template + cron. Phase 4 kan starte med in-app-only digest og udvide til email senere.
- **Tier-default migration for eksisterende tenants — automatic eller opt-in?** Konservativt: alle eksisterende tenants får `enterprise`-defaults (mest restrictive) ved migration; opt-in op til mere permissive policy. Forhindrer at en eksisterende Pro-tenant pludselig auto-approves yellow ved deploy.

## Related Features

- **F19** — confidence-engine fundamentet
- **F106** — Solo-mode lever side om side
- **F97** — audit-trail får zone-tagging
- **F175** — sister-feature, sources-required-violations bliver red-zone

## Effort Estimate

**Medium — 2-3 dage** fordelt over 4 phases:

- Phase 1 schema + classification: 1 dag
- Phase 2 UI rendering: 0.5 dag
- Phase 3 routing policy: 0.5 dag
- Phase 4 Red/Yellow digest flows: 0.5-1 dag

Inkluderer typecheck, unit-tests, verify-script, manuel admin-UI-test.

## Inspiration

Shuyi Wang, "Should You Actually Try Karpathy's LLM Wiki?" (2026-04-16, Medium, 27 min read). Concrete formulation:

> "The green-light zone can be fully outsourced to the LLM: summary generation, index updates, link completion, formatting, orphan-page checks — these are the bulk of the compilation pipeline, and you should just let them run quietly. The yellow-light zone calls for you and the LLM to spar: contradiction adjudication, concept merging, deprecation decisions — these are the things you sit down with during weekly lint. And the red-light zone is absolutely off-limits to outsourcing: writing core facts, value judgments, final sign-off."

F174 oversætter denne tre-tiered taxonomy til Trail's eksisterende queue-+-policy-arkitektur uden at smide F19/F106 ud.
