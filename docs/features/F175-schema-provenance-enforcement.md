# F175 — Schema-level provenance enforcement

> Hver Neuron's `sources:`-frontmatter SKAL pege på filer i `raw/` (eller på `source`-typed Neurons). Validering sker ved candidate-write-time i `packages/core/src/queue/candidates.ts`. Candidates uden gyldig `sources:` bliver ikke approved — i stedet emitteres en `missing-provenance-alert`-finding som curator selv kan fixe ved at tilføje sources eller marke som `opinion-piece`-undtagelse. Eksisterende kildeløse Neurons får `provenance_status: 'legacy-unsourced'`-flag (ikke retroaktivt brudt). Bygger på F140's `_schema.md`-arkitektur ved at udvide den med `required_frontmatter_fields`-felt, så reglen er per-path-konfigurerbar — strikt for kanoniske concept/entity-Neurons, slappere for `notes/`/`heuristics/`. Inspireret af Shuyi Wang's "Pitfall 3: hallucinations have to be blocked at the schema layer" fra "Should You Actually Try Karpathy's LLM Wiki?" (2026-04-16). Tier: alle (core integrity-feature). Effort: Small-Medium 1-2 dage. Status: Planned.

## Problem

Trail's queue-arkitektur (F17) tillader candidates UDEN `sources:` i frontmatter at blive approved. F95 connector-attribution tracker WHO skrev candidaten (mcp:claude-code, buddy, chat); F15 `document_references` tracker hvilke kilder en Neuron CITERER i sin body. Men der er **ingen håndhævelse på write-time** af at en kanonisk Neuron må eksistere uden mindst én `sources:`-reference i frontmatter til en `raw/`-fil eller en `source`-typed Neuron.

Det åbner præcis den fælde Shuyi Wang advarer mod (s. 27-28):

> "Hallucinations have to be blocked at the schema layer. The LLM doesn't just hallucinate in its answers — it'll write hallucinations *into the wiki*, and once they're in there, they become 'history,' and downstream queries will cite them as fact. The contamination spreads. Governing this can't wait until the wiki is built — you have to lay down rules at the schema layer from day one."

Konkret risiko:
- Ingest-pipelinen producerer en concept-Neuron der "lyder rimelig" om et emne, men hvor LLM'en kun har én indirect-mention i kilden + 70 % på sin egen forhåndstræning.
- Candidat passerer F19 auto-approval ved confidence > 0.85.
- Neuronen lander i wiki'en uden source-grundlag.
- Næste chat-query mod KB'en finder Neuronen, citerer den.
- Ny candidate genereret af chat-save citerer den første som ground truth.
- **Hallucinationen reificeres som "history" og spreder sig.** Curator vil aldrig bemærke det medmindre de manuelt læser hver Neuron.

Trail's eksisterende beskyttelse:
- **F140 `_schema.md`** kan specificere `required_sections` (i body) — men ikke required frontmatter fields.
- **F15 `document_references`** registrerer cross-references — men kun hvad LLM'en eksplicit har skrevet ind, ikke hvad den BURDE have skrevet ind.
- **F32 contradiction-lint** finder modsigelser efter the fact — for sent når den hallucinerede Neuron allerede er citationsgrundlag.
- **F148 Link Integrity** dækker URL-nivå (fix dead links) — ikke source-provenance-niveau.

Fælles mønster: alle eksisterende beskyttelser er **reaktive** (find fejl efter de er sket). F175 er **proaktiv** (afvis fejlen ved write-time).

## Secondary Pain Points

- **F156 credits-kost falder på syntese der ikke burde have eksisteret.** Hvis LLM compiler en hallucineret concept-Neuron til 0.5 credits, brænder tenant'ens credits på ren støj. Schema-validation ved write-time forhindrer det udlæg.
- **F100 Obsidian Vault Export** og **F117 Git-Versioning Export** giver brugeren adgang til markdown-filer. En kildeløs Neuron der lækker ud i export ser ud som "afsenderens egne påstande" — men er reelt LLM-bullshit. Reputational risiko, særligt for B2B/healthcare-tenants som Sanne.
- **F39 cc-session ingest** modtager external-feed-candidates fra cc-sessioner; uden sources-validering kan en cc-session POST'e "min syntese af X"-content uden at angive hvilke filer/conversations der ligger bag, og det havner som første-klasses Neuron.
- **F124-F129 CMS-integration** sender artikler ind med structured metadata; F175 garanterer at CMS-kunden ikke kan skubbe Neurons ind UDEN at angive `cms-id` som source.

[Plan continues with technical design, rollout phases, test plans, and implementation steps...]

See full plan at /docs/features/F175-schema-provenance-enforcement.md
