# F179 — Provider-direct ingest path for bulk jobs (caching + Batch API)

> Hybrid path-strategy oven på F149: OpenRouter-chainen forbliver real-time-default for interaktiv brug, MEN bulk/scheduled-ingest jobs routes til **provider-direct API'er** der eksponerer prompt caching og Batch API native — features OpenRouter ikke passer alle igennem. Resultatet er **50-65 % cost-reduction** på bulk-ingest workflows som Sanne's 25-års klinisk onboarding (200+ sources) eller batch-PDF-imports. Trade-off: ingen runtime fallback inden for et batch-job (én provider per job), acceptabelt fordi batch-jobs ikke afbrydes af deploys. Tier: Pro+ (default), Business+ (always-on for scheduled). Effort: Medium 3-5 dage. Status: Planned.

## Problem

F149's `OpenRouterBackend` er real-time-default chain: Flash → GLM → Qwen → Sonnet via API. Det er korrekt for interaktiv brug — multi-model fallback i samme job, predictable latency, én billing-vei. Men der er to provider-features F149 ikke kan ramme via OpenRouter passthrough:

### 1. Batch API er ikke eksponeret via OpenRouter

Både Anthropic og Google har Batch API'er (24h SLA, **50 % rabat** på real-time pricing). OpenRouter er real-time only — der er ingen `/batch`-endpoint i deres API. Det betyder ethvert F143 `ingest_jobs`-job der kører via F149's OpenRouter-chain betaler real-time pris, selv hvis curator har sagt "ingest i baggrunden, jeg har ikke travlt".

For Sanne's 25-års klinisk onboarding (estimat 200-500 sources) er forskellen:
- Real-time via OpenRouter på Flash: ~$0.50-1.20
- Direct Gemini API + Batch Mode: ~$0.25-0.60

Det er ikke voldsomt på Flash. Men på Sonnet (som fallback når Flash fejler eller kvalitet kræves):
- Real-time via OpenRouter: ~$30-75
- Direct Anthropic API + Batch: ~$15-37

For en hver Pro+ tenant der kører batch-content-imports er det 50 % rabat-mulighed der ligger på bordet.

### 2. Gemini context caching virker anderledes end Anthropic prompt caching

Anthropic prompt caching: `cache_control` markører i request, OpenRouter passes it through, ~10 % af standard rate efter cache hit.

Google Gemini context caching: **separat lifecycle** med eksplicit `CachedContent` create/use/delete. Pris ~25 % af standard input-rate plus separate $1/M-tok-time **storage cost**. Minimum context-størrelse 32k tokens (4k for nyere modeller).

OpenRouter's passthrough for Gemini caching er **uklar** per 2026-05 docs — det er ikke en simpel `cache_control`-marker, og det kræver dual-API-call (create cache, then use cache). Worth verifying at implementation time, men forsigtigt antaget: **Gemini caching kræver direct API**.

For Trail's bulk-ingest hvor schema + index + affected-Neurons kontekst er stabil på tværs af 50-200 sources i samme batch, er Gemini caching **det meste cost-betydningsfulde lever på Flash-pathen**. Uden direct-Gemini har vi ingen praktisk vej til at hente caching-rabatten på vores production-default ingest-model.

### 3. Min F149 cost-optimization-sektion var for optimistisk

Den oprindelige F149-enrichment (commit `be4246d`) cited Anthropic-numre (10 % cached, 50 % batch) og applicerede dem universelt. Det var forkert — det gælder ikke for Flash via OpenRouter, hvilket er vores prod-default. F179 fixer den fejl ved at adskille:

- **Real-time chain** (F149 OpenRouter-default): caching-passthrough virker for Anthropic-models i kæden, ikke for Gemini. Ingen Batch.
- **Bulk-direct path** (F179): direct-provider, fuldt udnyttet caching + Batch.

## Secondary Pain Points

