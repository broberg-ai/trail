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

## Solution

### Tre konkrete validerings-locks

Implementér Wang's "tre låse" som hvad der eksplicit valideres ved candidate write-time:

#### Lock 1 — `raw/`-laget er immutable

`raw/` (= `source`-typed documents, dvs. `documents.kind = 'source'`) kan kun **oprettes** af pipelines (F08 PDF, F09 Markdown, F24 DOCX, F25 Image, F47 Audio osv.) og kan **aldrig** edites af LLM'en. Allerede delvist enforced (sources er soft-archivable, ikke mutable). F175 cementerer det med en run-time guard i `candidates.ts`:

```typescript
if (input.kind === 'edit' && targetDoc.kind === 'source') {
  throw new ProvenanceViolationError('Sources are immutable; cannot LLM-edit a raw source.');
}
```

#### Lock 2 — Hver `wiki`-Neuron's frontmatter SKAL indeholde `sources:` med mindst én gyldig reference

Hvad er en gyldig source-reference?

- **Path til en eksisterende `kind='source'`-document i samme KB**: `sources: ["sources/sanne-bog-kapitel-3.md"]` eller seqId-form `sources: ["sanne_00000042"]`.
- **Eller**: en `external-feed`-reference med tydelig provenance: `sources: ["cc-session:eda9113e-9489-..."]` (for F39) eller `sources: ["cms-id:webhouse/article/123"]` (for F124).
- **Eller**: en eksplicit `opinion-piece`-undtagelse: `sources: ["opinion-piece"]` plus `provenance_status: 'opinion-piece'` i frontmatter (sjælden, kræver red-zone curator-klik per F174).

Validation:

```typescript
if (input.kind === 'create' && targetType === 'wiki') {
  const sources = input.frontmatter.sources ?? [];
  if (sources.length === 0) {
    return emitProvenanceAlert(input, 'no-sources');
  }
  for (const ref of sources) {
    if (!await isValidSourceRef(ref, kbId, tenantId)) {
      return emitProvenanceAlert(input, 'invalid-source-ref', ref);
    }
  }
}
```

Når validation fejler → candidate bliver IKKE approved. I stedet emitteres en `missing-provenance-alert`-candidate som curator selv kan resolve ved at:
- (a) **tilføje gyldig `sources:`** og re-submit
- (b) **markere som `opinion-piece`** (red-zone klik per F174 — kræver bekræftelses-modal)
- (c) **dismisse som "garbage"** og slette candidaten

#### Lock 3 — Hver page-creation/modification SKAL opdatere `index.md` og `log.md`

Trail har allerede `wiki_events`-tabel (F16) der fungerer som strukturelt log. Trail har ikke en eksplicit `index.md`/`log.md` markdown-fil i hver KB endnu — det er F100's eksport-target og F130's `llms.txt`-aggregat.

For F175's scope: **garanter at hver candidate-resolve emitterer en `wiki_event`** med `kind: 'page-created' | 'page-updated' | 'page-deprecated'` så audit-trailen er komplet. Det er allerede gældende — F175 verificerer det og fail-closer hvis event-emission fejler (i dag fejler det stille).

```typescript
const event = await emitWikiEvent({ ... });
if (!event) {
  throw new ProvenanceViolationError('Failed to emit wiki_event — refusing to commit candidate.');
}
```

### `_schema.md`-udvidelse (per-path konfigurerbar)

F140 lader hver path have sit eget `_schema.md`. F175 udvider frontmatter-vocabulariet:

```yaml
---
type: schema
scope: /neurons/concepts/
required_frontmatter_fields: [sources]   # NY i F175
provenance_strict: true                   # NY — fail-closed på unknown ref
---
```

For sub-paths som `/neurons/notes/` eller `/neurons/heuristics/` (F139) kan reglen slækkes:

```yaml
---
type: schema
scope: /neurons/heuristics/
required_frontmatter_fields: []
provenance_strict: false
---
```

Heuristic-Neurons (F139) er per definition decay-ende observationer fra LLM'en, ikke kanoniske facts — de bør IKKE kræve sources. F140-inheritance gør det muligt at have en strict default på `/neurons/concepts/*` og en relaxed override på `/neurons/heuristics/*` uden ekstra arkitektur.

