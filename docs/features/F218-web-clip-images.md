# F218 — a web clip must bring the page, and its images

**Card:** trail-F218 · epic · critical

> Owner, 2 September 2026, clipping `fdaalborg.dk/medarbejdere/` into FD Aalborg:
> *"der er ikke kommet billeder ind i deres trail - hvorfor ikke? Det bør vores
> source HTML extraction kunne klare."*
>
> And the standard, in his words: ***"ALLE billeder fra et web clip så simpelt som
> dette SKAL bare med ind."***

Two independent faults. Only the second is the one he asked about — and fixing
only the first would look like success.

## Fault 1 — the clip captured the print header

The stored source is **321 characters**. His other 20 clips average **12,865**.
The entire content:

```
![Logo](…fysiodk_logos_aalborg…jpg)
(Denne artikel er printet fra https://fdaalborg.dk/medarbejdere/)
Tekst størrelse:
```

That is a WordPress **print-plugin block**. The real page carries **40 `<img>`
tags** including every staff portrait — all in the raw HTML, with **zero**
lazy-loading attributes, so nothing was hidden behind JavaScript.

One line causes it, in `apps/web-clipper/src/content/extractor.ts`:

```ts
charThreshold: 0
```

Readability's `charThreshold` is the floor below which it **retries** with less
aggressive stripping. At `0` it never retries — the first pass wins even when it
yielded 321 characters of chrome. **The library's default is 500 and exists for
exactly this page shape.** We turned off the quality gate that would have caught
it.

## Fault 2 — no web clip has ever brought an image file

Measured across every clip in both tenants:

```
broberg-ai       20 clips · 0 with image rows · avg 12,865 chars
sanne-andersen    1 clip  · 0 with image rows · avg  1,693 chars
```

Images survive extraction only as markdown links. **Nothing fetches them.**

A PDF's images become real files in storage with `document_images` rows (F161,
`persistImagesFromExtraction`). An HTML page's images stay as remote URLs
pointing at someone else's server — so they are not searchable, not
Vision-describable, not counted in the Trail's size, and they break the day that
site reorganises.

## Why fixing only Fault 1 would look like success

The clip would arrive with ~13,000 characters and 40 image **links**. The page
would read correctly. And **not one image would be in the Trail.**

That is the trap worth naming: the visible symptom (an empty page) and the
reported problem (no images) have different causes, and the loud one masks the
quiet one.

## Scope

**F218.1 — stop accepting the print header.** Restore the retry threshold, and
prove the staff page extracts. The negative control carries equal weight: the 20
clips that work today must still work.

**F218.2 — pull the images in.** Parse image URLs out of the extracted markdown,
fetch them, write the bytes to storage, and hand them to
`persistImagesFromExtraction` so an HTML page's images land in the same table,
with the same shape, as a PDF's.

## Constraints that shape F218.2

- **The bytes must live in the Trail.** A stored link is what we have today, and
  it is what fails.
- **Bounded fetching.** Size cap, count cap, timeout, content-type check. An
  unbounded fetch loop over a hostile page is a denial-of-service against
  ourselves.
- **One table.** Reuse `persistImagesFromExtraction`, or size, search and Vision
  each grow a second code path.
- **Never drop an image silently.** A clip that quietly brings 3 of 40 looks
  identical to one that brings all 3 there were — this week's recurring shape,
  and the reason the count must be reported.

## Non-goals

- Not fetching images at READ time from the origin. That is today's behaviour in
  a different costume.
- Not rendering JavaScript. This page needed none; a page that does is a
  separate problem and should say so rather than arriving empty.
- Not backfilling the 21 existing clips in this epic. Worth doing, worth deciding
  separately.