- **F156 credits-pricing antager faktisk LLM-cost** som debiterings-grundlag. Hvis vi efterlader provider-direct-savings på bordet, betaler tenants reelt for ineffektivitet vi kunne have fjernet. Det er ikke "marketing-margen", det er 65 % cost-reduktion vi ikke leverer.
- **Sanne's onboarding-narrativ ændrer sig** med F179. Pre-F179: "Sanne ingester 200 sources, ~$120-300 i credits". Post-F179: "Sanne ingester 200 sources, ~$42-105". Det er forskellen mellem en Pro-credit-pakke og enterprise-konsultation.
- **F178 landing-build-automation** har en ægte parallel her: F178 bruger GitHub Actions for SSG'en fordi Fly auto-deploy ikke er gratis. F179 bruger direct provider-APIs for samme grund — middlemen koster.
- **Ingen multi-tenant isolation-issues** for caching: Anthropic + Google tillader cache-key segmentation, så cache er per-tenant per-konto isolated. Cross-tenant cache-leak er ikke en risk.

## Solution

### Hybrid path-arkitektur

```
                    ┌───────────────────────┐
   New ingest_job ─►│  chooseCostStrategy() │
                    └───────────┬───────────┘
                                │
                  ┌─────────────┴──────────────┐
                  ▼                            ▼
        ╔═══════════════════╗      ╔══════════════════════╗
        ║ Real-time chain   ║      ║ Bulk-direct path     ║
        ║  (F149, default)  ║      ║  (F179, opt-in)      ║
        ║                   ║      ║                      ║
        ║  OpenRouter:      ║      ║  Direct providers:   ║
        ║  Flash → GLM →    ║      ║  GoogleGeminiBackend ║
        ║  Qwen → Sonnet    ║      ║   (caching + Batch)  ║
        ║                   ║      ║  AnthropicDirectBackend║
        ║  Multi-model      ║      ║   (caching + Batch)  ║
        ║  fallback chain   ║      ║                      ║
        ║                   ║      ║  No multi-model      ║
        ║  Sub-minute       ║      ║  fallback inside job ║
        ║  latency expected ║      ║                      ║
        ║                   ║      ║  24h SLA acceptable  ║
        ╚═══════════════════╝      ╚══════════════════════╝
                  │                            │
                  └────────────┬───────────────┘
                               ▼
                    ┌───────────────────────┐
                    │  ingest_jobs.cost_*   │
                    │  populated identically│
                    │  via usage.cost feed  │
                    └───────────────────────┘
```

### Routing-logic — `chooseCostStrategy(job)`

```typescript
// packages/core/src/ingest/cost-strategy.ts
type CostStrategy = 'real-time' | 'bulk-direct';

export function chooseCostStrategy(
  job: IngestJob,
  tenant: Tenant,
): { strategy: CostStrategy; backend: BackendId; model: string } {
  // 1. Explicit per-job opt-in (curator UI toggle)
  if (job.cost_strategy === 'bulk-direct') {
    return resolveBulkDirect(job.requestedModel, tenant);
  }

  // 2. F143 priority='low' or scheduled_at — curator clicked "ingest in background"
  if (job.priority === 'low' || job.scheduledAt) {
    return resolveBulkDirect(job.requestedModel, tenant);
  }

  // 3. Multi-source batch token (UI: "upload 50 PDFs as batch")
  if (job.batchToken) {
    return resolveBulkDirect(job.requestedModel, tenant);
  }

  // 4. Tenant default (Business+ defaults to bulk for non-interactive paths)
  if (tenant.defaultIngestStrategy === 'bulk-direct'
      && !job.interactiveContext) {
    return resolveBulkDirect(job.requestedModel, tenant);
  }

  // Default: real-time via F149 OpenRouter chain
  return resolveRealTime(tenant);
}

function resolveBulkDirect(model: string, tenant: Tenant) {
  // Maps requested-model to direct-provider backend
  if (model.startsWith('google/gemini')) {
    return { strategy: 'bulk-direct', backend: 'gemini-direct', model: stripPrefix(model) };
  }
  if (model.startsWith('anthropic/claude')) {
    return { strategy: 'bulk-direct', backend: 'anthropic-direct', model: stripPrefix(model) };
  }
  // Fallback: GLM, Qwen, etc — fall back to OpenRouter (no direct path)
  return resolveRealTime(tenant);
}
```

### `GoogleGeminiBackend` (ny)