### Migration for eksisterende Neurons

```sql
ALTER TABLE documents ADD COLUMN provenance_status TEXT
  CHECK (provenance_status IN ('verified', 'opinion-piece', 'legacy-unsourced', 'pending-validation'))
  DEFAULT 'pending-validation';
```

Backfill ved migration:

- Hver eksisterende `wiki`-Neuron med non-empty `sources:` frontmatter → `provenance_status = 'verified'`.
- Resten → `provenance_status = 'legacy-unsourced'`.

`legacy-unsourced` er ikke en fejl — det er en honest acknowledgement af at Neuronen blev skabt før F175 landede. UI viser et lille badge i Neuron-reader: "⚠ Legacy-unsourced — predates provenance enforcement". Curator kan vælge at re-citere eller acceptere status quo.

### F97 Activity Log integration

Hvert provenance-violation-event logges i F97 med `event_type: 'provenance-violation'`, `details: { kind, attempted_sources, reason }`. Support kan svare "hvor mange unsourced candidates blev blokeret sidste uge?" i ét opslag.

## Non-Goals

- **Ikke retroaktiv re-validering af eksisterende Neurons.** `legacy-unsourced` står som status quo medmindre curator manuelt re-citerer. Et hypotetisk "audit-all-legacy"-flow er separat feature.
- **Ikke automatisk source-inferer ved write-time.** F90.1 har allerede en `auto-link-sources`-effect der foreslår sources for orphan-Neurons; F175 BLOKKERER orphan-skabelse, men sender candidaten til F90.1's flow som suggestion frem for hard reject. Kobling: når F175 emittterer `missing-provenance-alert`, kan curator klikke "auto-suggest sources" som routes via F90.1.
- **Ikke fact-checking af source-content.** F175 verificerer at `sources:` PEGER på en gyldig reference; det verificerer IKKE at Neuron-body's claims faktisk findes i den source. Det er F32's contradiction-scan + manuel review.
- **Ikke source-tier-validation.** F78 Trust Tiers + Provenance Graph (Idea, Phase 3) håndterer "er denne source tier-1 eller tier-4?". F175 tjekker bare at en source-reference eksisterer.
- **Ikke håndhævelse på `notes/`-stien som default.** Path-baseret per F140 — strict default på `/neurons/concepts/`, `/neurons/entities/`, `/neurons/synthesis/`, `/neurons/comparisons/`. Slack på `/neurons/heuristics/`, `/neurons/sessions/`, `/neurons/notes/`.
- **Ikke schema-validation for body-content.** F140 `_schema.md` har allerede `required_sections`. F175 tilføjer kun frontmatter-validation; body-niveau lever videre i F140.

## Technical Design

### 1. Migration `0030_provenance_status.sql`

```sql
-- Track each Neuron's provenance state
ALTER TABLE documents ADD COLUMN provenance_status TEXT
  CHECK (provenance_status IN ('verified', 'opinion-piece', 'legacy-unsourced', 'pending-validation'))
  DEFAULT 'pending-validation';

-- Backfill: any wiki-Neuron with non-empty sources in metadata is verified
UPDATE documents
SET provenance_status = 'verified'
WHERE kind = 'wiki'
  AND archived = 0
  AND json_extract(metadata, '$.sources') IS NOT NULL
  AND json_array_length(json_extract(metadata, '$.sources')) > 0;

-- Rest of the wiki-Neurons are legacy-unsourced
UPDATE documents
SET provenance_status = 'legacy-unsourced'
WHERE kind = 'wiki'
  AND archived = 0
  AND provenance_status = 'pending-validation';

-- sources are inherently 'verified' (raw layer)
UPDATE documents SET provenance_status = 'verified' WHERE kind = 'source';

-- Index for legacy-cleanup queries
CREATE INDEX idx_documents_provenance ON documents(tenant_id, knowledge_base_id, provenance_status);
```

### 2. Provenance-validator helper

Ny fil `packages/core/src/queue/provenance.ts`:

```typescript
import { documents, knowledgeBases } from '@trail/db';
import type { TrailDatabase } from '@trail/db';

export type ProvenanceStatus = 'verified' | 'opinion-piece' | 'legacy-unsourced' | 'pending-validation';

export type SourceRef =
  | { kind: 'document'; path: string }
  | { kind: 'seq-id'; seqId: string }
  | { kind: 'cc-session'; sessionId: string }
  | { kind: 'cms-id'; key: string }
  | { kind: 'opinion-piece' };

export class ProvenanceViolationError extends Error {
  constructor(
    public reason: 'no-sources' | 'invalid-source-ref' | 'source-not-found' | 'wiki-edit-on-raw' | 'event-emit-failed',
    public details?: Record<string, unknown>,
  ) {
    super(`Provenance violation: ${reason}`);
  }
}

export function parseSourceRef(raw: string): SourceRef {
  if (raw === 'opinion-piece') return { kind: 'opinion-piece' };
  if (raw.startsWith('cc-session:')) return { kind: 'cc-session', sessionId: raw.slice(11) };
  if (raw.startsWith('cms-id:')) return { kind: 'cms-id', key: raw.slice(7) };
  if (/^[a-z]+_\d{8}$/.test(raw)) return { kind: 'seq-id', seqId: raw };
  return { kind: 'document', path: raw };
}

export async function isValidSourceRef(
  trail: TrailDatabase,
  ref: SourceRef,
  kbId: string,
  tenantId: string,
): Promise<boolean> {
  switch (ref.kind) {
    case 'opinion-piece':
      return true; // gated separately
    case 'cc-session':
      return /^[a-f0-9-]{36}$/.test(ref.sessionId);
    case 'cms-id':
      return ref.key.length > 0;
    case 'seq-id': {
      const exists = await trail.db.query.documents.findFirst({
        where: (d, { and, eq }) => and(
          eq(d.tenantId, tenantId),
          eq(d.knowledgeBaseId, kbId),
          eq(d.seqId, ref.seqId),
          eq(d.kind, 'source'),
        ),
      });
      return !!exists;
    }
    case 'document': {
      const exists = await trail.db.query.documents.findFirst({
        where: (d, { and, eq }) => and(
          eq(d.tenantId, tenantId),
          eq(d.knowledgeBaseId, kbId),
          eq(d.path, ref.path),
          eq(d.kind, 'source'),
        ),
      });
      return !!exists;
    }
  }
}

export async function validateProvenance(
  trail: TrailDatabase,
  input: CreateCandidateInput,
  schemaProfile: SchemaProfile,
): Promise<ProvenanceStatus> {
  if (input.kind === 'edit' && input.targetKind === 'source') {
    throw new ProvenanceViolationError('wiki-edit-on-raw');
  }

  if (!schemaProfile.requiredFrontmatterFields?.includes('sources')) {
    return 'pending-validation'; // path doesn't require strict provenance (e.g. heuristics/)
  }

  const sources: string[] = input.frontmatter?.sources ?? [];
  if (sources.length === 0) {
    throw new ProvenanceViolationError('no-sources');
  }

  if (sources.length === 1 && sources[0] === 'opinion-piece') {
    if (!input.confirmedOpinionPiece) {
      throw new ProvenanceViolationError('opinion-piece-requires-explicit-confirm');
    }
    return 'opinion-piece';
  }

  for (const raw of sources) {
    const ref = parseSourceRef(raw);
    if (!await isValidSourceRef(trail, ref, input.kbId, input.tenantId)) {
      throw new ProvenanceViolationError('source-not-found', { ref: raw });
    }
  }

  return 'verified';
}
```

### 3. Integration i `createCandidate`

