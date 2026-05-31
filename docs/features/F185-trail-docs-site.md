# F185 — `docs.trailmem.com` (AI-friendly technical reference)

**Status:** Phase 1 in progress · **Phase:** 1 · **Owner:** cb · **Created:** 2026-05-08
**Pattern mirrors:** `cms-docs` (the repo that powers `docs.webhouse.app`)

A public, EN-only, predictable URL surface where planning AIs (Claude
Desktop, Cursor planning, agentic codegen) and human integrators can
read trail's API + MCP + concept reference without reaching for
GitHub MCP or scanning the source tree.

## Motivation

Two repeated pain points hit Christian whenever he plans an external
app that should integrate with trail:

1. **GitHub MCP is unreliable for planning AIs.** Even on this public
   repo, browsing 30+ route files to derive an API surface is slow and
   error-prone. Claude Desktop in particular often gives up on
   GitHub-hosted private repos entirely; even on public repos, the
   resulting integration code is a guess at endpoint shapes rather
   than a read-off of a spec.
2. **Planning AIs default to RAG.** Asked "how should I add a memory
   layer to my app?", the typical first answer is "set up embeddings,
   chunk your data, store in a vector DB, retrieve top-K". Trail's
   whole model — compile-at-ingest, candidates queue, FTS5 + LIKE on
   user-notes, NOT chunked-embedding-retrieve — is invisible until
   somebody opens the source. The default suggestion is the exact
   anti-pattern trail exists to replace.

A predictable public docs surface fixes both:

- Planning AIs `WebFetch` `docs.trailmem.com/llms.txt`,
  `docs.trailmem.com/openapi-trail.yaml`,
  `docs.trailmem.com/why-not-rag` with zero auth, zero MCP fragility.
- Anti-RAG framing baked into a dedicated page that planning AIs
  land on first.
- Hand-written reference for the endpoints external apps actually
  need, with `curl` + TypeScript samples.

The trail GitHub repo is currently public (verified 2026-05-08), so
in theory `gh` / GitHub MCP could read it. In practice, a stable
docs URL beats "let the AI walk a route directory" on every dimension
that matters for a planning session.

## Architectural decision (resolved 2026-05-08)

cms-core verified that `docs.webhouse.app` is **NOT** managed via
`webhouse.app/admin`, despite Christian's initial recollection. It is
a standalone Next.js Fly app (`cms-docs.fly.dev`) with content baked
into the `cms-docs` repo's `/content/` dir. Editors commit to that
repo; GitHub Actions builds + deploys.

Christian decided 2026-05-08 that `docs.trailmem.com` follows the
same pattern (option A): standalone Fly app, content in
`apps/docs/content/`, GHA-deployed.

Reasoning: technical API reference docs version with the API itself.
The `CLAUDE.md` "all content via webhouse.app/admin" rule was written
specifically about `trail-landing`'s blog posts (editor-content,
multi-author, drift-prone). Docs are developer-content that should
travel with the code that generates them.

This precedent applies to all future docs-sites until F147 (webapp
blueprint contract) lands and formalises a unified model.

## Goals

1. Public Next.js site at `docs.trailmem.com`, deployed to Fly app
   `trail-docs` in org `broberg-ai`, region `arn`.
2. EN-only (`defaultLocale: "en"`, `locales: []`). No DA mirror.
3. Content in `apps/docs/content/` as `@webhouse/cms` collections —
   three flat collections (`docs`, `changelog`, `snippets`), with a
   `category` field on each `doc` for sidebar grouping.
4. Hand-written OpenAPI 3.1 spec at `packages/shared/openapi.yaml`
   (external-facing routes only). Read paths:
   - Engine `/api/v1/openapi.json` (parsed at boot via `js-yaml`)
   - Docs prebuild copies it to `apps/docs/public/openapi-trail.yaml`
   - `docs.trailmem.com/api-reference` embeds Redoc CDN bundle
5. `llms.txt` index page generated at request-time from the `docs`
   collection, listing every URL + one-line summary.
6. Anti-RAG explainer page at `/why-not-rag` that plainly says:
   *"Don't roll your own embeddings — `POST` candidates to the
   queue."*
7. GHA workflow `.github/workflows/docs-deploy.yml` triggers on push
   to `main` when `apps/docs/{content,public,src,Dockerfile,fly.toml,
   package.json,next.config.ts}` changes.

## Non-goals

- **NOT a marketing site.** That is `trailmem.com` / `apps/landing`.
  `docs.trailmem.com` is purely technical reference.
- **NOT an interactive Swagger UI tutorial.** Redoc is one page
  inside the docs site, not the whole site.