```typescript
// packages/core/src/ingest/gemini-direct-backend.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GoogleGeminiBackend implements IngestBackend {
  async ingest(job: IngestJob): Promise<IngestResult> {
    const genAI = new GoogleGenerativeAI(await this.resolveApiKey(job.tenantId));
    const model = genAI.getGenerativeModel({ model: job.model });

    // 1. Create cached context for stable parts
    const cache = await genAI.cachedContents.create({
      model: job.model,
      contents: [
        { role: "user", parts: [{ text: job.schemaContent }] },
        { role: "user", parts: [{ text: job.indexContent }] },
        { role: "user", parts: [{ text: job.affectedNeuronsBlob }] },
      ],
      ttlSeconds: 3600,  // 1 hour
    });

    // 2. Decide real-time vs batch
    if (job.costStrategy === 'bulk-direct' && job.batchToken) {
      return this.submitToBatch(model, cache, job);
    }

    // 3. Real-time inference using cached context
    return this.runInference(model, cache, job);
  }

  private async submitToBatch(model, cache, job) {
    // Google Gen AI batch mode — 50% discount, 24h SLA
    const batch = await this.gemini.batches.create({
      model: job.model,
      requests: [{
        contents: [
          { role: "user", parts: [{ text: job.sourceContent }] }
        ],
        cachedContent: cache.name,
      }],
    });
    await this.persistBatchHandle(job.id, batch.name);
    return { status: 'batched', batchId: batch.name };
  }
}
```

### `AnthropicDirectBackend` (ny — eller flag på eksisterende)

Anthropic SDK er allerede en transitive dep i monorepoet. Direct-API-vejen er trivial sammenlignet med Gemini's caching-lifecycle:

```typescript
// packages/core/src/ingest/anthropic-direct-backend.ts
import Anthropic from "@anthropic-ai/sdk";

export class AnthropicDirectBackend implements IngestBackend {
  async ingest(job: IngestJob): Promise<IngestResult> {
    const client = new Anthropic({ apiKey: await this.resolveApiKey(job.tenantId) });
    const messages = this.buildMessages(job);  // includes cache_control markers

    if (job.costStrategy === 'bulk-direct' && job.batchToken) {
      // Anthropic Batch API — 50% off, 24h SLA
      const batch = await client.messages.batches.create({
        requests: [{
          custom_id: job.id,
          params: { model: job.model, messages, max_tokens: 4096 },
        }],
      });
      await this.persistBatchHandle(job.id, batch.id);
      return { status: 'batched', batchId: batch.id };
    }

    // Real-time direct (caching applies, no Batch)
    return this.runInference(client, messages, job);
  }
}
```

### Per-tenant API keys — udvidet `tenant_secrets`

`tenant_secrets`-tabel (allerede defineret i F149) får tre yderligere slots:

```sql
-- Eksisterende kolonner: openrouter_key (encrypted)
-- F179 udvidelse:
ALTER TABLE tenant_secrets ADD COLUMN gemini_direct_key TEXT;     -- encrypted
ALTER TABLE tenant_secrets ADD COLUMN anthropic_direct_key TEXT;  -- encrypted
```

Resolution-logic per backend:
1. Tenant-specific direct key (`tenant_secrets.gemini_direct_key` etc) — bruges hvis sat
2. Trail's master key (`GEMINI_API_KEY` env, `ANTHROPIC_API_KEY` env) — fallback for tenants der ikke har egen direct-billing
3. Fail-loud hvis hverken tenant- eller master-key er sat for det valgte backend

### Schema additions (migration 0014 udvidet eller ny 0015)

```sql
ALTER TABLE ingest_jobs ADD COLUMN cost_strategy TEXT
  CHECK (cost_strategy IN ('real-time', 'bulk-direct'))
  DEFAULT 'real-time';
ALTER TABLE ingest_jobs ADD COLUMN backend_used TEXT;  -- 'openrouter', 'gemini-direct', 'anthropic-direct'
ALTER TABLE ingest_jobs ADD COLUMN batch_id TEXT;       -- provider-specific batch handle
ALTER TABLE ingest_jobs ADD COLUMN cache_hit_ratio REAL;

ALTER TABLE tenants ADD COLUMN default_ingest_strategy TEXT
  CHECK (default_ingest_strategy IN ('real-time', 'bulk-direct'))
  DEFAULT 'real-time';
```

