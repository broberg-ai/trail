# F184 — Entity Layer + Knowledge Graph Queries

> Trail today has typed edges between Neurons (F137) but no first-class entity layer. "React" exists only as a wikilink target with possibly several Neurons mentioning it; there's no canonical "React-the-library" entity with attributes (latest-version, owner, depends-on-list) and no way to query "what depends on React?" via graph traversal. F184 introduces an `entities` table populated by LLM extraction at ingest, entity-aware F89 chat tools that walk the graph, and bidirectional entity-Neuron references. This is what turns Trail from "compile-time pages" into "compile-time intelligence." Tier: all. Effort: Large — 10-14 days for Phase 1+2. Status: Planned.

## Open questions (interim plan-doc)

This is an **interim plan-doc** written 2026-05-05 from Rohit Ganapathy's *LLM Wiki v2* gist + Neo4j's *AI knowledge layer* enterprise pitch. The gnusupport critique applies sharply here — entity-extraction is exactly the kind of thing that's "AI-complete in production." Open questions:

1. **Entity types — fixed taxonomy or schema-defined?** Proposal: **schema-defined per-KB via F140 `_schema.md`**. Each KB declares its entity vocabulary (Sanne's clinical KB: `treatment`, `condition`, `point`, `meridian`, `patient-archetype`. Tech KB: `library`, `framework`, `concept`, `person`, `decision`). Default vocabulary for KBs without schema: `person`, `project`, `concept`, `library`, `decision`, `file`. The schema makes ingest extraction deterministic instead of LLM-decides-on-the-fly.

2. **Entity dedup / canonicalization.** Two ingests both extract "React" — same entity or two? Proposal: deterministic canonicalization via case-folded slugified name + entity-type. Conflicts (e.g., "React"-the-library vs. "React"-the-Apple-feature) require LLM disambiguation step at extract-time + curator merge UI. Phase 1 ships with case-fold-only dedup; Phase 2 adds disambiguation.

3. **Entity attributes — free-form JSON or schema-typed?** Proposal: schema-typed per entity-type, declared in `_schema.md`. Sanne's `treatment` entity-type might have schema `{duration_min: int, frequency_per_week: int, indications: string[]}`. Free-form attributes go in `metadata.extra` JSON column. Phase 1 ships free-form; Phase 2 adds typed attributes.

4. **Per-Neuron extraction cost.** LLM extraction adds tokens to ingest. Estimate: +500-1000 tokens per source. At F156 credit-rates this is ~+10% on ingest cost. Acceptable per Dunham economics, but should be opt-out per KB for cost-sensitive tenants.

5. **Graph traversal query language — Cypher / SQL / domain-specific?** Proposal: NOT exposing query language to users. F89 chat tools get new MCP tools (`entity_neighbors(name, depth, edge_types)`, `entities_matching(type, attribute_filter)`) that the LLM uses internally. Power-users can ask "what depends on React?" in natural language; the LLM picks the right traversal tool. Cypher / SPARQL exposure is YAGNI for v1.

6. **Storage — same trail.db or separate graph store?** Proposal: same trail.db with relational tables. SQLite handles graph-traversal queries up to ~100K edges fine via recursive CTEs. Going to Neo4j or a real graph DB is a Phase 4 question for tenants with massive KBs (>50K Neurons). Stay in trail.db for now — multi-tenant ergonomics matter more than peak graph performance.

7. **Re-extraction on schema change.** When `_schema.md` adds a new entity type, do we re-extract existing Neurons? Proposal: lazy re-extraction. Old Neurons keep their existing entity links. New ingests use the new schema. Bulk-reextract is a manual admin action ("Reingest with current schema") tracked per F143.

8. **Entity Neuron — first-class or just rows?** Proposal: hybrid. Entities live in the `entities` table (lightweight rows). Each entity OPTIONALLY has a "primary Neuron" — a Neuron explicitly about that entity (e.g., `/neurons/entities/react.md`). The primary Neuron is where extended prose lives; the entity row is for graph queries. Most entities won't have primary Neurons (just structured rows); important ones will.

These open questions are blocking neither the plan-doc nor the F-number.

## Motivation

Rohit's v2 framing:

> *"The original wiki is pages with wikilinks. That works, but you're leaving structure on the table. What you actually want is a typed knowledge graph layered on top of the pages. When the LLM ingests a source, it shouldn't just write prose. It should extract structured entities. People, projects, libraries, concepts, files, decisions. Each entity gets a type, attributes, and relationships to other entities. 'React' is a library. 'Auth migration' is a project. 'Sarah' is a person who owns the auth migration and has opinions about React."*

Plus the Neo4j enterprise framing (Sudhir Hasbe, April 2026):

> *"AI systems that incorporate graph-based grounding achieve higher accuracy in question-answering and decision-making tasks. A recent study from Cornell's open-access archive arXiv shows a threefold improvement in large language model (LLM) Q&A accuracy when queries are posed over knowledge graphs rather than SQL alone."*

Trail today:
- F137 typed edges (`cites`, `is-a`, `part-of`, `contradicts`, `supersedes`, `example-of`, `caused-by`) on `wiki_backlinks` table
- F99 Obsidian-style graph render
- F89 chat tools include MCP-backed introspection (`count_neurons`, `count_sources`, `recent_activity`)

What's missing:
- **Explicit entity layer** — `entities` table with type/attributes
- **Entity-extraction at ingest** — LLM identifies people / projects / libraries / concepts / files / decisions and creates entity rows
- **Bidirectional Neuron-entity references** — Neurons mention entities; entities track which Neurons mention them
- **Graph traversal queries** — F89 chat can answer "what depends on React?" by walking edges

This is the architectural piece that turns Trail from "structured pages with links" into "structured pages PLUS a queryable graph of entities." The graph augments the pages; pages remain authoritative for prose, the graph is for relationship-questions.

### Why this matters

The Cornell paper Rohit cites (3x accuracy improvement on Q&A grounded in KG) is the empirical case. The qualitative case: every interesting Trail use-case eventually wants relationship queries.

- Sanne: "show me all treatments that target the Heart meridian and have been used for insomnia patients in the last 2 years"
- Christian: "what depends on the F143 queue table? I want to refactor it"
- Journalist: "which interview-sources mentioned the climate-policy person who was named in the leaked memo?"

None of these are answerable with FTS5 keyword search alone. They require entity-as-first-class + typed-relationship traversal.

### Why now (vs deferred)

This is the biggest architectural shift of the v2 features — bigger than F182 lifecycle or F183 tiers. **Should ship AFTER F182 lifecycle** (so entities can have lifecycle metadata too) but **BEFORE F185 hybrid search** (entities are one of the three retrieval streams in RRF fusion).

Realistic priority: **Phase 3 post-Sanne-launch**, after F182+F183 land. Possible to start architectural work in parallel with F182 if engineering bandwidth allows.

## Scope

### In scope (Phase 1 + Phase 2)

- **`entities` table** — id, kb_id, type, canonical_name, slug, attributes_json, primary_neuron_id, created_at, updated_at, lifecycle metadata per F182
- **`entity_mentions` table** — bidirectional join: neuron_id ↔ entity_id with mention-context (LLM-extracted snippet + position)
- **`entity_relationships` table** — typed edges between entities (different from F137's Neuron-to-Neuron edges): entity_a_id, edge_type, entity_b_id, confidence, source_neuron_id
- **Entity-extraction step** in F06 ingest pipeline: after ingest writes Neuron, second LLM call extracts structured entities + relationships per `_schema.md` vocabulary
- **`_schema.md` extension** — new optional `entities:` block declaring vocabulary + attribute types
- **Entity admin UI** — list view per type, detail view (entity + attributes + mentioning Neurons + related entities), merge UI for dedup conflicts
- **Reader entity sidebar** — when viewing a Neuron, show "Entities mentioned in this Neuron" panel with type-grouped chips
- **F89 chat tools — graph traversal**:
  - `entity_lookup(name, type?)` — find entity by name
  - `entity_neighbors(entity_id, depth=1, edge_types?)` — walk relationships
  - `entities_matching(type, attribute_filter)` — list entities by type + structured attributes
  - `neurons_mentioning(entity_id)` — all Neurons that mention an entity

### Non-goals (Phase 1 + Phase 2)

- External knowledge-graph DB integration (Neo4j, ArangoDB) — stay in trail.db
- Cross-tenant entity sharing (Sanne's "auth_token" entity ≠ another tenant's "auth_token")
- User-exposed graph query language (Cypher / SPARQL)
- Entity-level lifecycle confidence (Phase 1 inherits Neuron-level F182 confidence)
- Visual graph editor in admin (read-only views only)
- Entity-driven landing-page generation
- Multi-language entity names (Phase 1 single-language; bilingual canonicalization is Phase 3+)

## Architecture sketch

### Data model

Migration adds three tables:

```sql
CREATE TABLE entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kb_id INTEGER NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  type TEXT NOT NULL,             -- 'person', 'library', 'project', 'concept', 'decision', 'file', or schema-defined
  canonical_name TEXT NOT NULL,    -- display name, case-preserved
  slug TEXT NOT NULL,              -- case-folded + slugified for dedup
  attributes_json TEXT,            -- JSON, schema-typed if _schema.md declares types
  primary_neuron_id INTEGER REFERENCES documents(id),
  confidence REAL NOT NULL DEFAULT 0.7,  -- per F182
  superseded_by_entity_id INTEGER REFERENCES entities(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (kb_id, type, slug)
);

CREATE TABLE entity_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  neuron_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  context_snippet TEXT,            -- LLM-extracted surrounding text
  position_start INTEGER,
  position_end INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (neuron_id, entity_id)
);
CREATE INDEX idx_entity_mentions_entity ON entity_mentions(entity_id);
CREATE INDEX idx_entity_mentions_neuron ON entity_mentions(neuron_id);

CREATE TABLE entity_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kb_id INTEGER NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  entity_a_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,         -- same vocabulary as F137: 'depends-on', 'uses', 'is-a', 'caused', 'fixed', 'contradicts', 'supersedes' + custom per-schema
  entity_b_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  confidence REAL NOT NULL DEFAULT 0.7,
  source_neuron_id INTEGER REFERENCES documents(id),  -- which Neuron asserted this relationship
  created_at INTEGER NOT NULL,
  UNIQUE (kb_id, entity_a_id, edge_type, entity_b_id)
);
CREATE INDEX idx_entity_rel_a ON entity_relationships(entity_a_id, edge_type);
CREATE INDEX idx_entity_rel_b ON entity_relationships(entity_b_id, edge_type);
```

### `_schema.md` vocabulary block

```yaml
---
entities:
  types:
    - name: treatment
      slug_prefix: tx
      attributes:
        duration_min: integer
        frequency_per_week: integer
        indications: string[]
    - name: condition
      slug_prefix: cond
      attributes:
        severity: enum[mild, moderate, severe]
    - name: point
      slug_prefix: pt
      attributes:
        meridian: string
        location: string
  relationships:
    - treatment-targets-condition
    - point-on-meridian
---
```

If `_schema.md` doesn't declare `entities:` block, Trail uses the default vocabulary (`person`, `project`, `concept`, `library`, `decision`, `file`) with free-form attributes.

### Extraction pipeline

`apps/server/src/services/entity-extraction.ts`:

```ts
async function extractEntitiesFromNeuron(deps: {
  neuron: NeuronRow;
  schema: KbSchema;
  kb: KbRow;
}): Promise<{ entities: EntityCandidate[]; relationships: RelationshipCandidate[] }> {
  const prompt = buildExtractionPrompt(deps.neuron.content, deps.schema.entities);
  const response = await llmCall(prompt, {
    model: 'gemini-2.5-flash',  // cheap by default; opt-in to Sonnet per KB-config
    schema: extractionResponseSchema,  // structured output
  });
  return validateAndCanonicalise(response, deps.kb);
}
```

Triggered after F06 ingest writes the Neuron. Output:
- New entities → `entities` table (with dedup-on-slug, merge-existing if found)
- Entity mentions → `entity_mentions` table
- New relationships → `entity_relationships` table
- Cost metered per F156 credits

### F89 chat tool extensions

New MCP tools registered in F89:

```ts
tools.register('entity_neighbors', {
  schema: { entity_name: string, depth: number, edge_types: string[]? },
  handler: async ({ entity_name, depth, edge_types }) => {
    const entity = await findBySlug(canonicalize(entity_name));
    return walkGraph(entity.id, depth, edge_types);
  },
});

tools.register('entities_matching', {
  schema: { type: string, attribute_filter: object? },
  handler: async ({ type, attribute_filter }) => {
    return queryEntities({ type, attributes: attribute_filter });
  },
});
```

### Reader entity sidebar (Phase 2)

When viewing `/trails/<kb>/<neuron-slug>`, the right sidebar gets a new "Entities" panel:

```
ENTITIES IN THIS NEURON

People
  Sarah Chen → opens /entities/person/sarah-chen
  Bob Martinez

Libraries  
  React → 12 mentions across this KB
  TypeScript → 4 mentions

Decisions
  Auth migration to Clerk → 2 Neurons
```

Click any entity → entity-detail page showing all mentioning Neurons + related entities + attributes.

### Admin entity browser (Phase 2)

`/admin/kb/:id/entities` route:
- Type-grouped list (collapsible per type)
- Filter by attribute (e.g., `severity = severe`)
- Bulk-merge UI for dedup conflicts (LLM-flagged)
- Export entities-and-relationships as JSON for offline analysis (per Rohit's "output formats beyond markdown")

## Dependencies

- **F182 Memory Lifecycle** — entities have confidence too; supersession applies to entities
- **F140** schema files — vocabulary declaration + attribute typing
- **F137** typed edges — F184's entity-relationships table is parallel to F137's Neuron-relationships, same edge-type vocabulary, can share rendering code
- **F06** ingest pipeline — extraction step bolts on after Neuron write
- **F89** chat tools — graph-traversal MCP tools
- **F99** graph render — entities can be rendered alongside Neurons (different node shapes)
- **F143** queue — large-scale re-extraction emits candidates (per-Neuron) to queue
- **F148** link integrity — entity-mentions need same drift-resistance (folded slug + canonical_name)
- **F149** + **F179** model selection — extraction defaults to Flash + batch
- **F156** credits — extraction cost metering

## Rollout phases

**Phase 1 — Foundation (5 days)**
- Migrations: 3 tables + indexes
- `_schema.md` extension parser
- Entity-extraction service with default vocabulary
- F06 pipeline integration (extraction step after Neuron write)
- F89 entity-traversal MCP tools (basic: lookup + neighbors)
- Verification script

**Phase 2 — UI + advanced (5 days)**
- Reader entity sidebar
- Admin entity browser
- Per-schema entity-vocabulary editor
- Bulk-merge UI for dedup
- Per-attribute filtering
- F89 advanced tools (`entities_matching` with attribute filter)
- Export to JSON

**Phase 3 — Bilingual + tuning (3-5 days, optional)**
- Cross-language entity canonicalization (per F148 bilingual-fold pattern)
- Calibration on Sanne's KB
- Performance tuning (recursive CTEs vs. denormalized neighbor cache)

**Phase 4 — Future, separate F-number**
- External graph DB integration (Neo4j) for tenants > 50K Neurons
- Cypher / SPARQL exposure to power users
- Entity-level revision history (currently inherited from primary_neuron)

## Verification

`apps/server/scripts/verify-entity-extraction.ts`:

1. Create test KB with `_schema.md` declaring `library`, `framework`, `person` entity types
2. Ingest synthetic Neuron containing "React is a library by Meta. Sarah uses React for the auth-migration."
3. Assert: 4 entities created — React (library), Meta (organization, default-vocab fallback), Sarah (person), auth-migration (project)
4. Assert: `entity_mentions` has 4 rows linking Neuron → entities
5. Assert: `entity_relationships` has at least 2 rows: React-uses-Meta, Sarah-uses-React
6. Call `entity_neighbors('React', depth=1)` → returns Sarah, Meta, auth-migration
7. Call `entities_matching('library', {})` → returns React (and others if present)
8. Ingest second Neuron mentioning React → assert entity NOT duplicated, single React row, mention-count=2
9. Assert: F156 credits debited for both extractions

## Effort estimate

Phase 1 + Phase 2 combined: **10-14 days**. This is the largest of the v2-derived plan-docs by 50%. Phase 3 tuning is open-ended.

## Status

**Planned, deferred to post-F182 + Sanne Phase 2.** F-number reserved + interim plan-doc captured 2026-05-05.

The Cornell-paper-cited 3x accuracy lift from KG-grounded queries is the empirical case. The qualitative case is that every Trail use-case eventually wants relationship queries that pure-text-search can't answer. F184 is the architectural shift that makes "compile-time intelligence" honest — without entities, Trail is "compile-time pages." With entities, queries that walk relationships become possible.

Once F184 lands, F185 hybrid search (BM25 + vector + graph + RRF) becomes natural — entity-graph traversal is the third stream Rohit names. So the natural sequence is F182 → F183 → F184 → F185.

---

_Plan-doc derived from [docs/thinking/LLM-WIKI-V2-CROSSCHECK.md](../thinking/LLM-WIKI-V2-CROSSCHECK.md) — 2026-05-05 trail-research session._
