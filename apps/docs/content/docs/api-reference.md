---
title: API reference
slug: api-reference
summary: Interactive OpenAPI 3.1 reference for Trail's external HTTP surface. Spec is hand-written from packages/shared/openapi.yaml and rendered with Redoc; download the raw YAML at /openapi-trail.yaml.
order: 40
audience: ai-agent
category: API
fullWidth: true
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
  /* Page is rendered with fullWidth: true so .content-full spans
     browser width. Redoc just needs to be display:block and have
     a sensible min-height before its internal layout kicks in. */
  redoc {
    display: block;
    margin: 1rem 0 2rem;
    min-height: 85vh;
  }
  redoc:empty { opacity: 0; transition: opacity 0.3s; }
  redoc:not(:empty) { opacity: 1; }
</style>

<div class="redoc-mount">
<redoc spec-url="/openapi-trail.yaml" hide-loading></redoc>
<script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</div>