### Curator UI toggle

I `apps/admin/src/panels/sources.tsx` upload-flow:

```
┌─────────────────────────────────────────────────┐
│  Upload sources                                  │
│                                                  │
│  [📎 select files]                               │
│                                                  │
│  Cost mode:                                      │
│   ◉ Real-time ($X.XX, ~30s/source, no batch)     │
│   ○ Bulk in background ($Y.YY, up to 24h SLA)    │
│                                                  │
│  Estimated cost: 12 credits                      │
│  Bulk savings:   65% off — 4 credits             │
│                                                  │
│  [Upload]                                        │
└─────────────────────────────────────────────────┘
```

Default toggle-state styres af `tenant.defaultIngestStrategy`. Tooltip forklarer trade-offs.

For multi-source bulk-uploads (≥10 files) auto-toggles til "Bulk" som default-suggestion. Curator kan flippe tilbage hvis de virkelig vil have real-time.

### Cost calculation — direct-providers returns token-counts, not USD

OpenRouter responses (F149) inkluderer `usage.cost` direkte i USD. Direct-providers (Anthropic + Google) gør **ikke** — de returnerer token-counts, og Trail skal compute prisen client-side. Det er nødvendig F179-komponent for at F156 credits-debit kan operere identisk på tværs af paths.

```typescript
// packages/core/src/ingest/cost-calculator.ts
//
// Single source of truth for direct-provider cost calculation.
// Rates verified at implementation time against provider pricing
// pages — a stale rate here is a 50%+ over/under-charge to tenant
// credits, so this file gets a CI-check that hits provider's
// /pricing or /models endpoint and asserts no rate-drift.

interface ProviderRates {
  input: number;          // $ per token
  output: number;         // $ per token
  cached_read?: number;   // $ per cached-read input token
  cache_creation?: number; // $ per token written to cache (Anthropic)
  storage_per_tok_h?: number; // $ per token per hour stored (Gemini)
}

const RATES: Record<string, ProviderRates> = {
  'gemini-2.5-flash': {
    input: 0.075 / 1_000_000,
    output: 0.30 / 1_000_000,
    cached_read: 0.01875 / 1_000_000,    // 25% of standard
    storage_per_tok_h: 1.00 / 1_000_000 / 3600,
  },
  'gemini-2.5-pro': {
    input: 1.25 / 1_000_000,
    output: 5.00 / 1_000_000,
    cached_read: 0.3125 / 1_000_000,     // 25%
    storage_per_tok_h: 4.50 / 1_000_000 / 3600,
  },
  'claude-sonnet-4-6': {
    input: 3.00 / 1_000_000,
    output: 15.00 / 1_000_000,
    cached_read: 0.30 / 1_000_000,       // 10%
    cache_creation: 3.75 / 1_000_000,    // 1.25× standard input
  },
  'claude-haiku-4-5': {
    input: 1.00 / 1_000_000,
    output: 5.00 / 1_000_000,
    cached_read: 0.10 / 1_000_000,
    cache_creation: 1.25 / 1_000_000,
  },
};

export function calculateCostUsd(
  provider: 'gemini' | 'anthropic',
  model: string,
  usage: GeminiUsage | AnthropicUsage,
  isBatchMode: boolean,
): number {
  const rates = RATES[model];
  if (!rates) throw new Error(`Unknown model rates: ${model}`);

  let cost = 0;
  if (provider === 'gemini') {
    const u = usage as GeminiUsage;
    cost += (u.promptTokenCount - (u.cachedContentTokenCount ?? 0)) * rates.input;
    cost += (u.cachedContentTokenCount ?? 0) * (rates.cached_read ?? rates.input);
    cost += u.candidatesTokenCount * rates.output;
    // Storage cost added separately by cache-lifecycle tracker
  } else {
    const u = usage as AnthropicUsage;
    cost += u.input_tokens * rates.input;
    cost += (u.cache_read_input_tokens ?? 0) * (rates.cached_read ?? rates.input);
    cost += (u.cache_creation_input_tokens ?? 0) * (rates.cache_creation ?? rates.input * 1.25);
    cost += u.output_tokens * rates.output;
  }

  // Batch API: 50% off across all token classes
  if (isBatchMode) cost *= 0.5;

  return cost;
}
```

