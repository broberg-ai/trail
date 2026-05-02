// Curation queue — the sole write path into wiki documents.
export {
  createCandidate,
  resolveCandidate,
  reopenCandidate,
  listCandidates,
  countCandidates,
  getCandidate,
  resolveActions,
  persistActionTranslation,
  persistCandidateTranslation,
  submitCuratorEdit,
  VersionConflictError,
  DuplicateExternalFeedError,
  DEFAULT_ACTIONS,
} from './queue/candidates.js';
export type {
  Actor,
  ResolutionResult,
  CandidateOp,
} from './queue/candidates.js';
export { shouldAutoApprove } from './queue/policy.js';

// Lint pass (F32) — orphans, stale, contradictions, faded heuristics (F139).
export {
  runLint,
  detectOrphans,
  detectStale,
  detectContradictions,
  detectFadedHeuristics,
} from './lint/index.js';
export { DEFAULT_HUB_PAGES } from './lint/orphans.js';
export type {
  LintFinding,
  LintOptions,
  LintReport,
  LintEmitCallback,
  ContradictionCandidate,
  ContradictionChecker,
  LlmContradictionResult,
  NewNeuron,
} from './lint/index.js';

// F140 — hierarchical schema inheritance (compile-prompt per wiki-path).
export {
  resolveSchemaChain,
  renderSchemaForPrompt,
  parseSchemaNeuron,
} from './schema-inheritance.js';
export type { SchemaProfile, SchemaNeuronRow } from './schema-inheritance.js';

// Utilities
export { slugify, uniqueSlug } from './slug.js';
export { resolveKbId, looksLikeUuid } from './kb/resolve.js';

// F149 — CandidateQueueAPI: shared in-process surface the MCP server
// and OpenRouterBackend both use for search/read/write/guide against a
// KB. Returns structured data; callers (MCP stdio, OpenAI tool-call
// dispatch) format it into their own wire shape.
export {
  createCandidateQueueAPI,
  guide as ingestGuide,
  search as ingestSearch,
  read as ingestRead,
  write as ingestWrite,
} from './ingest/candidate-api.js';
export type {
  CandidateQueueAPI,
  CandidateQueueContext,
  GuideResult,
  GuideKb,
  SearchArgs,
  SearchResult,
  SearchDocListHit,
  SearchDocFtsHit,
  SearchChunk,
  ReadArgs,
  ReadResult,
  ReadDocHit,
  WriteArgs,
  WriteResult,
} from './ingest/candidate-api.js';

// F97 — Activity Log helper.
export { logActivity } from './activity.js';
export type {
  ActivityKind,
  ActivitySubjectType,
  ActivityActorKind,
  LogActivityInput,
} from './activity.js';

// F22 + F101 — claim-anchors + type-frontmatter post-LLM compile transforms.
export {
  generateClaimAnchor,
  injectClaimAnchors,
  extractClaimAnchors,
  ensureTypeFrontmatter,
  prepareCompiledMarkdown,
} from './compile/claim-anchors.js';
