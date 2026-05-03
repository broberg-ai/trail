# Trail — Roadmap

**Last updated:** 2026-05-02
**Source of truth for feature numbering:** [FEATURES.md](./FEATURES.md)

---

## Philosophy

Trail ships in three phases. Each phase is independently deployable; Phase 2 and Phase 3 build on Phase 1 without rewrites. The numbering scheme is stable — features keep their F-number across phases.

| Phase | Audience | Storage | Tenancy | Billing |
|-------|----------|---------|---------|---------|
| **1 — MVP** | Sanne Andersen (customer #1) | Local filesystem | Single-tenant (schema-aware) | Manual |
| **2 — Business SaaS** | FysioDK + open signups | R2 | Multi-tenant (LibSQL or Postgres RLS) | Stripe |
| **3 — Enterprise** | Healthcare / Legal / Financial | Customer-owned or dedicated | Hybrid (SaaS + on-prem) | Contract |

---

## Phase 1 — MVP · Done (49 features)

Everything needed to run an end-to-end ingest → wiki → chat flow for a single-tenant customer. Most of the depth beyond the minimum has also landed — typed relationships, heuristic decay, per-KB seq IDs, durable chat history, persistent ingest queue, Work Layer — which is why Phase 1 is much closer to "ready" than the 2026-04-18 snapshot suggested.

### Foundations (original 20)

| # | Feature | Shipped |
|---|---------|---------|
| F01 | Monorepo + FSL-1.1-Apache-2.0 License | 2026-04 |
| F02 | Tenant-Aware Drizzle Schema + SQLite + FTS5 (9 tables) | 2026-04 |
| F03 | Google OAuth + Session Cookies | 2026-04 |
| F04 | Knowledge Bases CRUD | 2026-04 |
| F05 | Sources (Upload, List, Archive) | 2026-04 |
| F06 | Ingest Pipeline (Claude Code subprocess + MCP) | 2026-04 |
| F07 | Wiki Document Model + Cross-References | 2026-04 |
| F08 | PDF Pipeline (Text + Images + Anthropic Vision) | 2026-04 |
| F09 | Markdown Ingest Pipeline | 2026-04 |
| F10 | FTS5 Full-Text Search with Auto-Sync Triggers | 2026-04 |
| F11 | MCP Stdio Server (Guide/Search/Read/Write/Delete) | 2026-04 |
| F12 | Chat Endpoint (Synthesize + Cite) | 2026-04 |
| F13 | LocalStorage Adapter + Pluggable Storage Interface | 2026-04 |
| F14 | Multi-Provider LLM Adapter (`claude -p` + Anthropic API) | 2026-04 |
| F15 | Bidirectional `document_references` | 2026-04 |
| F16 | Wiki Events (Replay-Able Event Stream, Full Payloads) | 2026-04 |
| F87 | Typed Event Stream (SSE) + Live Badges + Per-Panel Reactivity | 2026-04 |
| F89 | Chat Tools — MCP-Backed Introspection for Structural Questions | 2026-04 |
| F90 | Dynamic Curator Actions + Per-Trail Lint Policy + Action Translation | 2026-04 |
| F91 | Neuron Editor (Markdown Split-View, Queue-Routed Save) | 2026-04 |

### Curation + queue (Phase 1 unblockers)

| # | Feature | Shipped |
|---|---------|---------|
| F17 | Curation Queue — HTTP Endpoints + sole wiki write path | 2026-04 |
| F18 | Curator UI Shell (Vite + Preact) | 2026-04 |
| F19 | Auto-Approval Policy Engine | 2026-04 |
| F32 | Lint Pass (Orphans / Stale / Contradictions + Scheduler) | 2026-04 |
| F40.1 | libSQL driver swap (single-tenant `@libsql/client`) | 2026-04 |
| F92 | Tags on Neurons (Filter + Facet + Auto-Suggest) | 2026-04 |

### Connectors, pipelines, dogfooding

| # | Feature | Shipped |
|---|---------|---------|
| F24 | DOCX Pipeline | 2026-04 |
| F39 | Claude Code Session → Trail Ingest | 2026-04 |
| F95 | Connectors (ingestion attribution) | 2026-04 |
| F96 | Action Recommender | 2026-04 |
| F98 | Orphan-lint Connector-Awareness | 2026-04 |
| F102 | Auto-maintained Glossary Neuron | 2026-04 |
| F135 | Slug-based KB URLs (accept slug or UUID) | 2026-04 |

### Depth + durability (2026-04-20 / 21 batch)

| # | Feature | Shipped |
|---|---------|---------|
| F99 | Obsidian-style Neuron Graph (Sigma + FA2) | 2026-04 |
| F136 | Compile-log Card (terminal-style progress in source rows) | 2026-04 |
| F137 | Typed Neuron Relationships (edge_type column + render) | 2026-04 |
| F138 | Work Layer — Tasks, Bugs, Milestones, Decisions (Kanban) | 2026-04 |
| F139 | Heuristic Neurons with Temporal Decay | 2026-04 |
| F140 | Hierarchical Context Inheritance (`_schema.md`) | 2026-04 |
| F141 | Neuron Access Telemetry + Usage Weighting | 2026-04 |
| F142 | New Neuron modal (curator-initiated create) | 2026-04 |
| F143 | Persistent ingest queue (`ingest_jobs` table, boot recovery) | 2026-04-21 |
| F144 | Chat history persistence (sessions + turns, sidebar) | 2026-04-21 |
| F145 | Per-KB seq IDs (`<kbPrefix>_00000219` canonical handle) | 2026-04-21 |
| F111 | Trail Web Clipper (Browser Extension) — **local/dev** · Chrome Web Store submission pending | 2026-04-22 |
| F111.1 | Per-user Bearer API Keys (`trail_` prefix, SHA-256 hash, revoke endpoint) | 2026-04-22 |
| F97 | Activity Log (audit timeline) — `activity_log` table + 5 indexes, `logActivity()` helper, broadcaster subscriber + 7 explicit call-sites (auth, kb, source, lint manual+scheduled), read API w/ cursor pagination, `/activity` admin panel w/ Trail-styled dropdown + Load-more | 2026-05-02 |

**End-to-end verified:** Markdown source → 6-8 cross-referenced wiki pages in ~60-100s. 8-page Danish PDF (NADA acupuncture) → 6 images extracted → vision-described → 7 wiki pages in ~155s.

---

## Phase 1 — MVP · In Progress

| # | Feature | Owner | Target |
|---|---------|-------|--------|

---

## Phase 1 — MVP · Planned Next (sequenced)

The remaining Phase 1 scope, ordered by leverage and dependency.

### Unblockers — must land to call Phase 1 complete

| # | Feature | Depends On | Effort | Status |
|---|---------|------------|--------|--------|
| F33 | ~~Fly.io deploy~~ — **Done 2026-04-30** (Phase 1A engine `trail-engine-001` + Phase 1B admin `trail-admin` both live in `broberg-ai/arn`. OAuth GitHub+Google, magic-link, invite-flow, reverse-proxy w/ Bearer key→tenant lookup, ambient sounds, /logout, F168 Beam used to seed Sanne. App at `app.trailmem.com`, engine at `engine.trailmem.com`. Subsumes the OAuth-prod-credentials + Sanne-onboarding operational sub-tasks previously tracked as separate F-numbers.) | F111.2, F160, F162, F164 | Large |
| F62 | demo.trailmem.com — public reference site | F17, F18 | Medium | ⏭ Planned |

### Quality + UX — ship with Phase 1

| # | Feature | Depends On | Effort |
|---|---------|------------|--------|
| F20 | ~~Curator Diff UI~~ — **Done 2026-04-25** (side-by-side before/after diff on update-op candidates, shared `@trail/shared/diff` LCS algorithm) | F18, F16 | Small |
| F21 | ~~Ingest Backpressure~~ — **Done 2026-04-25** (global cap=5 + per-tenant 60/h + 30s drain ticker, env-tunable, no schema change) | F17 | Small |
| F22 | Stable `{#claim-xx}` Anchors | F07 | Small |
| F23 | ~~Wiki-Link Parser (`[[]]`, `[[kb:]]`, `[[ext:]]`)~~ — **Done 2026-04-24** (shared `@trail/shared/wiki-links` package, intra + cross-kb resolved, ext placeholder) | F07 | Small |
| F30 | ~~Chat Citations Render~~ — **Done 2026-04-24** (chat API returns `renderedAnswer` with server-side tenant-scoped cross-KB resolution) | F12, F23 | Small |
| F148 | ~~Link Integrity~~ — **Done 2026-04-24** (3-layer defence: prompt-rules teaching slugify, URL-resolution fallback w/ DA↔EN fold, link-checker service + `broken_links` table + `/link-check` routes; admin panel via F150) | F06, F32, F140 | Medium |
| F149 | Pluggable Ingest Backends (Claude CLI + OpenRouter, live fallback chain, per-tenant billing, per-KB model) | F06, F111.2, F137, F140, F143, F148 | Large |
| F150 | ~~Admin Link-Report Panel~~ — **Done 2026-04-26** (UI for F148 `broken_links` + accept/dismiss/reopen + SSE live-update on `link_check_*` events) | F148, F87, F17, F18 | Small |
| F151 | Cost & Quality Dashboard (cost-tab + side-by-side ingest-compare for F149 data) | F149, F143, F148 | Medium |
| F152 | Runtime Model Switcher UI (per-KB model-dropdown, chain-preview, F151 recommendation-badge) | F149, F151, F18 | Small |
| F153 | Continuous online backup of `trail.db` to Cloudflare R2 (VACUUM INTO + gzip + R2 multipart upload, `backup-scheduler` service, admin panel, stopped-server restore CLI) | — | Small |
| F158 | ~~Idempotent Contradiction-Lint~~ — **Done 2026-04-25** (signature-skip → 0 LLM calls when brain at rest; saves ~1740 Haiku-calls/day on quiet 348-Neuron fleet) | F32, F118 | Small |
| F159 | [Pluggable Chat Backends](./features/F159-pluggable-chat-backends.md) — F149 mirror for chat: ClaudeCLIBackend + OpenRouterBackend, per-KB chain config, cost stamping. **Unblocks F33** (Fly.io prod chat needs no `claude` CLI). | F149, F144 | Medium |
| F111.2 | [Admin API-key panel + multi-origin CORS](./features/F111.2-admin-api-keys-cors.md) — admin UI til at generere/liste/revoke `trail_<64hex>` Bearer keys, `TRAIL_ALLOWED_ORIGINS` env-CSV til at whitelist'e externe sites uden code-edits, `docs/INTEGRATION-API.md` som kontrakt for cc-sessioner i andre repos. **Unblocks Sanne Andersen integration** — første eksterne integrations-customer kan kalde `/api/v1/chat` fra deres localhost-site uden at vi mocker. | F111.1 | Small |
| F160 | [Three-tier integration contract + audience-aware chat](./features/F160-three-tier-integration-contract.md) — formaliserer Trail's eksterne API i 3 lag (retrieval / knowledge-prose / render-ready) × 3 audiences (curator / tool / public). Lag 1 retrieval er primær integrations-vej for site-LLM-orchestratorer (Sanne med booking + shop), 0 LLM-kald på Trail-siden. Lag 2/3 chat er convenience-wrappers med audience-aware prosa-tone. Plus per-KB persona-overskrivning + nyt `packages/sdk` med typed klient. **Unblocks ægte Sanne-integration** med korrekt kunde-tone i stedet for klinisk admin-prose. | F111.2, F156, F159 | Medium |
| F161 | [Inline media in retrieval responses](./features/F161-inline-media-in-retrieval.md) — `/retrieve` returnerer separat `images[]`-array med absolutte URLs + alt-tekst, plus audience-aware filter på `GET /documents/:docId/images/:filename` så heuristic/internal-tagged Neuron-billeder ikke kan hentes af tool/public keys. INTEGRATION-API-doc dokumenterer proxy-mønstret consumer skal bruge for at undgå Bearer-leak til browseren. **Aktiveres når Sanne uploader behandlings-fotos.** | F25, F160 | Small |
| F162 | [Source dedup via SHA-256 checksum](./features/F162-source-dedup-via-checksum.md) — upload-route computer SHA-256 før storage-write, query'er existing source i samme KB, returnerer 409 m/ structured `code: 'duplicate_source'` + existingDocumentId hvis match. `?force=true` escape-hatch. Boot-time backfill populater hash på legacy sources. Admin-UI viser custom modal m/ Annullér / Åbn eksisterende / Upload alligevel. **Unblocker bulk-upload til Sanne's KB** — curator kan trygge re-uploade fra forskellige mapper uden at brænde ingest-credits på dubletter. | F08, F25 | Small |
| F163 | [Image Gallery panel (curator-facing browse + search)](./features/F163-image-gallery-panel.md) — nyt `/kb/:kbId/images` admin-panel, grid-view over `document_images`, FTS-search på `vision_description`, per-source-filter, klik-til-modal m/ "open in source"-link. Bygger udelukkende på F161's data + endpoint, plus cursor-pagination tilføjelse. **Curator-flow til at finde billeder uden at chatte** — terapeut/researcher/journalist kan browse deres image-corpus som Photos.app i stedet for at scrolle PDF'er manuelt. Aktiveres når F161-rerun har annoteret Sanne's 224 bog-billeder. | F161 | Small-Medium |
| F164 | [Background jobs framework + bulk Vision-rerun](./features/F164-background-jobs-bulk-vision.md) — generisk `jobs`-tabel + in-process runner med crash-recovery (F143 zombie-pattern), abort-support, real-time progress via SSE. Vision provider-chain inverteret: Anthropic-direct primær (4x hurtigere end OpenRouter-passet), OpenRouter fallback. `MAX_CONCURRENT_JOBS=4` (sized til Fly.io shared-cpu-1x). Frontend: progress-modal med live progress-bar + ETA + cost-tracking, "Kør i baggrunden"-toggle, header-badge for aktive jobs, completion-modal med 6-image visuel sample-grid + 👍👎 quality-rating (gemmes i nyt `vision_quality_ratings`-tabel for fremtidens prompt-tuning). Job-history-side `/admin/jobs` med filter/search/aggregat-stats. Første consumer: bulk Vision-rerun ("Vælg alle kilder" → pre-flight cost-estimat → spawned job → modal/badge handoff). 6 faser, ~4 dage. **Løser**: dagens "knappen forsvandt og jeg fik ingen toast" Vision-rerun UX. | F143, F156, F161 | Large |
| F163.1 | [Image Gallery: bulk-actions (multi-select + flag/delete)](./features/F163.1-image-gallery-bulk-actions.md) — udvider F163's grid-panel med view-toggle (cards ↔ list), multi-select med checkboxes, og bulk-actions: 👎 Flag (mapper til F164 Phase 5 thumbs-down) + 🗑 Delete (HARD-delete via `DELETE FROM document_images WHERE id IN ...` + storage-blob-purge, cascades til `vision_quality_ratings` + FTS). Tenant-scope guard fail-closed på cross-tenant probe; Bearer-keys forbudt fra delete (operator-only). Bekræftelses-modal for delete (irreversibel), ingen for flag (reversibel). **Løser**: Sannes 248-billede-corpus har ~30-50 ren støj (decorative-fragments, dark rectangles, page-numbers) som curator skal kunne fjerne 30 ad gangen, ikke ét via Lightbox-klik per billede. 4 faser, ~½-1 dag. | F163, F164 Phase 5 | Medium |
| F163.3 | [Image-detail Lightbox port (CMS-style)](./features/F163.3-image-detail-cms-style.md) — port af CMS-projektets `localhost:3010/admin/media` viewer-design til Trail's image-Lightbox: image-fyld 70% venstre + side-panel 30% højre m/ AI Analysis (caption + alt-text + tags-editor) + EXIF data (camera, lens, ISO, shutter, aperture, focal-length — kun udfyldt for F25 standalone-uploads via `exifr`-extraction ved upload-tid; PDF-fragmenter har ingen). Top-right toolbar: 5 icon-buttons (open-in-tab, copy URL, re-scan via F164 vision-rerun, delete via F163.1 bulk-delete + danger-confirm, close-X). Pagination ←/→ + keyboard mellem billeder i nuværende hits[]-array. Multi-locale caption-tabs (DA/EN/DE) er **non-goal v1**; locale-aware Vision-prompt lander som F163.3.0 quick-fix (KB.language → prompt-instruction) så curator ser danske beskrivelser i den nye Lightbox. Migrations 0029 (EXIF-kolonner) + 0030 (per-image tags). 5 phases (0=KB-locale, 1=schema+EXIF, 2=tag-CRUD, 3=response-shape, 4=frontend-rewrite, 5=polish), ~1 dag total. **Driver**: Sannes 248-billede-corpus + kommende behandlingsfoto-upload-flow (EXIF surfacer kun her). | F161, F163, F163.1, F163.2, F164 Phase 4+5 | Medium-Large |
| F163.2 | [Image auto-flag (Vision-prompt + regex) + Flagged filter](./features/F163.2-image-auto-flag-and-filter.md) — to komplementære auto-flag-signaler skriver til ny `document_images.auto_flag_signal` kolonne: (1) Vision-prompt instrueres til at returnere struktureret `[QUALITY: low|normal]`-marker i description-output (primær — modellen har globalt overblik over pixels), (2) regex-backstop matcher tell-tale fraser i description-text ("too small to identify", "minimal graphic element", "decorative placeholder", "pixel-like shape" etc.) med konservativt match-budget < 1% false-positive. Curator får ny "Status: Flagget"-dropdown ved siden af source-filter med 5 modes (alle / flagget / kun auto / kun curator / ikke flagget). Visuelle badges på cards + list (⚐ auto, ⚑ curator) med hover-tooltip på `auto_flag_reason`. Curator-rating='up' clearer auto-flag-signalet (curator har set, sagt ok). Ingen auto-DELETE — flag er kun hint, aldrig destruktiv. **Løser**: curator scanner i dag manuelt 248 billeder for at finde de 30-50 dårlige; auto-flag overfører Vision-modellens egen vurdering ("too small/unclear/decorative") til en handlingsbar status. 5 faser (Phase 5 sweep er opt-in for legacy data), ~½-1 dag. | F161, F163, F163.1, F164 Phase 3, F164 Phase 5 | Medium |
| F165 | ~~Async Vision-describe (move out of upload critical path)~~ — **Done 2026-04-29** (upload returns 201 fast w/ `vision_description=NULL` rows, auto-submits vision-rerun job; `TRAIL_PDF_TIMEOUT_MS=240000`. Verified end-to-end on 149-image botanical PDF.) | F161, F164 | Small |
| F165.1 | ~~Vision derivatives (WebP) + strict-availability fallback~~ — **Done 2026-05-02** (migration 0030 + `vision_derivative_path` column, `ensureDerivative()` w/ 3MB-or-4MP threshold, sharp@0.34.5, F164 Phase 3 fallback tightened to 5xx/timeout/ECONN — 4xx incl. 413 re-throws so input-shape bugs don't hide as availability flaps. 22/22 verify assertions pass.) | F161, F164 Phase 3, F165 | Small-Medium |
| F33 | [Fly.io deploy: multi-tenant admin + stateless engine fleet (Phase 1)](./features/F33-fly-deploy-multi-tenant.md) — Trail flyttes fra `127.0.0.1:58031` til Fly.io i org `broberg-ai`/region `arn`. Arkitektur: **én** multi-tenant admin på `app.trailmem.com` (egen `control.db` med organizations / control_users / control_tenants / tenant_engines / control_api_keys / magic_links) + **stateless engine-fleet** bag `engine.trailmem.com` (Phase 1: CNAME til engine-001, Phase 2: F170 router) med **én trail.db pr. tenant** på engine-volume. Bearer-key carries tenant scope (per F111.2); engine memoizer `key_hash → tenant` lookups 60s. Forward-kompatibel med F170: `tenant_engines` schema fra dag 1, kan udvides uden migration. To deploy-paths: `pnpm ship` (direkte flyctl) + `pnpm deploy` (GH Actions). DNS via Cloudflare DNS Manager MCP. **Tonight's gate**: Sanne live på engine-001, Eir-chat på hendes site rammer `engine.trailmem.com/api/v1/chat` og svarer med viden fra hendes beamede trail.db. | F111.2, F160, F162, F164 | Large |
| F168 | [Beam: tenant-level export/import between Trail engines](./features/F168-beam-tenant-migration.md) — "Beam me up, Scotty" ✨ — eksportér én tenants komplette state (trail.db + alle upload-blobs) som `*.beam.tar.gz` og importér på en anden engine atomisk. CLI: `pnpm trail beam export/import/ship/verify`. Manifest med schema-version + sha256 + row-counts + total-bytes. Single-tenant filter (kører `DELETE WHERE tenant_id != ?` på snapshot før tar). Engine-side `/internal/beam/import` endpoint (BEAM_TOKEN m2m auth, separat fra Bearer-keys), staging → atomic rename, FTS5 rebuild post-import. Force-replace flytter eksisterende tenant til `_archive/` (defensive against data loss). Phase 2: engine-to-engine streaming for F170 migration. **Tonight's brug**: seed Sanne's lokale trail.db → Fly engine-001 før Eir-chat går live. **Future brug**: F170-orkestrator flytter tenants mellem engines når fleet rebalanceres. | F33 | Medium |
| F169 | [New-engine provisioning script (`pnpm trail engine spawn`)](./features/F169-engine-provisioning-script.md) — én kommando der kører hele engine-onboarding-checklisten: `flyctl apps create` (org broberg-ai) + volume + secrets (BEAM_TOKEN, AI-keys, CONTROL_PLANE_URL) + `flyctl deploy` + Cloudflare CNAME via DNS MCP + `flyctl certs create` + register i admin's nye `engines` tabel (migration 0028). Idempotent — re-run skipper det der allerede er gjort. Yderligere kommandoer: `engine list`, `engine retire` (refuses hvis tenants assigned, peger på F170's migrate), `engine rotate-beam-token [--all]`. **Løser**: customer #2 onboarding bliver én kommando væk i stedet for en 11-trins manuel checkliste. F171 auto-scaler vil senere kalde samme command server-side. | F33, F168, DNS Manager MCP | Small-Medium |
| F173 | [Tigris-backed blob storage (S3 driver for `@trail/storage`)](./features/F173-tigris-blob-storage.md) — Trail's `Storage`-interface (`packages/storage`) er allerede skrevet med en TODO-kommentar om "Phase 2 will add Cloudflare R2 / S3 implementations" — F173 implementerer det med **Tigris** (Fly's native S3-compatible object store, 0ms latency fra arn-baserede engines, $0 egress, auto-mounted credentials). Driver vælges via `TRAIL_STORAGE_DRIVER=local|s3` env (lokal dev forbliver fs). Bucket-per-engine pattern (`trail-engine-NNN-blobs`) — F169 spawn-scriptet integrerer `fly storage create` automatisk. Migration-script læser eksisterende blobs fra volume + uploader til Tigris uden at røre `document_images.storage_path` (paths er allerede S3-key-shaped). **Storage-økonomi**: Fly volume $0.15/GB/mo vs Tigris $0.020/GB/mo — **10× billigere** ved alle skalaer. Bonus: F170 inter-engine tenant-migration bliver ~100× hurtigere fordi vi kun kopierer trail.db (~50 MB SQLite) og blob-paths bliver ved at være gyldige. **Ulempe**: mild Fly lock-in (R2 dokumenteret som fallback hvis Tigris-stabilitet svigter). | F33, F161 (storage_path) | Medium |
| F172 | [Self-service onboarding (sign-up + first trail)](./features/F172-self-service-onboarding.md) — **Phase 2** — landes efter F33 Phase 1B (admin på Fly med magic-link). To routes på `app.trailmem.com`: `/login` (eksisterende brugere → email → magic-link) og `/onboarding` (nye brugere → 3-trins wizard: email+navn → org+slug → first-trail-navn+sprog → `POST /api/auth/sign-up` der i én transaktion opretter org + user + tenant + KB i `control.db`, allokerer engine via `pickEngine()` (default engine-001 indtil F170 lander), provisionerer tom tenant.db på engine via F168 `/internal/beam/import` med synthetic empty-seed, sender magic-link via Resend). `/auth/verify` lander magic-linket → cookie session → `/onboarding/welcome` første gang. Resend-config: `RESEND_FROM=trail@webhouse.dk` Phase 1 (eneste validerede domæne pt.), migrate til `noreply@trailmem.com` Phase 2 efter SPF+DKIM+DMARC verification via DNS Manager MCP. www-CTA-knapper "Initialize trail" og "Sign in" pointes på `/onboarding` og `/login` (to-linje edit + landing redeploy). Email = global identitet, magic-link er eneste auth-surface (ingen passwords). Slug-uniqueness check live-mens-bruger-skriver. Reserverede slugs (`admin`, `api`, `app`, `engine`, etc.) afvises front-end. **Non-goals**: multi-user invites ved sign-up, billing-flow, social-login, data-import-wizard, trial-expiry. **Lukker scaling-gap**: customer #2 onboarding bliver "tip the URL", ingen operator-i-loop. | F33 Phase 1B, F168, F169 | Medium |
| F170 | [Multi-engine orchestrator (router + tenant migration)](./features/F170-multi-engine-orchestrator.md) — **Phase 2** — landes når fleet ≥ 2 engines. Tre dele: (1) **routing-layer** ved `engine.trailmem.com` som **Fly Hono micro-service** `trail-router` i broberg-ai/arn (parser Bearer → query admin → in-mem cache `key_hash → engine_url` 60s → forward via Fly's `*.flycast` mesh). Cloudflare Worker overvejet og fravalgt — vi er all-in på Fly, alle engines er pinned til arn (ingen multi-region), og CF edge giver kun marginal latens-gevinst for EU-til-arn requests; Worker holdes som "future option" hvis multi-region eller >50M req/mo lander; (2) **tenant migration** primitive: `pnpm trail tenant migrate <slug> --to <engine-id>` — drain (503 + Retry-After 5-30s) → F168 beam mellem engines → atomic flip i `tenant_engines` → cache-bust → cleanup; (3) **fleet-aware admin** view (`/admin/fleet`) med engine-cards + tenant-list + per-engine health-snapshots (polled fra `/internal/health-detail` hver 60s, gemmes i ny `engine_health_snapshots` tabel). Migration_log audit-tabel for hver tenant-flytning. Ingen auto-scaling endnu (F171). Ingen zero-downtime — drain-windowet er 5-30s, acceptable for Phase 2. **Forward-skitseret nu** så F33's schema er forward-kompatibel; implementering paused indtil customer #2 lander eller Sannes load kræver dedicated engine. | F33, F168, F169 | Large |

### Pipelines + Adapters — widen the ingest surface

| # | Feature | Depends On | Effort |
|---|---------|------------|--------|
| F25 | ~~Image Pipeline (Standalone + SVG Passthrough)~~ — **Done 2026-04-25** (drop-in via F28 registry, OpenRouter vision fallback når Anthropic-key mangler, cost stamped on `documents.extract_cost_cents` for F156 credits) | F28, F27 | Small |
| ~~F26~~ | ~~HTML / Web Clipper Ingest~~ — covered by F111 | — | — |
| F27 | Pluggable Vision Adapter | F08 | Small |
| F28 | ~~Pluggable Pipeline Interface~~ — **Done 2026-04-25** (`@trail/pipelines` registry + dispatch, 4 built-ins wrapped, uploads.ts + recover-pending-sources.ts unified to one call) | F06 | Medium |

### Widget + Embed — let consumers integrate

| # | Feature | Depends On | Effort |
|---|---------|------------|--------|
| F29 | `<trail-chat>` Embeddable Widget (Lit) | F12 | Medium |
| F31 | Reader Feedback Button → Queue | F17, F29 | Small |

### Dogfooding

| # | Feature | Depends On | Effort |
|---|---------|------------|--------|
| F36 | `docs.trailmem.com` as a Trail Brain | F17, F28, F33, F40 | Medium |

---

## Phase 2 — Business SaaS · Planned (22 features)

Multi-tenant SaaS, billing, richer pipelines, first 3rd-party adapters.

### Infrastructure

| # | Feature | Priority |
|---|---------|----------|
| F40 | Multi-Tenancy on `app.trailmem.com` (LibSQL/Turso or Postgres RLS) | Must |
| F41 | Tenant Provisioning + Signup Flow | Must |
| F42 | Cloudflare R2 Storage Adapter | Must |
| F43 | Stripe Billing (Hobby / Pro / Business) | Must |
| F44 | Usage Metering | Must |
| F53 | Custom Subdomains per Tenant | Should |
| F61 | ~~SaaS Domain Pick~~ — **Done: `trailmem.com`** | — |
| F154 | [Trail Control Plane (remote fleet management)](./features/F154-trail-control-plane.md) — kritisk ved Stadie 2, se [DEPLOYMENT-STAGES.md](./DEPLOYMENT-STAGES.md) | Must |
| F155 | [Auto-scaling Policy (rule-drevet spawn/resize)](./features/F155-auto-scaling-policy.md) — automatiserer F154 handlinger ved Stadie 3 | Should |
| F156 | [Credits-Based LLM Metering](./features/F156-credits-based-llm-metering.md) — user-paid LLM via credits + Stripe Checkout pakker; afgørende for unit economics | Must |

### SaaS Product UX

| # | Feature | Priority |
|---|---------|----------|
| F38 | Cross-Trail Search + Chat (Frontpage) | Must — this is the SaaS product |

### Strategic Adapter + Customer #2

| # | Feature | Priority |
|---|---------|----------|
| F45 | `@webhouse/cms` Adapter — the strategic integration | Must |
| F52 | FysioDK Aalborg Onboarding (Customer #2, via F45) | Must |

### Richer Pipelines

| # | Feature | Priority |
|---|---------|----------|
| F46 | Video Transcription Pipeline | Should |
| F47 | ~~Audio Transcription Pipeline~~ — **Done 2026-04-25** (OpenAI Whisper-1, drop-in via F28, cost stamped on extract_cost_cents; verified end-to-end with Sanne's 3-min Danish wav: 1248 chars, 2¢) | Should |
| F48 | Email Ingest Pipeline | Could |
| F49 | Slack Ingest Pipeline | Could |
| ~~F50~~ | ~~Web Clipper Browser Extension~~ — shipped as F111 (local); Chrome store TBD | — |
| F147 | Share Extension (iOS + Android) — mobile share sheet target | Should |
| F157 | [Trail iOS App](./features/F157-trail-ios-app.md) — dedicated native iPhone+iPad: voice→Neuron, camera scan→Source, Home Screen widget, voice-to-voice chat, Shortcuts/Siri intents | Should |

### Widget Growth

| # | Feature | Priority |
|---|---------|----------|
| F51 | Widget Customization (CSS Variables + Branding) | Should |

### Adapters (3rd-Party CMS/Knowledge Systems)

| # | Feature | Priority |
|---|---------|----------|
| F55 | Adapter SDK (`@trail/adapter-sdk`) | Must — gates F58-F60 |
| F58 | WordPress Adapter | Should |
| F59 | Sanity Adapter | Could |
| F60 | Notion Adapter + Sync | Could |

### Curator Tools

| # | Feature | Priority |
|---|---------|----------|
| F54 | Analytics Dashboard for Curators | Should |
| F56 | Wiki Freshness Scoring in Lint | Should |
| F57 | Gap Suggestions from Low-Confidence Queries | Should |
| F92 | Tags on Neurons (Filter + Facet + Auto-Suggest) | Should |

---

## Phase 3 — Enterprise · Planned (17 features)

Regulated industries, on-prem, compliance, advanced architecture.

### Identity + Compliance

| # | Feature | Priority |
|---|---------|----------|
| F70 | SSO: SAML 2.0 + SCIM | Must |
| F71 | Audit Logs + Retention | Must |
| F73 | SOC 2 Type II Preparation | Must |
| F81 | Per-KB Encryption at Rest | Must |

### Deployment Surface

| # | Feature | Priority |
|---|---------|----------|
| F72 | On-Prem Docker / Helm Deploy | Must |
| F77 | Multi-Region Deployments | Should |
| F84 | Dedicated PostgreSQL Option | Should |
| F86 | SLA Contracts + Monitoring | Should |

### Event-Sourcing Unlocks (free because F16 is already event-sourced)

| # | Feature | Priority |
|---|---------|----------|
| F74 | Time-Travel Queries | Should |
| F75 | Undo / Redo via Event Stream | Should |
| F76 | Real-Time Collaboration (CRDT) | Could |

### Knowledge Architecture

| # | Feature | Priority |
|---|---------|----------|
| F78 | Trust Tiers + Provenance Graph (Claims Table, joins F22 anchors) | Should |
| F79 | Scheduled Wiki Re-Compilation | Could |
| F80 | Federated Trail (`[[ext:…]]` Links) | Could |
| F85 | Continuous Lint (Real-Time, Not Periodic) | Could |

### Provider Flexibility

| # | Feature | Priority |
|---|---------|----------|
| F82 | Custom LLM Provider Adapters (Azure / Ollama / Bedrock) | Should |

### Curator Power Tools

| # | Feature | Priority |
|---|---------|----------|
| F83 | CLI for Curators (`trail queue approve …`) | Could |

---

## Critical path (top-down)

```
✅ F17    Queue API (sole wiki write path, two-session landed)
✅ F18    Curator UI — neurons/queue/sources/graph/work/chat/search/settings
✅ F40.1  libSQL driver swap (@libsql/client in use since packages/db/libsql-adapter.ts)
✅ F143   Persistent ingest queue (65-file batch survives server crash)
✅ F144   Chat history persistence (sessions + turns, sidebar)
✅ F145   Per-KB seq IDs (cross-session canonical handles)

✅ F148   Link Integrity (3-layer defence shipped 2026-04-24 + admin panel via F150 2026-04-26)
✅ F34    Landing deploy (trailmem.com live; content backlog handled by other sessions)
✅ F33    Fly.io deploy — multi-tenant admin + stateless engine fleet (live in broberg-ai/arn since 2026-04-30, OAuth + Sanne onboarding subsumed)
⏭ F62    demo.trailmem.com — polished public reference site ← forcing function for component polish

F28 Pipeline interface ─┬─► F24 DOCX
                        ├─► F25 Image/SVG
                        └─► F26 HTML

F29 Widget + F31 Feedback ─► Phase 2-ready consumer story

F45 @webhouse/cms adapter + F40.2 Multi-tenancy ─► F52 FysioDK

F40.2 Multi-tenancy ─┬─► F38 Cross-Trail search/chat ─► app.trailmem.com
                     └─► F36 docs.trailmem.com (Trail brain of our docs)

Public-facing trailmem.com surfaces (all Phase 1-shippable):
  F34   trailmem.com + www + trail.broberg.ai (landing — built, awaiting deploy)
  F62   demo.trailmem.com (demo brain, public)
  F36   docs.trailmem.com (Trail brain of trail's own docs — depends on F40.2)
```

**Phase-1 shippable definition:** F17 ✓ + F18 ✓ + F40.1 ✓ + F33 ✓ + F62 = Sanne on the live multi-tenant engine, with `trailmem.com` (landing), `demo.trailmem.com` (polished showcase), and her instance accessible via `app.trailmem.com`. F36 unlocks the docs-brain.

---

## Decisions still owed

1. **Brand naming** — user-facing label for a knowledge-base/wiki container. F38's plan doc assumes **Trail** / **Neuron**. Flagged as still open on user's side; lock in before F38 copy ships.
2. **F62 demo content** — which clinical domain (if any) to include. Sanne's material with consent, or an anonymised public-licensed alternative.

## Decisions resolved

- **F61 — SaaS domain** — `trailmem.com` registered at Cloudflare (2026-04-16). Subdomain map: `trailmem.com` + `www.trailmem.com` = landing (F34), `demo.trailmem.com` = public reference (F62), `docs.trailmem.com` = docs-as-Trail (F36), `app.trailmem.com` = SaaS engine (F40.2/F41). `trail.broberg.ai` remains as the engine-facing mirror of the landing.
- **F36 — Dogfood hosting** — tenant on `app.trailmem.com` (`trailwiki` tenant). Not self-hosted. Justification: the dogfood is more credible when it runs on the same multi-tenant infrastructure customers do.
- **F40 — Multi-tenancy strategy** — **libSQL embedded per-tenant** (one `.db` file per tenant on Fly Volume). Not Turso Cloud. Not Postgres RLS. Postgres stays available as a Phase 3 emergency path via `@trail/db`'s adapter pattern. Locked in SAAS-SCALING-PLAN.md 2026-04-16.
- **F42 — Storage** — **Tigris default + R2 alternative** via pluggable adapters. Per-tenant choice, `AWS_*` env convention, per-tenant migration as a background job. Locked in SAAS-SCALING-PLAN.md 2026-04-16.

---

## How to read this roadmap

- **FEATURES.md** is the index — every F-number, plan-doc link, status.
- **This file** groups features by phase + priority; it's what to read to plan a sprint.
- **docs/features/F{nn}-*.md** is the plan doc for each feature. Detailed design, impact analysis, implementation steps.
- **[F100-F133 thematic index](./F100-F133-themes-2026-05-02.md)** — read-only kategorisering af Karpathy-parity-batchen + F147 i 9 temaer med ship-rækkefølger og cross-refs. Hjælper med at vælge næste 3-5 features at uddybe efter F97/F148/F156.
- **F174 + F175** ([action-zone governance](./features/F174-action-zone-governance.md), [schema-level provenance enforcement](./features/F175-schema-provenance-enforcement.md)) — to net-nye features afledt af Shuyi Wang's "Should You Actually Try Karpathy's LLM Wiki?" (2026-04-16). F174 tagger candidates med green/yellow/red zone for governance-routing oven på F19 confidence-engine. F175 håndhæver `sources:`-frontmatter ved write-time som lock mod hallucination-pollution. Phase 2 begge. Effort: Medium 2-3d (F174) + Small-Medium 1-2d (F175).
- **F176** ([per-KB lint schedule + settings UI](./features/F176-per-kb-lint-schedule.md)) — flytter lint-cadence fra global env-var til per-KB `lint_schedule_days`-kolonne (1-90 dage, default 7). Settings-UI dropdown med "Anbefalet: 7 dage (weekly)"-badge + status-card der viser "Last pass / Next scheduled / Findings sidst". Verifikation viste at lokal dev-engine aldrig fyrer scheduled-pass pga. 4h boot-delay vs frequent restarts — F176 sænker også boot-delay til 5 min. Phase 1, Small 1d.
- **F177** ([pre-deploy build-context audit](./features/F177-pre-deploy-build-context-audit.md)) — `pnpm verify:dockerignore` CLI + GitHub Actions pre-merge gate der fail-closer hvis nogen `COPY`-source falder under en unanchored `.dockerignore`-pattern (eller hvis source-path er stale). Inspireret af 2026-05-02 v9 incident hvor `**/data` (unanchored) fangede `apps/server/src/data/glossary.json` og crash-loopede engine. Phase 1, Small ½-1d.
- **F178** ([landing build automation + auto-deploy](./features/F178-landing-build-automation-auto-deploy.md)) — tre lag der eliminerer hele klassen af "I committed but live shows old content"-bugs: (1) `pnpm --filter trail-landing ship` der tvinger `BUILD_OUT_DIR=deploy` + build + flyctl deploy, (2) Zod schema-validation på post-JSON med fail-loud-on-missing-fields, (3) GitHub Actions auto-deploy på push til main hvis `apps/landing/content/**` eller `apps/landing/public/**` ændres. Lukker præcis de fire fejl-modes der ramte 2026-05-02-session. Phase 1, Small ½-1d.
- **F179** ([provider-direct bulk-ingest path](./features/F179-provider-direct-bulk-ingest.md)) — hybrid path-strategy oven på F149: OpenRouter-chain forbliver real-time-default, MEN bulk/scheduled jobs routes til provider-direct API'er (GoogleGeminiBackend + AnthropicDirectBackend) der eksponerer prompt caching + Batch API native — features OpenRouter ikke passer alle igennem. 50-65% cost-reduction på bulk-workflows. Plus `cost-calculator.ts` der oversætter direct-provider token-counts til USD så F156 credits-debit-logic kører identisk. Sanne's 25-års onboarding går fra 750 credits → 120 credits på Flash. Phase 1/2, Medium 3-5d.
- **F180** ([resumable chunked uploads](./features/F180-resumable-chunked-uploads.md)) — fix root-cause for "upload disappears on browser-reload": dagens `await c.req.formData()` buffer'er hele body'en før noget persisteres, så client-disconnect mid-stream taber filen. F180 introducerer init/chunk/finalize-protokol med server-side staging i ny `upload_sessions`-tabel + temp-fil pr. uploadId. Reload læser localStorage, GET /uploads/:id og resumer fra `received_bytes`. Pre-flight `content_hash` dedup sparer bytes for duplikater. Phase 1 (server) ~1d, Phase 2 (frontend client + resume-prompt) ~½d, Phase 3 (polish) ~½d.
- Run `/feature "<idea>"` to add a new feature — duplicate-checks, numbering, plan scaffold, index updates, commit.