### Cost-projection for typical Trail workloads

Med ovenstående rates og F179's hybrid path:

| Workload | Sources × pages | OpenRouter (real-time) | Direct + cache + Batch | Δ |
|---|---|---:|---:|---:|
| Sanne onboarding, Flash | 200 × 50 | $7.50 (750 credits) | **$1.20 (120 credits)** | **-84%** |
| Sanne onboarding, Sonnet | 200 × 50 | $52.00 (5,200 credits) | **$13.00 (1,300 credits)** | **-75%** |
| FysioDK 10 klinikere, Flash | 500 × 30 | $19.00 (1,900 credits) | **$3.00 (300 credits)** | **-84%** |
| Hobby-tier 50-source month, Flash | 50 × 20 | $0.45 (45 credits) | **$0.07 (7 credits)** | **-84%** |
| Single 10-page article (real-time, Flash) | 1 × 10 | $0.005 (1 credit) | n/a — real-time path | — |

**F156 credit-grant alignment med F179 enabled:**

- Sanne (Pro, 2,000 credits/mo) onboarder hele sit 25-års materiale på Flash inde i ÉN månedlig grant. Plads til 1,880 credits af løbende drift bagefter.
- Hobby-tier (100 credits/mo) dækker 1,400+ ingest-runs på Flash + cache + Batch. Free tier er reelt useful, ikke kun acquisition-pad.
- Business-tier ($499/mo, 10,000 credits) onboarding af multi-tenant fleet er kommercielt levedygtigt fordi cost-per-source er ned på "rounding error"-niveau.

### Rate-drift CI-guard

Provider-rates ændrer sig (Anthropic + Google har historisk justeret hvert 6-12 måned). En stale `RATES`-konstant i Trail betyder over-/undercharge til tenant credits.

`scripts/verify-cost-rates.ts` (CI-check):
1. Fetch Anthropic `/v1/models` og Google `/v1beta/models` (eller deres `/pricing`-equivalent)
2. Parse current rates per model
3. Diff mod hardcoded `RATES`-table
4. Fail build hvis drift > 5 % på nogen rate-felt

Køres pre-merge på enhver PR der rører `cost-calculator.ts`.

### Bulk-job lifecycle

```
1. Curator uploader 50 PDFs med "Bulk" toggle
2. Server opretter 50 ingest_jobs med shared batchToken + cost_strategy='bulk-direct'
3. Bulk-runner samler dem i én provider-batch (Google eller Anthropic)
4. Provider-batch submittes; batch_id stamps på alle 50 ingest_jobs
5. ingest_jobs.status = 'batched'
6. Background-poller (60s tick) tjekker batch-status hver minut
7. Når batch completes (typisk 5-90 min for Google, 1-24h for Anthropic):
   8. Each result mapped back to ingest_job via custom_id
   9. Standard F149 candidate-emission flow (queue, F19 auto-approval, F87 SSE-broadcast)
   10. ingest_jobs.cost_cents populated via usage.cost from response
   11. F156 tenant_credits debited based on real cost
8. UI viser "X of 50 sources processed (Y in queue, Z complete)" live via SSE
```

## Non-Goals

