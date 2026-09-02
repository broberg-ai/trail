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

## Fault 2 — the question contains no word that can find the answer

> **Corrected twice on 2 September 2026.** First reading: *"koster returns 0
> hits, so the chat found nothing."* Wrong — the chat found plenty. The owner's
> second screenshot settled it, and its `SOURCES` row is the evidence.

Measured on the live Trail (`fd-aalborg` / `admin-chat`):

```
"koster"                        →  0 documents. The word occurs NOWHERE.
"behandling"                    →  20 documents. priser.md is one of them
                                   (8 occurrences) and ranks BELOW 10th.
"koster behandling"             →  byte-identical list to "behandling" alone.
"behandling pris"               →  priser.md is #1.
"koster behandling pris priser" →  priser.md takes #1, #2 AND #3.
```

The owner's screenshot cited `traening-er-behandling`, `holdsale`,
`patientforloeb`, `laser-terapi` — **exactly the top 4 of the `behandling`
measurement**, not the feedback notes. So the deployed chat already drops filler
words, and F219.1 changes *which four wrong documents* it gets.

**Why the price loses.** `priser.md` is a long price list where *behandling* is
incidental. The documents that beat it are short and about exactly that word.
BM25 rewards density and penalises length. The chat reads the top 4, so the
price is never in the room.

**Ranking cannot fix this.** After the filler words are dropped there is one
term left, so BM25's rare-term weighting has nothing to work with. The
information needed to find the answer is not in the query at all. It has to be
**added** — by a synonym now, or by embeddings much later and at an order of
magnitude more cost.

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

> **Corrected 2 September 2026, before any code was written.** This section said
> **three** files. Measured across `apps/` and `packages/`: **seven**, in five
> distinct behaviours. The correction matters because it changes which fault
> belongs to which surface — see the next section.

| copy | `"Hvad koster en behandling"` becomes |
|---|---|
| `chat.ts` | `"koster"* OR "behandling"*` — **stopwords already dropped** |
| `search.ts` | `"Hvad"* OR "koster"* OR "en"* OR "behandling"*` |
| `retrieve.ts` | same, but strips punctuation *inside* a term |
| `images-search.ts` | identical to `retrieve.ts` |
| `services/chat/mcp-router.ts` | `hvad koster en behandling` — space-joined, i.e. implicit **AND**, no prefix |
| `apps/mcp/src/index.ts` | strips inside terms — `TV-lyd` → `"TVlyd"*`, a token the index cannot hold |
| `packages/core/.../candidate-api.ts` | space-joined, no prefix |

The same words meant three different things depending on which box the user
typed them into. **One implementation, or this returns in a month.**

## What the correction changes — F219.1 does not fix the reported answer

`chat.ts` has dropped function words since **d4e1fa9, 25 June 2026**. So the
chat, when asked *"Hvad koster en behandling"*, searched for `koster` OR
`behandling` — correctly — and **still** failed.

The evidence in this plan-doc (two questions, one identical result list) was
measured on the **search page**, which has no stopword filter. It was then
attributed to the chat, which does. Two different code paths.

**Therefore:**

| | fixes the search page | fixes the owner's chat answer |
|---|---|---|
| **F219.1** stop words | yes | **no** |
| **F219.2** vocabulary | — | yes |

F219.1 is still worth doing — it finishes a fix that reached one file out of
seven, and it removes a copy that could never match a hyphenated term at all.
But it must not be reported as the fix for what he saw.

## Scope

**F219.1 — one query builder, stop words dropped.** Never dropping every term,
and used by all **seven** call sites.

> **Deviation from the constraint, stated rather than taken quietly.** The card
> requires a **per-language** stop-word list. Shipped instead as one
> Danish+English **union**. A Danish Trail routinely holds English Neurons
> (commit messages, library docs) and the reverse, so choosing a list from the
> KB's `language` column drops the wrong half on exactly the mixed content where
> recall matters most. The union is also byte-for-byte what `chat.ts` has run in
> production since June, so the one surface that already worked changes by
> nothing. Per-language remains available as a follow-up — it is a decision, not
> a silent difference.

**F219.2 — bridge the vocabulary gap.** How a person asks vs how a Neuron is
written. `packages/shared/src/fts-synonyms.ts`: a deliberately short map of
everyday ASK-verbs to the NOUNS documents are written with (`koster`→`pris`,
`åbner`→`åbningstider`, `ringe`→`telefon`). Not a thesaurus and not domain
knowledge — a property of Danish and English that holds for a clinic, a webshop
and an HR handbook alike. Capped at four added terms.