- **NOT auto-generated from route handlers in Phase 1.**
  Hand-written YAML is faster to ship, reads better, and survives
  refactors. A contract test that diffs live routes against the
  spec lands in Phase 5.
- **NOT multilingual.** EN-only forever — technical-API consumers
  are English-speaking by default. (Trail's *user-facing* surfaces
  remain DA-default; this rule applies to `docs.trailmem.com` only.)
- **NOT cms-admin-managed.** See architectural decision above.
  Content lives in the repo, not in `webhouse.app/admin`.
- **NOT a replacement for `docs/features/F*.md` plan-docs.** Plan-docs
  capture internal feature reasoning; `docs.trailmem.com` is external
  API reference for integrators.

## Architecture

### Stack

- **Custom build.ts (`tsx`) + `marked` + `shiki`**, mirroring
  `apps/landing`'s proven pattern. Static HTML output → nginx
  Docker container → Fly. No Next.js runtime.
- Justification: the SSR features cms-docs needs (server-side i18n,
  dynamic OG images, dynamic `/api-reference`) all happen to be
  client-side or build-time on `docs.trailmem.com`:
  - Redoc loads its YAML client-side from a static `public/` asset
  - `llms.txt` is generated at build time from the same content tree
    that the sidebar reads
  - EN-only means no i18n routing
- **Markdown source** with YAML frontmatter (developer ergonomics —
  better than editing JSON-wrapped markdown for hand-authored
  technical reference). Content tree under `apps/docs/content/`
  organised by category prefix in the filename (`concepts-neurons.md`,
  `api-queue.md`) — a `category` field in frontmatter still drives
  sidebar grouping, kept compatible with the cms-collection shape
  if we ever migrate to admin-managed.