- **Ikke direct API for GLM eller Qwen.** Disse er kun tilgængelige via OpenRouter (eller Z.AI/Alibaba egen API som er adgangsbegrænset). Bulk-direct path supporterer kun Google Gemini + Anthropic Claude.
- **Ikke runtime fallback inden for et batch-job.** Hvis Gemini API er nede når batch submittes, fejler hele batchen. Curator får retry-knap. Acceptabelt fordi batch-jobs er ikke real-time.
- **Ikke automatisk skift mellem real-time og bulk på samme job.** Curator vælger ved upload-tid. Skift midt i kræver ny job.
- **Ikke OpenRouter eliminering.** F149 chain forbliver default for real-time. F179 er additivt path, ikke erstatning.
- **Ikke Gemini-Pro/Sonnet model-routing-optimization.** F152 (Runtime Model Switcher) håndterer per-KB model-valg. F179 kun routes til DIRECT vs CHAIN baseret på cost-strategy, ikke model-valg.
- **Ikke F156 credits-priser-ændring.** Credits debiteres altid via `usage.cost` (faktisk LLM-cost). F179 reducerer cost; det flyder direkte gennem til lavere credit-burn uden separate billing-logic.
- **Ikke client-side cache.** Caching er provider-side (Anthropic/Google managed cache). Trail har ingen lokal cache-store.

## Technical Design

### Verification at implementation time

**Disse provider-features SKAL verificeres mod live API-docs ved implementation-start** (mine tal er fra 2026-05-02 reading; de kan have ændret sig):