```typescript
// packages/core/src/queue/candidates.ts
import { validateProvenance, ProvenanceViolationError } from './provenance.js';
import { resolveSchemaChain } from '../schema-inheritance.js';

export async function createCandidate(trail, input) {
  const schemaProfile = await resolveSchemaChain(trail, input.kbId, input.targetPath);

  let provenanceStatus: ProvenanceStatus;
  try {
    provenanceStatus = await validateProvenance(trail, input, schemaProfile);
  } catch (err) {
    if (err instanceof ProvenanceViolationError) {
      // Ikke afvis — emitter en alert-candidate i stedet
      return await emitProvenanceAlert(trail, input, err);
    }
    throw err;
  }

  // ... existing logic (auto-approval, F174 zone, etc.)
  return await trail.db.insert(queueCandidates).values({
    ...existing,
    metadata: JSON.stringify({ ...existing.metadata, provenanceStatus }),
  }).run();
}

async function emitProvenanceAlert(trail, input, err) {
  return await trail.db.insert(queueCandidates).values({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    knowledgeBaseId: input.kbId,
    kind: 'missing-provenance-alert',
    status: 'pending',
    actionZone: 'red', // F174 — red-zone, kræver curator-klik
    title: `Missing provenance: ${err.reason} on candidate "${input.title?.slice(0, 60) ?? 'unnamed'}"`,
    body: input.proposedContent ?? '',
    metadata: JSON.stringify({
      connector: input.connector,
      reason: err.reason,
      details: err.details,
      proposedFrontmatter: input.frontmatter,
      proposedSources: input.frontmatter?.sources ?? [],
    }),
    actions: JSON.stringify([
      { id: 'add-sources', label: 'Tilføj sources og re-submit', effect: 'add-sources' },
      { id: 'auto-suggest-sources', label: 'Auto-suggest sources via F90.1', effect: 'auto-link-sources' },
      { id: 'mark-opinion', label: 'Marker som opinion-piece (sjælden)', effect: 'mark-opinion-piece' },
      { id: 'dismiss', label: 'Afvis (LLM-støj)', effect: 'dismiss' },
    ]),
    autoApproved: false,
  }).run();
}
```

### 4. Schema inheritance update

```typescript
// packages/core/src/schema-inheritance.ts (eksisterer fra F140)

export interface SchemaProfile {
  tone?: string;
  requiredSections?: string[];
  tagsCanonical?: string[];
  requiredFrontmatterFields?: string[];   // NY i F175
  provenanceStrict?: boolean;              // NY i F175
}

// resolveSchemaChain merges nu også requiredFrontmatterFields som union over arven
function mergeSchemas(schemas: SchemaProfile[]): SchemaProfile {
  return {
    // ... existing fields
    requiredFrontmatterFields: union(schemas.map(s => s.requiredFrontmatterFields ?? [])),
    provenanceStrict: schemas.find(s => s.provenanceStrict !== undefined)?.provenanceStrict ?? false,
  };
}
```

### 5. Default `_schema.md` for nye KB'er

KB-creation seeds følgende default schema-files:

```
/neurons/_schema.md                    → required_frontmatter_fields: [sources, type]
/neurons/concepts/_schema.md           → required_frontmatter_fields: [sources, type], provenance_strict: true
/neurons/entities/_schema.md           → required_frontmatter_fields: [sources, type], provenance_strict: true
/neurons/synthesis/_schema.md          → required_frontmatter_fields: [sources, type], provenance_strict: true
/neurons/comparisons/_schema.md        → required_frontmatter_fields: [sources, type], provenance_strict: true
/neurons/heuristics/_schema.md         → required_frontmatter_fields: [], provenance_strict: false
/neurons/notes/_schema.md              → required_frontmatter_fields: [], provenance_strict: false
/neurons/sessions/_schema.md           → required_frontmatter_fields: [], provenance_strict: false
```

Eksisterende KB'er får ikke seedet auto — Christian (eller curator) kan opt-in via `pnpm trail kb seed-default-schemas <kb-slug>`.

### 6. Admin-UI: provenance-badge i Neuron-reader

```tsx
// apps/admin/src/components/neuron-reader.tsx
function ProvenanceBadge({ status }: { status: ProvenanceStatus }) {
  const variants = {
    verified: { color: 'green', icon: '✓', label: 'Verified — sources present' },
    'opinion-piece': { color: 'amber', icon: '✎', label: 'Opinion piece — explicit no-source' },
    'legacy-unsourced': { color: 'gray', icon: '?', label: 'Legacy — predates provenance enforcement' },
    'pending-validation': { color: 'blue', icon: '…', label: 'Pending validation' },
  };
  // ... render badge in reader header
}
```

