# F148 — Link Integrity (ingen 404-fejl i hjernen)

> Tre lag der samlet garanterer at intet klik på et `[[wiki-link]]` eller et `/kb/<slug>/neurons/<slug>` lander på en 404. Prompt-regler der lærer LLM'en Trail's slug-konvention, URL-resolution-fallback med dansk↔engelsk-fold, og et link-checker-scheduler-job med en `broken_links`-tabel der auto-fixer entydige mismatches og rapporterer resten til curator. Tier: alle brains, alle connectors. Effort: Medium — 2-3 dage. Status: Planned.

## Problem

En Trail brain er ubrugelig hvis internt-link-klik 404'er. Den 2026-04-24 auditerede vi Demo Brain "zoneterapi" (26 Neuroner, 122 wiki-links) og fandt systematiske mismatches:

- LLM'en kompilerer en kilde på dansk, men navngiver Neuron-filer på **engelsk**: `yin-and-yang.md`, `five-elements-tcm.md`, `traditional-chinese-medicine.md`.
- Andre Neuroner citerer dem med **dansk** link-tekst: `[[Yin og Yang]]`, `[[De Fem Elementer]]`.
- Admin reader i `apps/admin/src/panels/wiki-reader.tsx:121` resolver URL'en ved at slå `slugify(slug)` op mod `slugify(filename-sans-.md)`. `slugify('Yin og Yang') = 'yin-og-yang'`, men filnavnet er `yin-and-yang.md` → slug `yin-and-yang` → **ingen match → 404**.
- Samme problem i backlink-extractor (`resolveLink` i `apps/server/src/services/backlink-extractor.ts:131`) — backlinks til den målrettede Neuron registreres aldrig fordi strategy 2 (slugified link text vs filename stem) fejler.
- Entity-Neuroner mangler helt links fra kilde-summaries: Gemini Flash nævner `Sanne Andersen` i prosa-teksten men glemmer at wrappe navnet i `[[...]]`, så person→source-forbindelsen aldrig optræder i graph- eller backlink-visningen.

Model-lab-eksperimentet (`apps/model-lab/data/REPORT.md` + `~/Downloads/MODEL-LAB-NEURON-LINK-QUALITY-RAPPORT.md`) fandt at ingen af de tre testede cloud-modeller (Gemini Flash, GLM, Qwen) producerer konsistente slugs af sig selv — det er en strukturel egenskab ved LLM'er: de har ingen indbygget forståelse for Trail's slug-konvention. Christians dekret: **der må være 0,0000000 404-fejl i en hjerne**. Tre lag i forsvar, fordi ét lag alene hver især er utilstrækkeligt.

## Secondary Pain Points

- Graph-view (F99) tegner ikke kanter hvis `wiki_backlinks`-rækken aldrig blev skrevet — så brain'en ser ud til at være sammensat af isolerede klynger selvom det er en strøm af citations der ikke kunne resolve.
- Entity-tælling i Queue / Connector-attribution (F95) viser underestimat af hvor mange Neuroner der faktisk refererer en given person når personnavne ikke er linket.
- Orphan-lint (F98) markerer dokumenter som "orphan" fordi ingen kommer ind til dem via backlinks — men det kan være pga. link-mismatch, ikke reelt orphan.
- Curator spilder tid på at manuelt rette link-tekst-casing i Neuroner (`[[De Fem Elementer (TCM)]]` vs `[[De Fem Elementer]]`) når toleransen burde leve i resolveren.

## Solution

Tre additive lag i forsvar:

1. **Prompt-lag** — udvid `apps/server/src/services/ingest.ts`-prompten med `kb.language`-injektion, en liste over eksisterende entity-Neuroner (ny `listKbEntities()` aggregator parallel med `listKbTags()`), og eksplicitte konsistens-regler ("filnavn, `title`-frontmatter og `[[link-tekst]]` SKAL slugify til samme streng", "dansk KB → brug `og` ikke `and`", "alle personnavne i kilden SKAL være `[[wiki-links]]`").

2. **URL-fallback-lag** — ny `normalizedSlug(slug, language)` i `packages/shared/src/slug.ts` der folder bilingual-drift (`og ↔ and`, `i ↔ of`, `med ↔ with`, `til ↔ to`) og fjerner parentes-kvalifikatorer. Anvendt symmetrisk i `wiki-reader.tsx` (URL→doc), `backlink-extractor.ts resolveLink()` (citationer→backlinks), og `wiki-links.ts targetToSlug()` (rendering). Kun ved entydig match; flertydighed falder videre til næste strategi.

3. **Link-checker-lag** — nyt `apps/server/src/services/link-checker.ts`-service + `broken_links`-tabel (migration `0013`). Spejler `contradiction-lint.ts`-mønsteret: subscriber på `candidate_approved` til per-doc re-check, daglig sweep via `lint-scheduler`. Auto-fix når den normaliserede fold peger entydigt på én Neuron. Flertydige eller uløselige mismatches lander som `queue_candidates` med `kind='broken-link-alert'` så curator ser dem i den eksisterende kø.

## Effort Estimate

**Medium** — 2-3 dage.

- Dag 1: Plan-doc commit + Lag 2 (fold + resolveLink + URL matcher + wiki-links.ts). Kør backfill, verificér nye backlinks.
- Dag 2: Migration 0013 + link-checker-service + routes + boot-registrering + admin-panel.
- Dag 3: Lag 1 (entity-aggregate + prompt-opgradering) + verifikations-script + Chrome DevTools smoke + success-criteria-rapport.

Buffer en halv dag til fold-edge-cases (parens-stripping-heuristik, flertydighed-håndtering).