- **Shiki** for syntax highlight in code blocks (matches cms-docs).
- **Redoc CDN bundle** for `/api-reference` viewer (matches
  cms-docs's choice over Scalar / Swagger UI).
- **Hand-rolled CSS** (Trail brand: warm off-white, charcoal, amber
  accent — same palette as `apps/landing/public/`). Tailwind not
  needed for ~30 docs pages.

If we later need true SSR (e.g. dynamic `/api-reference` pulling
the live spec from an engine instead of a baked YAML), Phase 5 can
flip the stack to Next.js without breaking the content tree —
markdown + frontmatter loads identically into Next.js's MDX or
contentlayer.

### Directory layout

```
apps/docs/
  package.json
  tsconfig.json
  build.ts                 # static-site generator (mirrors apps/landing/build.ts)
  Dockerfile               # nginx-alpine static (same as apps/landing)
  nginx.conf
  fly.toml                 # app="trail-docs", org="broberg-ai", region="arn"
  templates/
    page.html              # base template (header, sidebar, content slot)
  content/
    docs/
      intro.md             # frontmatter: title, slug, category, order, summary
      why-not-rag.md
      quick-start.md
      concepts-neurons.md  # Phase 2 — category: "concepts"
      api-queue.md         # Phase 3 — category: "api"
      ...
    changelog/
    snippets/
  public/
    openapi-trail.yaml     # Phase 3, build-time copy from packages/shared
    favicon.svg
    styles.css             # Trail brand palette
```

### OpenAPI source-of-truth (Phase 3)

`packages/shared/openapi.yaml` — hand-written, version-controlled,
3.1 spec.

Phase 1 spec covers external-facing routes only:

| Method + Path | Purpose |
|---|---|
| `POST /api/v1/queue/candidates` | Bearer-token external ingest |
| `GET /api/v1/neurons/{kbId}` | List Neurons in a KB |
| `GET /api/v1/neurons/{kbId}/{seqId}` | Read one Neuron |
| `GET /api/v1/search` | FTS5 + share-gated user-notes |
| `POST /api/v1/chat` | Synthesize + cite |
| `GET /api/v1/openapi.json` | Self-reference |

Internal routes (admin, jobs, beam, ingest-settings, ingest, lint,
chat-sessions, etc.) are explicitly excluded — denoted by an
allow-list comment in the spec source.

Phase 5 contract test scans `apps/server/src/routes/*.ts`, lists every
`app.{get,post,put,delete}(...)` route, and asserts each
external-allow-listed one appears in the spec. Internal routes pass
the test silently because they are not on the allow-list.

## Phases

### Phase 1 — ship today (3-4 hours)

Scaffold + 4 pages + DNS, no OpenAPI yet. Goal: live site at
`docs.trailmem.com` with anti-RAG framing reachable by planning AIs.

- `apps/docs/` Next.js app skeleton
- `cms.config.ts` with one `docs` collection (no `category` field
  yet — flat sidebar in Phase 1)
- `content/docs/intro.json`, `why-not-rag.json`, `quick-start.json`,
  `index.json`
- Sidebar component (flat list, alphabetical by `order` field)
- Dockerfile (Next.js standalone output) + `fly.toml`
- `flyctl apps create trail-docs --org broberg-ai`
- `flyctl deploy --remote-only`
- Cloudflare DNS via DNS Manager MCP: `docs.trailmem.com` CNAME to
  Fly's anycast (or `trail-docs.fly.dev` — TBD by `flyctl certs
  show` output)
- `flyctl certs create docs.trailmem.com`
- `.github/workflows/docs-deploy.yml`

Phase 1 site renders four pages:

- `/` — Trail in 60 seconds, links to the four canonical entry-points
- `/intro` — What Trail is, what it isn't (vs. RAG, vs. NotebookLM)
- `/why-not-rag` — Anti-pattern explainer aimed at planning AIs
- `/quick-start` — Five-step external-app integration walk-through
  (get token → POST candidate → see Neuron → approve → query)

### Phase 2 — concepts (1 day)

Add `category` field to `docs` collection. Sidebar groups by category.

- `concepts/neurons` — Compiled atoms, seqIDs, version history
- `concepts/queue` — Candidates → review → Neurons; auto-approval
- `concepts/kb` — Knowledge bases, slugs, tenancy
- `concepts/connectors` — Attribution model (`mcp:claude-code`,
  `buddy`, `upload`, etc.)
- `concepts/search` — FTS5 + user-note LIKE; share gates

### Phase 3 — API reference + OpenAPI (1 day)

- `packages/shared/openapi.yaml` — hand-written 3.1 spec (5 endpoints)
- `apps/server/src/routes/openapi.ts` — engine serves
  `/api/v1/openapi.json`
- `apps/docs/scripts/sync-openapi.ts` — prebuild copy
- `apps/docs/src/app/api-reference/page.tsx` — Redoc embed
- One markdown reference page per endpoint with `curl` + TypeScript
  samples

### Phase 4 — MCP integration (½ day)

- `mcp/overview` — What Trail's MCP server exposes (`read`, `write`,
  `search`, `guide`, `recent`, etc.)
- `mcp/claude-code` — `.mcp.json` block + `TRAIL_CONNECTOR=mcp:claude-code`
- `mcp/claude-desktop` — Desktop config + auth flow
- `mcp/cursor` — Cursor config

### Phase 5 — polish + contract tests (½ day)

- `/llms.txt` route — dynamic generation from `findMany("docs")`
- `?format=md` query param on every page (returns raw markdown source)
- Contract test: live-route ↔ spec diff (CI-blocking on drift)
- Pagefind static search index (~200KB build-time, no runtime infra)

## Dependencies

Phase 1:
- `tsx` (build-time TypeScript runner — already in `apps/landing`)
- `marked` ^15 (already in `apps/landing`)
- `shiki` ^3 (new — code-block highlighter)
- `gray-matter` ^4 (new — YAML frontmatter parser)
- `zod` (already in `apps/landing` — content-shape validation)

Phase 3:
- `js-yaml` (engine reads OpenAPI YAML at boot)
- Redoc CDN bundle — client-side, no npm install

## Rollout

Phase 1 lands today (2026-05-08) — site goes live as soon as DNS
propagates. The four pages alone close the largest gap (anti-RAG
framing + quick-start exist in a public predictable URL).

Phases 2–5 land per session, no urgency. Phase 3 is the next
high-value step (lets a planning AI consume the OpenAPI directly
instead of inferring shapes from prose).

## Open questions

- **Versioning.** Trail API is `/api/v1/...`. If a v2 ships, do we
  route `docs.trailmem.com/v1/...` and `/v2/...`? Defer until v2
  exists — this is not a Phase 1–5 concern.
- **Search UX.** Pagefind is solid for static-site search. Confirm
  Phase 5 when content volume exceeds ~30 pages; below that the
  sidebar is enough.
- **`llms.txt` format spec.** There are competing conventions
  (`llms.txt` vs. `llms-full.txt` vs. plain index). Phase 5 picks
  one based on what Anthropic + Cursor actually consume by then.
- **Custom domain certs vs. Fly anycast.** First Phase 1 deploy
  determines whether we point CNAME at `trail-docs.fly.dev` or use
  Fly's anycast IPs directly. Either works; the choice mirrors
  whatever `apps/landing` currently does.