### 7. Verify-script

`apps/server/scripts/verify-provenance.ts`:

```typescript
// Seeder en kandidat uden sources, asserter at en missing-provenance-alert blev emitteret
// Seeder en kandidat med invalid source-ref, asserter samme
// Seeder en kandidat med valid sources, asserter at den approves med provenanceStatus: 'verified'
// Seeder en edit-candidate på en source-Neuron, asserter ProvenanceViolationError thrown
```

## Interface

### Schema-syntax

```yaml
# /neurons/concepts/_schema.md
---
type: schema
scope: /neurons/concepts/
required_frontmatter_fields: [sources, type]
provenance_strict: true
---
```

### Candidate POST-shape

```typescript
POST /api/v1/queue/candidates
{
  kind: 'create',
  targetPath: '/neurons/concepts/akupunktur/nada.md',
  frontmatter: {
    title: 'NADA-akupunktur',
    type: 'concept',
    sources: ['sources/sanne-bog-kapitel-3.md', 'sanne_00000042'],
    tags: ['akupunktur', 'behandling'],
  },
  content: '...',
  // optional, only required for opinion-piece
  confirmedOpinionPiece?: false,
}
```

### Provenance-alert response

Ved violation, queue returnerer:
```json
{
  "candidate": {
    "id": "...",
    "kind": "missing-provenance-alert",
    "actionZone": "red",
    "metadata": {
      "reason": "no-sources",
      "proposedFrontmatter": { ... },
      "proposedSources": []
    },
    "actions": [...]
  }
}
```

## Rollout

**Phase 1 — Migration + helper (0.5 dag).** `0030_provenance_status.sql` + backfill. `provenance.ts` helper landed. Ingen runtime-blocking endnu — kun status-tagging på existing.

**Phase 2 — Validation in createCandidate (0.5 dag).** Kør validation, men i "warn-mode": log violations, emit alert-candidate, MEN tillad samtidig den oprindelige candidate at gå igennem. Christian kan inspicere alert-volume + verify intet legitimt blokeres.

**Phase 3 — Strict mode flip (0.25 dag).** Efter 1 uge i warn-mode, flip til strict: candidates der fejler validation IKKE-approves; kun alert-candidaten persisteres. Eksisterende `legacy-unsourced` Neurons uændret.

**Phase 4 — Admin UI badges + seed-default-schemas command (0.5 dag).** Provenance-badge i Neuron-reader, "Legacy-unsourced"-filter i Neurons-listing, CLI-command til at seede default `_schema.md`-filer i nye KB'er.

**Total effort:** Small-Medium 1-2 dage.

## Success Criteria

- En candidate med `frontmatter.sources = []` på en strict-path (concepts/) emitterer `missing-provenance-alert` og IKKE-approves.
- En candidate med `frontmatter.sources = ['nonexistent-path.md']` emitterer `missing-provenance-alert` med `reason: 'source-not-found'`.
- En candidate med `frontmatter.sources = ['sources/real-file.md']` på en strict-path approves med `metadata.provenanceStatus = 'verified'`.
- En candidate på `/neurons/heuristics/...` med tom `sources:` approves uden alert (relaxed-path).
- En `edit`-candidate med `targetKind = 'source'` afvises med `ProvenanceViolationError`.
- Alle eksisterende Neurons har `provenance_status` populeret efter migration.
- F97 Activity Log indeholder `provenance-violation`-events for alle alerts.
- F156 credits brændes IKKE for kandidater der fejler provenance-validation før compile.

## Impact Analysis

### Files created

- `packages/core/src/queue/provenance.ts` — validator, parsers, error types
- `packages/core/src/queue/migrations/0030_provenance_status.sql`
- `apps/server/scripts/verify-provenance.ts` — end-to-end verify-script
- `apps/admin/src/components/provenance-badge.tsx`
- `scripts/seed-default-schemas.ts` (or `pnpm trail kb seed-default-schemas`)

