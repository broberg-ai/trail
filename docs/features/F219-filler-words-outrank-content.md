# F219 — the Trail had the answer and said it did not

**Card:** trail-F219 · epic · critical

> Owner, 2 September 2026, asking FD Aalborg's Trail **"Hvad koster en
> behandling"**. It answered *"Det har jeg ikke i denne Trails Neuroner"* —
> while a Neuron called `priser.md` sat in that exact Trail.

## The answer exists

Searching `pris` returns `priser.md` as the **top hit**. Indexed, findable,
there the whole time.

## Fault 1 — the filler words decided the answer

```
"Hvad koster en behandling"  →  👍 Positive feedback: Hvad er FD Sundhed · en_medarbejder_beder… · Utilsigtet-haendelse
"hvad er en"                 →  👍 Positive feedback: Hvad er FD Sundhed · en_medarbejder_beder… · Utilsigtet-haendelse
```

**Identical.** The four result slots were filled by **"hvad"** and **"en"**.

The control, with the filler removed:

```
"koster behandling"  →  traening-er-behandling · Holdsale · patientforloeb · laser-terapi
"behandling pris"    →  priser.md  ← top hit
```

One line causes it — `sanitizeFtsQuery`:

```ts
"Hvad"* OR "koster"* OR "en"* OR "behandling"*
```

Every word of the question, OR'd. Stop words match nearly every document, fill
every slot, and crowd out the terms that carry the meaning.

**The chat did not hallucinate.** It answered honestly about the four documents
it was handed — and cited them in the reply. It was given the wrong context.

## Fault 2 — "koster" does not exist in the Trail

```
"koster"  →  0 hits
```

The Neuron says *priser* and *kr.* A person asks *"hvad koster"*. Keyword FTS
cannot bridge that; a human bridges it without noticing.

## Why both must be fixed

| Fix only | Result |
|---|---|
| Fault 1 | the treatment Neurons instead of feedback notes — **still not the price** |
| Fault 2 | the synonym finds it, and the filler words crowd it back out |

## Why nobody caught it

The answer **looked reasonable**. It named relevant topics, cited four real
sources, and suggested phoning the clinic. Nothing in it hinted the price had
been in the knowledge base the whole time.

Sixth instance this week of one shape: **"found nothing" and "looked in the wrong
place" arrive as the same sentence.**

## The landmine under the fix

`sanitizeFtsQuery` exists in **three files** — `retrieve.ts:381`,
`images-search.ts:347`, `search.ts:242` — and they have **already drifted**:
`search.ts` splits on punctuation and carries a comment explaining why
(`TV-lyd` → two tokens, not `TVlyd`); the other two strip within terms and would
silently return zero on the same input.

So a fix applied to one surface leaves the chat, the search page and image search
disagreeing about what a query means. **One implementation, or this returns in a
month.**

## Scope

**F219.1 — one query builder, stop words dropped.** Per-language (the KB carries
`language`), never dropping every term, and used by all three call sites.

**F219.2 — bridge the vocabulary gap.** How a person asks vs how a Neuron is
written. Deliberately a separate story: it is a language problem, not a search
bug, and the options differ in cost by an order of magnitude.

## Verification

The regression case is the owner's exact question, against the real Trail:

> **"Hvad koster en behandling" must return `priser.md`.**

And the negative control is load-bearing in the other direction: a question that
is *entirely* stop words must still search on something. Turning a bad answer
into no answer is not a fix.
