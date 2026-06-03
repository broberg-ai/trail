---
name: local-ingest
description: Drain awaiting-local-compile sources for a Trail tenant and compile them into Neurons IN THIS interactive cc session ($0 Max-plan) via the cloud trail MCP. The Local Ingest Station (F191) parks sources here; buddy can also dispatch a drain job (the upmetrics-remediation pattern).
argument-hint: "<kb-slug-or-id> | status"
---

# /local-ingest $ARGUMENTS

The **$0 ingest engine** for F191. The cloud engine compiles via paid OpenRouter;
this skill compiles **for free** by doing the work itself — in an interactive
Claude Code session on the Max subscription — and writing the Neurons straight
into the cloud KB via the trail MCP.

## THE INVARIANT (read this first)

The whole point is $0. That only holds because an **interactive cc session runs
on the Max subscription** — no `ANTHROPIC_API_KEY`, no `claude -p` subprocess.

- **YOU compile.** Read the source, reason about it, write Neurons via
  `mcp__trail__write`. That is your own turn-work = $0.
- **NEVER** shell out to `claude -p` (Anthropic API-bills headless `claude -p` →
  not $0). **NEVER** call an Anthropic/OpenRouter API key. **NEVER** call the
  cloud `/reingest` endpoint (that triggers the paid cloud compile).

If you can't compile without one of those, STOP and report — don't silently
incur cost.

## Config (how this session reaches the cloud tenant)

- **Cloud API base** — `$TRAIL_CLOUD_API` (e.g. `https://app.trailmem.com`). Used
  for the REST calls below (auth: `Authorization: Bearer $TRAIL_API_KEY`, a
  personal `trail_` key minted in the cloud admin / handed over by the Station).
- **Cloud trail MCP** — the `mcp__trail__*` tools (guide/search/read/write) must
  be configured to point at the SAME cloud tenant (the Station / `.mcp.json`
  sets this up). Confirm with `mcp__trail__guide` before compiling: it should
  list the cloud tenant's KBs.

If either is missing, report it and stop — you cannot write to the cloud KB
without the MCP, and cannot list pending sources without the key.

## Step 1 — `status`

List what's waiting without compiling:

```bash
curl -s -H "Authorization: Bearer $TRAIL_API_KEY" \
  "$TRAIL_CLOUD_API/api/v1/knowledge-bases/<kb>/documents?awaitingLocalCompile=true"
```

Print the count + filenames. Stop.

## Step 2 — drain (`/local-ingest <kb-slug-or-id>`)

1. **Confirm MCP context.** `mcp__trail__guide` → verify the cloud tenant + the
   target KB are present.

2. **List pending.** Same curl as Step 1 → the array of parked sources
   (`status:"ready", awaitingLocalCompile:true`).

3. **For each source `S`:**
   a. **Fetch the exact compile prompt** (single-source with cloud ingest):
      ```bash
      curl -s -H "Authorization: Bearer $TRAIL_API_KEY" \
        "$TRAIL_CLOUD_API/api/v1/knowledge-bases/<kb>/documents/$S_ID/compile-prompt"
      ```
      → `{ prompt, sourcePath }`. The `prompt` is the EXACT 9-step compile prompt
      cloud ingest would run.
   b. **Execute it yourself** via the trail MCP — follow the prompt verbatim:
      `mcp__trail__read` the source at `sourcePath`, `mcp__trail__search` the
      wiki to survey, then `mcp__trail__write` (create / str_replace / append)
      the source-summary, concept pages, entity pages, glossary, overview, and
      log — exactly as the prompt's 9 steps direct. This reasoning + these
      tool-calls ARE the compile. No subprocess, no API key.
   c. **Clear the flag** when the source's Neurons are written:
      ```bash
      curl -s -X POST -H "Authorization: Bearer $TRAIL_API_KEY" \
        "$TRAIL_CLOUD_API/api/v1/documents/$S_ID/local-compiled" -d '{}'
      ```
      (Pass `{"failed":true}` instead if the source yielded nothing usable — it
      parks as failed rather than looping forever.)
   d. The engine stamps a **free-run** to upmetrics on your MCP writes (F191.5,
      connector `mcp:claude-code`, cost 0) — nothing for you to do.

4. **Report**: `✓ local-ingest <kb>: compiled N source(s) → M Neurons, $0 (Max-plan).`

## How a drain gets started

- **Manual**: you run `/local-ingest <kb>` in an open session.
- **buddy-dispatched** (the F191.2 pattern): the Station asks buddy to
  instantiate an ingest job in a cc session — exactly how upmetrics relays a
  remediation job (`mcp__buddy__launch_agent` / an intercom task). When you
  receive such a task, run this skill's Step 2 for the named KB.

## Guardrails

- Idempotent: re-running over an already-cleared source is a no-op (it's no
  longer in the `awaitingLocalCompile=true` list).
- One source at a time; don't parallelise writes to the same KB (the wiki
  pages — overview/log/glossary — are shared and would race).
- If `mcp__trail__guide` shows a DIFFERENT tenant than the KB you were asked to
  drain, STOP — you'd write into the wrong tenant. Re-point the MCP first.
