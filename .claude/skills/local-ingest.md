---
name: local-ingest
description: Drain awaiting-local-compile sources for a Trail tenant and compile them into Neurons IN THIS interactive cc session ($0 Max-plan), writing to the cloud KB over the plain cloud REST API (no MCP). The Local Ingest Station (F191) parks sources; buddy can also dispatch a drain job (the upmetrics-remediation pattern).
argument-hint: "<tenant-slug> <kb-slug-or-id> | status"
---

# /local-ingest $ARGUMENTS

The **$0 ingest engine** for F191. The cloud engine compiles via paid OpenRouter;
this skill compiles **for free** by doing the work itself — in an interactive
Claude Code session on the Max subscription — and writing the Neurons straight
into the cloud KB over the **cloud REST API**. No MCP: the session is already
authed to the closed-network cloud peer (its `trail_` key), so direct API is
the right path (and the trail MCP is local-stdio-only — it can't reach cloud).

## THE INVARIANT (read this first)

$0 only holds because **YOU** (an interactive cc session on Max) do the compile:
read the source, reason about it, decide the Neurons. The REST calls below are
just data I/O — they are NOT LLM calls. So:

- **YOU compile** — your own turn-reasoning. That is $0.
- **NEVER** shell out to `claude -p` (Anthropic API-bills it → not $0).
- **NEVER** call an Anthropic/OpenRouter API key, and **never** hit the cloud
  `/reingest` endpoint (that fires the paid cloud compile).

If you can't compile without one of those, STOP and report.

## Config — Step 0: load credentials

Credentials live in the gitignored `.env.local-ingest` at the repo root (so they
persist across sessions without `~/.bashrc`). **Source it first**, every drain:

```bash
set -a; source "$REPO/.env.local-ingest"; set +a   # $REPO = repo root, e.g. /Users/cb/Apps/broberg/trail
```

It defines:
- `TRAIL_CLOUD_API` — cloud base (e.g. `https://app.trailmem.com`).
- `TRAIL_API_KEY` — a personal `trail_` key. cb's key is **scope=`all`**
  (F191.6): it spans every tenant he's a member of (`broberg-ai` +
  `sanne-andersen`). The admin-proxy picks ONE tenant per request from the
  **`X-Trail-Tenant` header** (verified against the key user's memberships).

**Pick the tenant for this drain** — the FIRST argument is the tenant slug:

```bash
TENANT="${1:-broberg-ai}"   # e.g. sanne-andersen | broberg-ai
```

**Every** call below MUST send both headers, else a scope=`all` key silently
falls back to its home tenant (broberg-ai) and you'd drain the wrong KB:

```
-H "Authorization: Bearer $TRAIL_API_KEY" -H "X-Trail-Tenant: $TENANT"
```

If `.env.local-ingest` is missing, mint a key in the cloud admin
(Settings → API-nøgler) and write the two lines into it. A bogus/unauthorised
tenant slug → 401 (the header is a selector over your memberships, not a grant).

## Step 1 — `status`

```bash
curl -s -H "Authorization: Bearer $TRAIL_API_KEY" -H "X-Trail-Tenant: $TENANT" \
  "$TRAIL_CLOUD_API/api/v1/knowledge-bases/<kb>/documents?awaitingLocalCompile=true"
```
Print the count + filenames. Stop.

## Step 2 — drain (`/local-ingest <tenant-slug> <kb-slug-or-id>`)

1. **List pending** (same curl as Step 1) → the parked sources.

2. **For each source `S` (id `$SID`):**
   a. **Fetch the exact compile prompt** (single-source with cloud ingest):
      ```bash
      curl -s -H "Authorization: Bearer $TRAIL_API_KEY" -H "X-Trail-Tenant: $TENANT" \
        "$TRAIL_CLOUD_API/api/v1/knowledge-bases/<kb>/documents/$SID/compile-prompt"
      ```
      → `{ prompt, sourcePath }`. The `prompt` is the EXACT 9-step compile prompt
      cloud ingest would run. **Follow it verbatim** — but map its tool-calls to
      these REST endpoints (do the reasoning yourself between calls):
      - the prompt's `read path=…` → `GET .../documents/$SID/content` (the source);
        for wiki pages, `GET .../knowledge-bases/<kb>/documents` (list) then read by id.
      - the prompt's `search` → `GET .../knowledge-bases/<kb>/search?q=<terms>`.
      - the prompt's `write command=create|str_replace|append …` →
        ```bash
        curl -s -X POST -H "Authorization: Bearer $TRAIL_API_KEY" -H "X-Trail-Tenant: $TENANT" \
          -H "Content-Type: application/json" \
          "$TRAIL_CLOUD_API/api/v1/knowledge-bases/<kb>/wiki-write" \
          -d '{"command":"create","path":"/neurons/sources/","title":"…","content":"…","tags":"…"}'
        ```
        (For str_replace/append pass `title` = full doc path + `old_text`/`new_text`
        or `content`, exactly as the prompt directs. This wraps the SAME
        `CandidateQueueAPI.write` the cloud compile uses → identical Neuron shape,
        same auto-approval policy, connector `mcp:claude-code`.)
   b. **Clear the flag** when the source's Neurons are written:
      ```bash
      curl -s -X POST -H "Authorization: Bearer $TRAIL_API_KEY" -H "X-Trail-Tenant: $TENANT" \
        "$TRAIL_CLOUD_API/api/v1/documents/$SID/local-compiled" -d '{}'
      ```
      (Pass `-d '{"failed":true}'` if the source yielded nothing usable.)
   c. The engine stamps a **free-run** to upmetrics on `/local-compiled` (F191.5,
      cost 0, connector mcp:claude-code) — nothing for you to do.

3. **Report**: `✓ local-ingest <kb>: compiled N source(s) → M Neurons, $0 (Max-plan).`

## How a drain gets started

- **Manual**: run `/local-ingest <tenant-slug> <kb>` in an open session
  (e.g. `/local-ingest sanne-andersen <kb>` to land Sanne's source material).
- **buddy-dispatched** (F191.2 pattern): the Station asks buddy to instantiate an
  ingest job in a cc session — exactly how upmetrics relays a remediation job
  (`mcp__buddy__launch_agent` / an intercom task). On receiving such a task, run
  Step 2 for the named KB.

## Guardrails

- Idempotent: a cleared source drops out of the `awaitingLocalCompile=true` list.
- One source at a time; don't parallelise writes to the same KB (overview/log/
  glossary are shared pages and would race).
- If a write returns `{ok:false}`, read the error, fix the args, retry — don't
  clear the flag until the source's Neurons are actually written.