1. Anthropic Batch API: confirm 50 % rabat, 24h SLA, `messages.batches.create` endpoint shape
2. Anthropic prompt caching: confirm 10 % af standard rate, 5-min/1-hour TTL options, `cache_control: { type: 'ephemeral' }` markup
3. Google Gemini Batch Mode: confirm 50 % rabat, 24h SLA, `batches.create` endpoint shape
4. Google Gemini context caching: confirm ~25 % rate + storage cost, 32k/4k minimum, `cachedContents.create` lifecycle
5. OpenRouter Gemini caching passthrough: confirm whether `cache_control` markers work on Gemini-via-OpenRouter (suspected NO — that's why F179 exists)

Hvis nogen af tallene er væsentligt anderledes end ovenfor, opdater denne plan-doc før implementation. Ingen "ja det plejer at være sådan" — ring providerne op via curl + verify-script på real account.

### Files

**Created:**
- `packages/core/src/ingest/cost-strategy.ts` — routing-helper
- `packages/core/src/ingest/gemini-direct-backend.ts` — `GoogleGeminiBackend`
- `packages/core/src/ingest/anthropic-direct-backend.ts` — `AnthropicDirectBackend`
- `packages/core/src/ingest/batch-poller.ts` — 60s tick-loop der poller pending batches
- `apps/server/scripts/verify-bulk-direct.ts` — end-to-end verify-script
- Migration `0015_provider_direct_columns.sql`

**Modified:**
- `packages/core/src/ingest/index.ts` — register new backends
- `apps/server/src/services/ingest.ts` — call `chooseCostStrategy` ved job-start
- `apps/admin/src/panels/sources.tsx` — Cost-mode toggle ved upload
- `apps/admin/src/api.ts` — `/ingest/cost-estimate`-endpoint helper
- `packages/db/src/schema.ts` — nye kolonner
- `packages/shared/src/schemas.ts` — udvidede `IngestJobSchema`-typer
- `apps/server/src/routes/uploads.ts` — accept `cost_strategy` body-param

### NPM dependencies

- `@google/generative-ai` (~50 KB) — Google Gen AI SDK for Gemini direct
- `@anthropic-ai/sdk` (already present transitively) — for Anthropic direct

### Backend-instantiation

```typescript
// packages/core/src/ingest/registry.ts
export const BACKENDS = {
  'claude-cli': new ClaudeCLIBackend(),
  'openrouter': new OpenRouterBackend(),
  'gemini-direct': new GoogleGeminiBackend(),       // F179
  'anthropic-direct': new AnthropicDirectBackend(), // F179
} as const;

export function getBackend(id: BackendId): IngestBackend {
  return BACKENDS[id];
}
```

## Rollout

**Phase 1 — Schema + helpers (0.5 dag).** Migration 0015. `cost-strategy.ts` helper med stub-implementation der altid returnerer 'real-time'. `tenant_secrets`-udvidelse. `tenants.defaultIngestStrategy`. Ingen runtime-effect.

**Phase 2 — `AnthropicDirectBackend` first (1 dag).** Anthropic SDK er kendt + simpler caching-API end Gemini. Implementér både caching og Batch. Verify-script kører mod test-tenant med direct-key. Curator UI får toggle, men routes default forbliver real-time. Phase 2 ender med "Bulk-direct virker for Anthropic-modeller, men ingen tenant har det aktiveret endnu".

**Phase 3 — `GoogleGeminiBackend` (1.5 dag).** Mere kompleks pga. dual-call cache-lifecycle. Implementér + verify. Per-tenant Gemini-key-flow. Sanne kan opt-in til bulk-direct for hendes onboarding.

**Phase 4 — Batch poller + UI (1 dag).** Background-poller (60s tick) der checker pending batches. SSE broadcast af status-updates. UI viser "X of N processed" live. Auto-suggest "Bulk" toggle for ≥10-file uploads.

**Phase 5 — Default flip (deferred).** Når bulk-direct er stabil og credit-impact validated, kan `tenants.defaultIngestStrategy` flippes til 'bulk-direct' for Business+ tenants. Phase 5 sker per-tenant, ikke as a global change.

**Total effort:** Medium 3-5 dage.

## Success Criteria

- En 50-source bulk-upload via Anthropic-direct path fuldfører inden for 24h og koster ~50 % mindre end samme upload via OpenRouter-chain (Sonnet baseline).
- En 50-source bulk-upload via Gemini-direct path fuldfører inden for 90 min og koster ~50-65 % mindre (Flash baseline).
- `usage.cost` rapporteres korrekt fra både providers og populerer `ingest_jobs.cost_cents`.
- F156 credits-debit virker identisk — net-effekt er at tenants debiteres mindre, ikke at billing-logic ændrer sig.
- En tenant uden `gemini_direct_key` og uden master `GEMINI_API_KEY` får tydelig fejl-besked ved bulk-direct opt-in.
- Curator-UI toggle er instinktivt — Sanne kan upload 200 PDFs og forstår "Bulk in background, ~$60"-vs-"Real-time, $180" valget uden ekstra forklaring.
- Verify-script `verify-bulk-direct.ts` ramper en sample-batch op + asserter cost-savings-delta inden for ±10 % af forventet.

## Impact Analysis

### Blast radius

- F149 OpenRouter-chain forbliver helt uændret som real-time-default. F179 er additivt.
- Nye direct-API-keys kræves for tenants der vil bulk-direct. Hvis ikke sat, falder tilbage til OpenRouter (graceful degradation).
- Provider-API-changes kan brække bulk-path mens real-time stadig virker via OpenRouter. Det er en feature, ikke en bug — fallback-narrativet er stærkere end "alle eggs in one basket".

### Breaking changes

Ingen for eksisterende tenants. F179 er opt-in.

### Test plan

- [ ] `pnpm typecheck` clean
- [ ] Unit: `chooseCostStrategy` returnerer korrekt strategi for hver kombination af job-flags + tenant-default
- [ ] Unit: `GoogleGeminiBackend.submitToBatch` builds korrekt request-body (mock provider)
- [ ] Unit: `AnthropicDirectBackend.submitToBatch` builds korrekt request-body (mock provider)
- [ ] Integration: end-to-end batch via Anthropic-direct mod test-tenant (kræver real Anthropic API key)
- [ ] Integration: end-to-end batch via Gemini-direct mod test-tenant
- [ ] E2E: cost-savings-delta målt mod identical OpenRouter-chain-baseline; assertér ≥40 % savings
- [ ] Failure: tenant uden direct-key + uden master-key → bulk-direct fail-loud
- [ ] Failure: batch submit fejler → ingest_jobs marked 'failed' med tydelig fejlmessage, curator kan retry

## Implementation Steps

1. Verify provider features mod live docs (Anthropic Batch + caching, Gemini Batch + caching, OpenRouter Gemini-passthrough). Opdater plan-doc tal hvis væsentligt afvigende.
2. Migration 0015 + schema-update.
3. `cost-strategy.ts` med stub-resolver.
4. `AnthropicDirectBackend` med Batch + caching. Verify-script.
5. `GoogleGeminiBackend` med Batch + caching. Verify-script.
6. `batch-poller.ts` background-loop. Wire i `apps/server/src/index.ts` boot-sequence.
7. Curator UI toggle + cost-estimate-endpoint.
8. SSE broadcast for batch status-updates.
9. End-to-end test mod real provider-keys på test-tenant.
10. Sanne onboarding pilot — flip hendes tenant til `defaultIngestStrategy='bulk-direct'`, verify cost-reduction empirisk.

## Dependencies

- **F149 Pluggable Ingest Backends** ✅ planned — F179 udvider F149's `IngestBackend`-interface med to nye implementeringer.
- **F143 Persistent ingest queue** ✅ — `ingest_jobs.priority` + `scheduledAt` allerede der; F179 tilføjer `cost_strategy` + `batch_id`.
- **F156 Credits-Based LLM Metering** ✅ planned — credits-debit virker uændret via `usage.cost`. F179 reducerer cost, ikke billing-logic.
- **F87 SSE event-stream** ✅ — bruges til at broadcast batch-status-updates til admin-UI.
- **F19 Auto-Approval Policy** ✅ — anvendes på candidates der kommer ud af bulk-batch (samme code-path som real-time).

## Open Questions

- **Skal vi support multiple parallel batches per tenant?** Forslag: yes. Hvis curator har en igangværende 200-source onboarding-batch og uploader 5 nye PDFs separat, skal de 5 kunne starte deres egen mindre batch uden at vente på de 200. Implementation: hver curator-upload-session får sin egen batch_token; de 5 og de 200 kører som to separate batches.
- **Skal vi cap'e antal samtidige bulk-batches per tenant?** Hvis Sanne uploader 5 batches på 200 hver, betaler hun for 1000 sources samtidigt — kan over-belaste hendes credits. Forslag: tenant.max_concurrent_bulk_batches default 3. Pro tier 5. Business 10. Configurable.
- **OpenRouter Gemini caching — verify before architecture-lock**: hvis det viser sig at OpenRouter DOES support Gemini caching with `cache_control` markers, kan vi simplificere F179 til kun at handle om Batch API + Anthropic-direct. Worth checking.
- **Default flip til 'bulk-direct' for Business tier — hvornår?** Forslag: efter Phase 5, når mindst 3 Business-tenants har kørt bulk-batches uden incidents i 30 dage. Konservativt rollout for at undgå "alle Business-tenants oplevede 24h-latency overnight"-overraskelse.

## Related Features

- **F149** — F179 er den naturlige udvidelse af F149's pluggable-arkitektur til at ramme cost-economics ud over multi-model fleksibilitet.
- **F156** — credits-debit profiterer direkte; bulk-direct sænker credit-burn med 50-65 %.
- **F143** — eksisterende ingest_jobs-queue + priority-flag er fundamentet for batch-routing.
- **F178** (Landing build automation) — sister-feature i samme pattern: F178 bruger GitHub Actions for SSG fordi auto-deploy ikke er gratis hos Fly. F179 bruger direct-provider-API'er fordi cost-rabatten ikke er gratis via OpenRouter.

## Effort Estimate

**Medium 3-5 dage** fordelt over 5 phases:

- Phase 1 schema + helpers: 0.5 dag
- Phase 2 AnthropicDirectBackend: 1 dag
- Phase 3 GoogleGeminiBackend: 1.5 dag
- Phase 4 batch poller + UI: 1 dag
- Phase 5 default flip per Business-tenant: deferred, opt-in

Includes typecheck, unit-tests for `chooseCostStrategy`, integration-tests via mock providers, end-to-end verify-script mod real test-tenant.

## Inspiration

Christian's incisive question 2026-05-02 efter min F149 cost-optimization-enrichment landede:

> *"Men ingester vi ikke med Flash i production? Kan vi lave Prompt caching og Batch API på open router eller hvis vi bruger Flash API direkte?"*

Det afslørede en konflation i mit oprindelige F149-tilføjelse: jeg cited Anthropic-numre (10 % cached, 50 % batch) og applicerede dem universelt, men vores prod-default er Flash via OpenRouter, hvor de fleste af de optimeringer ikke er native tilgængelige. F179 er den korrekte arkitektoniske respons — hybrid path-strategy der bruger OpenRouter's chain-fleksibilitet til real-time + provider-direct API'er til bulk hvor cost-savings reelt findes.