### Files modified

- `packages/core/src/queue/candidates.ts` — `createCandidate` kalder `validateProvenance`
- `packages/core/src/schema-inheritance.ts` — `SchemaProfile.requiredFrontmatterFields` + `.provenanceStrict`
- `packages/db/src/schema.ts` — `documents.provenanceStatus` kolonne
- `packages/shared/src/schemas.ts` — `ProvenanceStatus`-type, `CreateCandidateSchema` får optional `confirmedOpinionPiece`
- `apps/admin/src/components/neuron-reader.tsx` — render badge i header
- `apps/admin/src/panels/neurons.tsx` — provenance-status-filter

### Blast radius

- **Pipelines (F08/F09/F24/F25/F47) der genererer source-documents** — uændrede; kind='source' får automatisk `provenance_status = 'verified'`.
- **Ingest-pipeline (F06) der genererer wiki-candidates** — KAN nu fejle hvis ingest-prompten ikke instruerer LLM'en at fylde `sources:` korrekt. Phase 2 warn-mode finder problemerne FØR Phase 3 strict-mode breaker noget.
- **F39 cc-session ingest** — buddy `trail_save` POSTer i dag som `external-feed` med metadata.connector. F175 kræver at posts inkluderer `sources: ['cc-session:<uuid>']` i frontmatter. Buddy-side ændring skal koordineres.
- **F124 CMS-sync endpoint** — kræver at CMS-poster sender `sources: ['cms-id:<key>']`. Ny constraint på CMS-connector-API; F127 SDK opdateres.

### Breaking changes

Phase 3 strict-mode er teknisk en breaking change for ingest-pipelines der ikke fyldte `sources:` korrekt. Phase 2 warn-mode-vinduet er specifikt designet til at finde + fikse de pipelines først.

### Test plan

- [ ] `pnpm typecheck` clean
- [ ] Unit: `parseSourceRef` returnerer korrekt diskrimineret union for hver ref-type
- [ ] Unit: `isValidSourceRef` slår korrekt op i DB for document/seq-id refs
- [ ] Unit: `validateProvenance` thrower på no-sources/invalid-source-ref/wiki-edit-on-raw
- [ ] Unit: `validateProvenance` returnerer 'pending-validation' for relaxed paths
- [ ] Integration: kandidat på strict-path UDEN sources → alert-candidat oprettet, original blokeret
- [ ] Integration: kandidat på strict-path MED valid sources → approved, status 'verified'
- [ ] Integration: kandidat på heuristics/ uden sources → approved, status 'pending-validation'
- [ ] Integration: edit-candidat på source-Neuron → afvist
- [ ] Migration: backfill korrekt status for eksisterende Neurons
- [ ] E2E: real ingest af PDF kører igennem F08, candidate har `sources: [<source-doc-path>]`, validation passes
- [ ] Verify-script: `bun run apps/server/scripts/verify-provenance.ts` grøn

## Implementation Steps

1. Migration `0030_provenance_status.sql` + drizzle schema-update.
2. Skriv `packages/core/src/queue/provenance.ts` — types, parsers, validator, error class.
3. Patch `packages/core/src/schema-inheritance.ts` — udvid `SchemaProfile`-interface, opdater `mergeSchemas` til at union'e `requiredFrontmatterFields`.
4. Patch `createCandidate` — kald `validateProvenance`, emit alert ved error.
5. Verify-script: `apps/server/scripts/verify-provenance.ts` der seeder candidates i alle scenarier og asserter outcomes.
6. Phase 2 warn-mode flag: `TRAIL_PROVENANCE_MODE=warn|strict` env-var. Default `warn` første uge.
7. Admin UI: provenance-badge i reader, status-filter i Neurons-panel.
8. CLI-command `seed-default-schemas` der opretter default `_schema.md`-filer i en KB.
9. Buddy-coordination: opdater buddy's `trail_save` mod til at sende `sources: ['cc-session:<uuid>']`.
10. F124 CMS-sync: opdater connector-spec til at kræve `sources: ['cms-id:<key>']`.
11. Phase 3 flip: `TRAIL_PROVENANCE_MODE=strict` efter 7 dages warn-soak.

