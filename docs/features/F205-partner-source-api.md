# F205 — Partner Source API

**Status:** backlog · asked for 2026-08-22

> "Du skal lave et API så vores eksterne partner applikationer kan uploade
> kilde dokumenter til sources."

## The uncomfortable part first

**The upload API already exists. What does not exist is a key we can safely
give to someone outside the house.**

Minting a partner key today would hand a third party an unrestricted tenant
key. The Developer page states it in the product's own words:

> *"Personal bearer tokens that call the Trail API **as you**, scoped to your
> active tenant."*

Measured, not assumed — `apps/server/src/routes/api-keys.ts:38`:

```ts
await trail.db.insert(apiKeys).values({ id, tenantId, userId, name, keyHash });
//                                       ^ no `scope` — falls back to the column default
```

and `apps/server/src/middleware/auth.ts:81`:

```ts
function scopeAllows(scope: string, method: string, path: string): boolean {
  if (scope !== 'ambient') return true;   // everything except ambient is unrestricted
  …
}
```

So **every key ever minted through the UI is a master key.** The `scope`
column exists and is enforced — but only the ambient device-auth path ever
sets it. That is the defect this epic closes, and it is worth stating plainly
because it means the risk is present *now*, not only once partners arrive.

## What already exists (do not rebuild)

| Piece | Where | State |
|---|---|---|
| Upload endpoint | `apps/server/src/routes/uploads.ts:86` | works — multipart `file` + `path` + `metadata{connector,sourceUrl,tags}`, 100 MB cap, extension allowlist, `requireAuth` |
| Chunked upload init | `uploads.ts:388` | exists |
| Key minting (API) | `apps/server/src/routes/api-keys.ts:38` | works, but never sets `scope` |
| Key minting (UI) | `apps/admin/src/panels/settings-account.tsx:472` (`settings#developer`) | works |
| Bearer auth + tenant resolve | `apps/server/src/middleware/auth.ts` | works |
| Per-key `scope` column | `packages/db/src/schema.ts` | exists, enforced only for `'ambient'` |
| Connector attribution | `packages/shared/src/connectors.ts` | exists — but the connector id is read from the **request body**, so a caller can claim to be anyone |

## Decisions (Christian, 2026-08-22)

1. **Partner uploads park for review.** The document lands as a Source and is
   compiled, but the resulting Neurons stay Pending. An external party never
   writes unattended into the knowledge base. Loosening this per partner is a
   later, deliberate choice — not a default.
2. **A partner key is bound to ONE knowledge base**, and may only upload and
   check the status of *its own* uploads. No search, no Neuron reads, no
   visibility of other partners' files. Smallest possible blast radius when
   — not if — a partner leaks a key.

## Reuse (F217 — checked before designing)

Searched Discovery for the capability rather than assuming we own it:

- **`@broberg/apikey` v0.3.1** (`discovery.broberg.ai/api/search?q=api+key+scope+partner+upload`)
  — shipped, owned by `components`, and it already carries exactly the
  primitive this epic needs: *"a Cloudflare-style authorization cascade
  (permission × resource-filter × CIDR × TTL)"* plus a Hono adapter. Trail is
  listed as a pilot consumer. `apps/admin-server` already depends on it at
  **0.1.0** (exports `.`, `./authorize`, `./next`, `./hono`); the engine
  (`apps/server`) does not depend on it at all.

**Decision: adopt `@broberg/apikey/authorize` for the partner scope**, upgraded
to 0.3.1, rather than hand-rolling a second regex allowlist beside
`scopeAllows`. "permission × resource-filter" is literally "upload-only × this
KB only" — re-rolling it here would be the drift the reuse rule exists to
prevent.

**But no naked cutover.** The existing session and `'ambient'` paths are a
load-bearing auth chain that works; they are NOT migrated in this epic. The
cascade is introduced for the new `partner` scope only. Migrating `'ambient'`
onto the same cascade is a follow-up, taken once the partner path has proven
itself live.

Enroll the adoption with Discovery (`POST /api/enroll`, `role: "uses"`) once
the engine actually depends on it.

## Architecture

```
partner app
   │  POST /api/v1/partner/sources        Authorization: Bearer trail_…
   │  multipart: file, path?, sourceUrl?, externalId?
   ▼
requireAuth ──► @broberg/apikey authorize cascade
   │              permission: 'source:upload'
   │              resource:   kbId bound ON THE KEY (never from the request)
   ▼
existing upload pipeline (uploads.ts) ──► Source row
   │              connector stamped FROM THE KEY, not from the body
   ▼
compile ──► candidates ──► Queue (Pending)   ← curator approves
```

Three things make this a partner API rather than an internal one:

1. **The KB comes from the key, not the URL.** A partner cannot address
   another knowledge base by changing a path segment, because there is no path
   segment to change.
2. **Attribution is derived, not claimed.** `metadata.connector` is currently
   caller-supplied; for partner uploads the connector id comes from the key
   record. A partner cannot post as `curator` or as another partner.
3. **The partner can see its own uploads and nothing else.** A status endpoint
   keyed by the partner's own `externalId` — so their app can answer "did that
   document land?" without being able to enumerate the knowledge base.

## Scope

**In:** the `partner` scope + restricted minting (F205.1); the partner upload
endpoint with key-derived attribution and park-for-review (F205.2); the
status endpoint (F205.3); admin UI to mint and revoke partner keys per KB
(F205.4).

**Non-goals:**

- Migrating the existing `'ambient'` scope or session auth onto the cascade.
- Per-partner auto-approval. Decision 1 says park for review; a per-partner
  override is a later feature, not a hidden flag added now.
- A partner-facing SDK. The contract is plain multipart HTTP; a partner who
  can `curl` can integrate.
- Billing/quota per partner. Rate-limiting comes free with `@broberg/apikey`
  and is used defensively; metering partners is a separate product question.

## Verification

This is an auth boundary, so "it returned 200" proves nothing about the half
that matters — what a partner key is *refused*. Every story's AC therefore
asserts the **negative** case with a real request, not only the happy path:
a partner key must get 403 on search, on another KB's upload, on key minting,
and on reading Neurons. A test that only proves the upload works would pass
equally well on the master key we are trying to stop issuing.

And per the repo's save-field rule, a successful upload is proven by reading
the Source back from a fresh request — not by the 201.

## Dependencies

- `@broberg/apikey` 0.3.1 in `apps/server`.
- Partner-facing documentation belongs on `docs.trailmem.com`, whose deploy is
  currently broken — see **F204**. Not blocking the code; blocking the moment
  we want a partner to read the contract.

## Breakdown

- **F205.1** — Restricted partner keys (`partner` scope, bound to one KB)
- **F205.2** — Partner upload endpoint: key-derived attribution, park for review
- **F205.3** — Upload status endpoint scoped to the partner's own uploads
- **F205.4** — Admin UI: mint + revoke a partner key for a knowledge base