**The control that makes it safe to ship came from a peer.** fd-sundhed, asked
about the Neuron and correctly answering that the KB was not theirs, added the
point that decided the design: a search that starts finding the price must not
start finding *something* for every question. **Trading "I do not have that" for
a confident wrong answer is the more expensive failure.** So expansion is
additive-only, bounded, and never fires on a question with no ask-word — with a
negative control asserted in both directions, on the live Trail and in the probe.

## Verification

The regression case is the owner's exact question, against the real Trail:

> **"Hvad koster en behandling" must return `priser.md`.**

**That is the EPIC's criterion and it is met only after F219.2.** F219.1's own
probe asserts the opposite on purpose — it prints that the price Neuron is still
not retrieved — so a green F219.1 can never be mistaken for a fixed epic.

And the negative control is load-bearing in the other direction: a question that
is *entirely* stop words must still search on something. Turning a bad answer
into no answer is not a fix.

### An unreachable guard was removed, not added

F219.2's first version refused to expand a pure-filler question. The mutation
run showed that removing that branch reddened **zero** tests — it could never
execute, because no stopword is an ask-word. It was deleted and replaced by a
test asserting exactly that precondition, which goes red the day someone adds
`hvor: ['adresse']` — the single edit that would make it reachable. A guard that
cannot be exercised is not protection; it is the appearance of protection.

### What shipped for F219.1

- `packages/shared/src/fts-query.ts` — the one builder. Two invariants, each
  with a test that goes red if it is removed.
- `packages/shared/src/fts-query.test.ts` — 12 tests, run by `pnpm test`, which
  the deploy workflows depend on. Mutation-checked: removing the stopword
  filter, the punctuation split, the empty-query guard and the OR-join each
  redden a **different** set.
- `apps/server/scripts/verify-f219-fts-query.ts` — runtime proof against a real
  `porter unicode61` FTS5 index, seeded so the price Neuron does **not** contain
  the word `koster`, the way the real one does not.

**One assertion in that suite was theatre and was replaced.** "The two questions
no longer produce the same query string" passed even with the stopword filter
removed — the strings differ either way. It now asserts that no function word
survives as a term, which reddens under exactly that mutation. Same failure
shape as the rest of this week: a check that cannot discriminate between the two
states it exists to tell apart.

**And the fixture was wrong before it was right.** The first version omitted the
treatment Neurons the plan-doc had actually measured, so the probe reported a
failure that came from the fixture rather than the code. It was corrected to
match the measurement — not bent until it agreed.


## The guard that was blind — twice, before it worked

fd-sundhed (intercom #24987) asked the question that changes this story's
quality: *every negative control here was built around the ONE document already
known to be the problem. Can the expansion make some OTHER long document sink?*

It is the right question, and answering it took three attempts.

**Attempt 1 — a live ranking sweep.** `verify-f219-2-expansion-sweep.ts` runs 13
realistic customer questions against the live Trail and compares the top 4 with
expansion on and off. Result: 8 expanded, 5 untouched, **2 gained a new #1 and
both were the price Neuron** — the intended effect. No question lost a correct
top result.

Then it was mutation-tested against a plainly wrong entry, `hændelse: ['pris']`:

> **The sweep stayed GREEN.** "Hvad er en utilsigtet hændelse" started searching
> for prices, and the #1 result did not move, so the comparison saw nothing.

A guard that cannot see a wrong synonym is not a guard against wrong synonyms.
That is the same shape fd-sundhed had just warned about, arriving one layer down.

**Attempt 2 — a behavioural snapshot** pinning what each of nine questions
expands to. Mutation-tested with `patient: ['pris']`:

> **Zero red.** The only question mentioning patients tokenises to
> `patientforløb` — one token, never `patient`. The snapshot only ever sees what
> its examples happen to contain.

**Attempt 3 — pin the LIST, not its effects.** `expansionEntries()` is asserted
entry by entry. Three mutations, three different wrong synonyms, **all three
red**. Changing the list stays easy; changing it *without saying so* does not.

All three are kept, because they fail differently: the pin catches every edit,
the snapshot states what the edit MEANS, and the live sweep is the only one that
can see a ranking side-effect on real data. Re-run the sweep whenever the list
grows — that is what it is for.

**What none of them can do**, stated rather than implied: no automated check
here judges whether a synonym is *semantically* right. `patient → pris` reddens
because the list changed, not because a machine knew it was wrong. The list
stays short so a human can read all twenty entries in ten seconds; that is the
actual defence, and the tests exist to force someone to look.