## Dependencies

- **F140 Hierarchical Context Inheritance** ✅ — `_schema.md`-arkitekturen som F175 bygger ovenpå.
- **F15 Bidirectional document_references** ✅ — eksisterende provenance-tracking, F175 supplerer på frontmatter-niveau.
- **F95 Connectors** ✅ — connector-attribution kobles med provenance-validation.
- **F97 Activity Log** (in progress) — `provenance-violation`-events logges her.
- **F174 Action-Zone Governance** (sister-feature) — `missing-provenance-alert` er per definition red-zone.
- **F90.1 Auto-link-sources effect** ✅ — fallback fra missing-provenance-alert til auto-suggest sources.
- **F39 cc-session ingest** ✅ — buddy `trail_save` skal opdateres til at sende `cc-session:`-source-format.
- **F124 CMS Content-Sync Endpoint** (Planned) — CMS-poster skal sende `cms-id:`-source-format.

## Open Questions

- **Skal strict-mode default være ON for nye KB'er fra dag 1?** Forslag: ja for `concepts/`, `entities/`, `synthesis/`, `comparisons/`. Slack på `notes/`, `heuristics/`, `sessions/`.
- **Hvor meget legacy-data har Sanne's KB i dag der skal migrate'es?** Kør Phase 1 migration på snapshot, count `legacy-unsourced` rows, plan opt-in re-citation flow hvis tallet er højt.
- **Skal `auto-link-sources` (F90.1) auto-køres når validation fejler med no-sources?** Forslag: ja, men kun som suggestion-step — kandidat lander i alert med en pre-fyldt forslagsliste fra F90.1, curator klikker "accepter forslag" eller "rediger" eller "afvis".
- **Cross-KB sources (F23 `[[kb:other]]`)** — skal en concept-Neuron i KB-A kunne cite en source i KB-B? Forslag: ja, men kun hvis curator har read-access til begge KB'er. F175 phase 1 håndhæver kun same-KB; cross-KB sources accepteres som "external" indtil F38 cross-trail er live.

## Related Features

- **F140** — schema-inheritance fundamentet
- **F174** — sister-feature, alle missing-provenance-alerts er red-zone
- **F90.1** — auto-link-sources fallback ved violations
- **F32** — contradiction-lint kører på allerede-validated Neurons
- **F148** — link-integrity dækker URLs; F175 dækker source-provenance
- **F156** — credits brændes ikke for failed-validation candidates
- **F78** — Trust Tiers (Phase 3) bygger ovenpå F175's provenance-fundament

## Effort Estimate

**Small-Medium — 1-2 dage** fordelt over 4 phases:

- Phase 1 migration + helper: 0.5 dag
- Phase 2 warn-mode validation: 0.5 dag
- Phase 3 strict flip: 0.25 dag (config + monitoring)
- Phase 4 admin UI badges + CLI seed: 0.5 dag

Inkluderer typecheck, unit-tests, verify-script, end-to-end real-ingest test.

## Inspiration

Shuyi Wang, "Should You Actually Try Karpathy's LLM Wiki?" (2026-04-16, Medium, 27 min read). Specifikt s. 27-28 "Pitfall 3 — Hallucinations have to be blocked at the schema layer":

> "The LLM doesn't just hallucinate in its answers — it'll write hallucinations into the wiki, and once they're in there, they become 'history,' and downstream queries will cite them as fact. The contamination spreads. Governing this can't wait until the wiki is built — you have to lay down rules at the schema layer from day one."
>
> "These few rules baked into the SCHEMA and default behavior put three locks on the LLM — without raw evidence, you can't fill in the `sources:` field; without filling in `sources:`, you can't pass the page template's acceptance check. If you don't lay down these three, sooner or later the LLM will toss off a sentence that sounds reasonable but actually has no source, and the next time you query, you'll step on a mine."

F175 oversætter denne tre-låse-disciplin til Trail's eksisterende F140 schema-arkitektur og F17 queue-arkitektur uden at bryde nogen af de eksisterende hjørnesten.
