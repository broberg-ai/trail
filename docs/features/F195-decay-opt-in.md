# F195 — Memory-decay is per-tenant opt-in (default OFF)

**Status:** shipping
**Date:** 2026-06-07
**Area:** server (confidence-decay, tenant-settings, memory-health route) + admin SPA
**Depends on:** F182.2/.3/.7 (confidence formula, decay job, per-tenant settings)

## Motivation

Christian (product owner), evaluating the Memory Health page on a freshly-loaded
KB: *"hvis jeg IKKE forstår det er der INGEN kunder der gør"* — and, more
sharply: **age alone does not make a fact stale.** A true, uncontradicted fact
that nothing newer/better has replaced should NOT fade just because time passed.
Staleness should come from **supersession / contradiction** (newer, better facts
replacing it), not from the Ebbinghaus `recency = exp(−age/τ)` term firing every
night.

The F182.3 decay job runs globally every 24h and recomputes confidence including
that age term. On a brand-new KB with no real chat-usage yet, this drives *almost
everything* toward "Decaying" — not because it's wrong, but because nothing has
been cited/read/linked yet to reinforce it. The page then screams "everything is
fading on day 1", which is both confusing and incorrect.

Christian's directive: **(1) reset all Neurons now, and (2) add a setting we can
switch ON once the consuming site is in full operation** — so unused-but-true
knowledge doesn't go stale too quickly.

## Scope

**In:**
- Per-tenant flag `memoryDecayEnabled` in `tenants.settings_json`, **default
  `false`** (`loadMemoryDecayEnabled` / `saveMemoryDecayEnabled`).
- Gate in `runDecayPass`: while the flag is OFF, every Neuron is held at full
  confidence (`1.0`) — same path as a pinned Neuron. This both **resets** (the
  first pass writes 1.0) and **holds** (later passes are EPSILON no-ops). When
  ON, the F182.2 formula applies as before.
- `GET /memory-health/decay-rates` also returns `decayEnabled`.
- `PUT /memory-health/decay-enabled { enabled }` — persists the flag; disabling
  runs an immediate reset pass (`runDecayPass` with the flag off → all 1.0), so
  the reset is instant, not "on the next nightly pass".
- Admin Memory Health UI: a toggle + a banner ("Forfald er sat på pause — slå
  til når sitet er i fuld drift"), and a generic, customer-agnostic intro box
  with the corrected model (outdated = replaced by better facts, not age).

**Non-goals:**
- Redesigning the confidence formula to drop the age term entirely (the toggle
  makes it moot for now; τ-tuning per type is already available via the sliders
  when a tenant enables decay).
- Per-KB granularity (the flag is per-tenant, matching the decay job + the
  existing decayRates setting).
- Touching supersession/contradiction — those remain independent and always on.

## Architecture

`memoryDecayEnabled` lives alongside `decayRates` in `tenants.settings_json`.
The single source of truth for "does this tenant's knowledge age?" is this flag,
read once per decay pass. OFF (default) means the nightly job is a reset-to-1.0
no-op; the page shows everything healthy. Supersession ("Erstattede") and
pinning still work regardless.

Reset mechanics (no separate migration/script): disabling via the API runs
`runDecayPass` immediately, which — with the flag off — writes 1.0 to every
non-1.0 Neuron. Default-off tenants are reset by the job's first post-deploy pass
too; the API path makes it instant.

## Rollout
1. Engine code + plan-doc (this commit), `tsc` green → deploy engine.
2. `PUT /memory-health/decay-enabled {enabled:false}` for each live tenant
   (broberg-ai + sanne-andersen) → immediate reset to 1.0 + flag persisted OFF.
3. Admin UI (toggle + banner + intro) → deploy admin.
4. Verify: GET memory-health shows no decaying Neurons; decayEnabled=false;
   flipping the toggle on/off round-trips.

## Verification
- After reset: `GET /knowledge-bases/:kb/memory-health` → decaying list empty
  (histogram concentrated in the top bucket).
- `decay-rates` GET returns `decayEnabled:false`; PUT true→false round-trips and
  the false write empties the decaying list.
