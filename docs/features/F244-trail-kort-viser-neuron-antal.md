# F244 — Trail-kortet viser antal Neuroner

**Ejer-rapporteret 4/9-2026** (skærmbillede af broberg.ai-kortet): kortet i Trails-oversigten viste kun beskrivelse + "2.0 MB". Christian: «Her må der gerne stå antallet af neuroner».

## Motivation

Størrelsen i MB siger intet om værdien af en Trail — antallet af Neuroner er det tal, der fortæller hvor meget viden den rummer. Det er også det tal, side-headeren allerede viser som total ("Neuroner på denne trail-server: N"), så kortniveauet manglede blot samme information pr. Trail.

## Scope

- `apps/admin/src/panels/kbs.tsx`: render `wikiPageCount` pr. kort i meta-linjen, foran størrelsen: "1.234 neuroner · 2.0 MB". `data-testid="trail-neurons-<slug>"`.
- Meta-linjen renderes nu når KB'en har `size` ELLER et talligt `wikiPageCount` (før: kun size).
- i18n: `kbs.neuronCount` ("{n} neuroner" / "{n} neurons") i begge locale-filer. Lokaliseret talformat (da-DK tusindtalsseparator).

## Non-goals

- Ingen ny server-forespørgsel — `wikiPageCount` ligger allerede i liste-svaret (bruges af totalen). Nul ekstra latenstid.
- Ingen ændring af KB-listens API-form.

## Reuse

Genbruger eksisterende `wikiPageCount` fra liste-svaret og eksisterende i18n-mekanik. Ingen ny kapabilitet — Discovery-tjek ikke relevant for en ren render-ændring.

## Verifikation

Typecheck + build grøn. Efter deploy (afventer chunk-jobbets afslutning — ejers freeze): Lens-capture af Trails-oversigten, assert at broberg.ai-kortet viser Neuron-tal + MB, og at tallet matcher KB'ens wikiPageCount fra API'et (strict, ikke contains).
