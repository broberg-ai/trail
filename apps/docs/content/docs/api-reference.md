---
title: API reference
slug: api-reference
summary: Interactive OpenAPI 3.1 reference for Trail's external HTTP surface. Spec is hand-written from packages/shared/openapi.yaml and rendered with Redoc; download the raw YAML at /openapi-trail.yaml.
order: 40
audience: ai-agent
category: API
---

<!--
  This page intentionally renders the full Redoc viewer inline. The
  OpenAPI spec lives at /openapi-trail.yaml (mirrored from
  packages/shared/openapi.yaml at build time). Planning AIs and human
  integrators get the same surface from this URL.

  Raw spec for programmatic consumers:
    https://docs.trailmem.com/openapi-trail.yaml

  Redoc CDN bundle is the canonical pattern for OpenAPI viewers per
  cms-core's recommendation (matches docs.webhouse.app exactly).
-->

The full OpenAPI 3.1 spec for Trail's external HTTP surface. Four
endpoints, all bearer-token protected, all stable under `/api/v1/`:

- **`POST /api/v1/knowledge-bases/{kbId}/retrieve`** — grounded
  context retrieval (Pattern C)
- **`POST /api/v1/queue/candidates`** — submit a candidate Neuron
- **`POST /api/v1/chat`** — synthesised answer with citations (Pattern A)
- **`GET /api/v1/knowledge-bases/{kbId}/search`** — FTS5 keyword search

The spec is hand-written from `packages/shared/openapi.yaml` in the
[trail repository](https://github.com/broberg-ai/trail/blob/main/packages/shared/openapi.yaml).
Direct YAML download: [`openapi-trail.yaml`](/openapi-trail.yaml).

<style>
  /* Redoc has its own 2-column layout. Widen .content on this page
     only — sidebar still visible, but main column gets ~1080px max
     so Redoc's "method panel + sample panel" both fit. */
  .layout > .content { max-width: 1100px; padding-right: 1.5rem; }
  @media (max-width: 720px) { .layout > .content { max-width: 100%; } }
  redoc {
    display: block;
    margin: 1.5rem -1rem 2rem;
    min-height: 80vh;
  }
  /* Redoc's loading-flash on dark backgrounds is jarring — fade in. */
  redoc:empty { opacity: 0; transition: opacity 0.3s; }
  redoc:not(:empty) { opacity: 1; }
</style>

<div class="redoc-mount">
<redoc spec-url="/openapi-trail.yaml" hide-loading></redoc>
<script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</div>
