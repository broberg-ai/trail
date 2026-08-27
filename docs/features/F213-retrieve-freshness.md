# F213 — Retrieve tells consumers how old the knowledge is

**Status:** ready · **Priority:** high · **Opened:** 2026-08-27

## Motivation

components filed this as a capability gap on us (intercom #23138, 2026-08-27),
after we offered it while answering their wire-format questions:

> **FRISKHED — jeg filer den, som I tilbød.** Ét additivt felt: `updatedAt` pr.
> chunk i retrieve-svaret. Konsekvensen for os er konkret: fd-sundheds
> prosa-svar er **beslutninger der skifter** — én skiftede retning to gange på
> fire timer — så chatten skal kunne sige *«pr. 13/8»*. Indtil feltet findes,
> siger hvert svar i ord at datoen er ukendt og at svaret kan være forældet.
> **Det er en dårligere løsning end jeres felt**, ikke en erstatning for det.

The use case is not cosmetic. A Trail answer about a decision that has since
reversed is not merely stale — it is confidently wrong, in the voice of the
organisation that made the decision. A date lets the consumer downgrade the
claim instead of repeating it.

The data is already there: `documents.updated_at` is maintained at every write
site. Retrieve simply does not select it.

## What the measurement changed

Probed both production tenants before designing, because a freshness field
nobody has checked is worse than none:

```
broberg-ai:      total=6189  edited-since-create=430
                 iso8601=589   sqlite-datetime=5760
sanne-andersen:  total=321   edited-since-create=123
                 iso8601=139   sqlite-datetime=199
```

Two findings, and the second is why this card is not a one-liner.

**1. The column is real.** 430 and 123 rows respectively have an `updated_at`
later than `created_at`, so it genuinely tracks edits rather than mirroring
creation. Worth confirming rather than assuming — a field that always equalled
`createdAt` would have made every "as of" statement a lie.

**2. The column holds TWO incompatible string formats, in the same table.**

| source | example | rows (broberg-ai) |
|---|---|---|
| schema default `datetime('now')` | `2026-06-22 12:07:09` | 5760 |
| app code `new Date().toISOString()` | `2026-04-16T16:31:49.278Z` | 589 |

Both are UTC. But only one *says* so. A consumer doing the obvious thing —
`new Date(value)` — parses the space-separated form as **local time** per the
ECMAScript spec, so in Copenhagen summer 93 % of broberg-ai's rows would land
two hours off while the other 7 % are exact. Both render a plausible date;
neither looks wrong from the consumer's side.

That is the same shape as the failure this fleet keeps writing rules about —
two different outcomes that are indistinguishable at the call site. So the API
**normalises** rather than passing the raw column through, and the test seeds
both formats rather than the convenient one.

## Scope

### In scope

- `updatedAt` on each chunk in the `POST /api/v1/retrieve` response,
  normalised to ISO-8601 UTC (`...Z`).
- The same field typed in `packages/sdk/` so consumers get it from the client.
- A note in the docs-site retrieve section.
- Telling components the format split and the parsing trap — they are about to
  build date rendering on this field and cannot see the trap from their side.

### Explicit non-goals

- **Not** back-filling or normalising the stored column. Rewriting 6 000 rows
  of production data to fix a presentation problem is the wrong trade, and
  F212.1's migration 0043 has just shown what a full-table rewrite of
  `documents` costs in caution. Normalise at the boundary; leave the store
  alone.
- **Not** changing `formattedContext`. Every current consumer parses that
  string; injecting dates into it would change output for all of them to serve
  one. The structured field is the addition, and a consumer that wants the date
  in its prompt can put it there itself.
- **Not** adding freshness to chat, search, or the MCP surface. If those want
  it they can ask; retrieve is what was filed.
- **Not** a confidence/decay signal. F182 owns that, and conflating "when was
  this last edited" with "how much do we trust it" would muddle both.

## Architecture

One column added to the existing parent-document hydration in
`apps/server/src/routes/retrieve.ts` (the `select()` around line 121), carried
through the `filtered` shape, and normalised on the way out.

Normalisation, stated precisely because the naive version is wrong:

```
'2026-04-16T16:31:49.278Z'  -> unchanged (already ISO UTC)
'2026-06-22 12:07:09'       -> '2026-06-22T12:07:09.000Z'   (same instant — the
                               stored value is ALREADY UTC, so the fix is to
                               LABEL it, not to convert it)
anything else / empty       -> null
```

`new Date('2026-06-22 12:07:09').toISOString()` does NOT produce this — it
treats the input as local time and shifts it by the offset. The test asserts
the exact expected string so that mistake goes red rather than shipping.

## Dependencies

None. Additive to an existing response; no migration, no schema change.

## Rollout

Ship with the next engine deploy. Existing consumers ignore an unknown field,
so there is no coordination step — but components gets told the moment it is
live, along with the format trap, since their fallback prose ships in the
meantime and they will want to retire it.

## Stories

- **F213.1** — add the field, normalise it, and prove both stored formats come
  back as the same instant.
