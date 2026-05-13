---
title: Knowledge bases
slug: concepts-kb
summary: Each KB is one trail.db on the engine — isolated content, settings, persona, language, ingest model. Bearer tokens scope to a tenant + KB.
order: 12
audience: both
category: Concepts
---

A **Knowledge base** (KB) is the unit of isolation in Trail. One KB
is one `trail.db` SQLite file on the engine machine — its own
Neurons, its own queue, its own settings, its own persona, its own
auto-approval policy. Cross-KB queries are a deliberate exception
(via wiki-link `[[kb:other/page]]` syntax); the default is that one
KB sees only itself.

## Tenancy

The hierarchy:

```
Organization (your account)
  └─ Tenant (a billable unit, usually = customer)
      └─ Knowledge base
          └─ Neurons
```

A tenant can have multiple KBs (e.g. "customer-facing knowledge" and
"internal playbook"). A bearer token is **scoped to a tenant + KB**
— issuing a key for one KB does not grant access to others under the
same tenant.

In the deployed Fly fleet:

- Each tenant lives on exactly one engine (`trail-engine-001`,
  `trail-engine-002`, ...).
- The router (`engine.trailmem.com`, F170 — Phase 2 once fleet ≥ 2)
  resolves bearer-token → tenant → engine.
- Each tenant's `trail.db` lives on that engine's persistent volume.

## Slugs

Every KB has a stable slug — kebab-case, unique per tenant — and a
canonical UUID. Most API surfaces accept both interchangeably (F135).
The slug shows up in URLs and bearer-token scopes; the UUID is
internal but exposed in JSON responses where needed:

```
/kb/my-product-docs/queue     ← admin URL
my-product-docs               ← slug, accepted in API calls
01H5...                       ← canonical UUID, also accepted
```

Slug resolution is consistent across all v1 endpoints — if the slug
exists, it resolves; if not, a 404 returns. No special slug-only or
UUID-only routes.

## KB-level settings

Each KB has its own per-KB settings, configured in the admin UI under
**Settings → Trail**:

### Language

Two-letter ISO code (`da`, `en`, `de`, `sv`, `no`, ...) that drives:

- The chat system prompt's "answer in this language" directive (F160).
- The link-checker's `foldBilingual` heuristic (F148) — knows `og` ≈
  `and`, `i` ≈ `of` for DA↔EN drift.
- The ingest pipeline's compile-prompt language hint.
- The admin's reader-pane prose translation toggle.

### Persona

Optional per-KB system-prompt override for tool + public audiences
(F160). Curator persona is global to keep admin tone consistent; the
tool + public personas can be specialised per KB so a customer-facing
chat sounds different from a professional-tool chat. Pattern C
deployments don't usually need this (the site sets its own system
prompt) — Pattern A deployments lean on it heavily.

### Ingest backend + model + fallback chain

- `ingest_backend`: `claude-cli` (default, free under Max plan) or
  `openrouter`.
- `ingest_model`: e.g. `gemini-2.5-flash`, `claude-sonnet-4-6`,
  `glm-4.6`.
- `ingest_fallback_chain`: ordered list — on model failure, the
  runner skips to the next entry mid-job, keeping already-written
  Neurons (F149).

The admin's [F152 model-switcher](https://github.com/broberg-ai/trail/blob/main/docs/features/F152-runtime-model-switcher-ui.md)
flips these live without redeploy. F151 cost-dashboard tells you
which models are paying their way per KB.

### Auto-approval policy

Per-KB confidence threshold + action-zone rules that decide which
candidates skip curator review. See
[Concepts: Queue](/concepts-queue/).

### Lint schedule

Per-KB cadence (1–90 days, weekly default — F176) for the
orphan/stale/contradiction lint pass. KB with rapid-changing
knowledge: shorter cadence. Stable archival KB: monthly.

### Backup retention

Continuous backups to Cloudflare R2 (F153). 30-day retention by
default; curator can pull a `.vacuum.tar.gz` snapshot via the admin's
backup health card.

## What a KB is _not_

A KB is **not**:

- **A schema-controlled database.** Neurons are markdown; the shape
  varies per Neuron. The F140 schema vocabulary system layers
  optional structure on top (per-KB entity types, attribute schemas),
  but the underlying store stays flexible.
- **A multi-tenant store.** One KB = one tenant. Cross-tenant
  isolation is enforced at the data layer (`WHERE tenant_id = ?` on
  every query), not just at the API.
- **A document-storage bucket.** Uploaded source files live in
  storage (Fly volume or Tigris S3 per F173); the KB holds the
  compiled Neurons + provenance references back to the sources.
- **Multilingual.** A KB has one canonical language. Multilingual
  *sites* drive their two-language navigation by reading from
  separate KB-slugs (or by routing user-language to the appropriate
  KB).

## How to think about KB granularity

Question to ask: "Do these two areas of knowledge need to be
queryable together?"

- **Yes** → one KB. The wiki-link + retrieve + chat surfaces work
  best within a single KB.
- **No** → two KBs. Two bearer tokens, two settings panes, two
  ingest pipelines, no accidental cross-pollination.

The deployed reflexology practice runs one KB (clinical knowledge for
the public-facing chat). A multi-discipline coaching practice might
run three (one per modality). A research group might run one per
paper-set.

## Where to go next

- [Concepts: Neurons](/concepts-neurons/) — what lives in a KB
- [Concepts: Queue](/concepts-queue/) — how things enter the KB
- [Concepts: Connectors](/concepts-connectors/) — what produces the
  candidates
- [API reference](/api-reference/) — KB-scoped endpoints
