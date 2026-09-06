// Curation queue — the sole write path into wiki documents.
export {
  createCandidate,
  resolveCandidate,
  reopenCandidate,
  listCandidates,
  listCandidatePage,
  InvalidCursorError,
  countCandidates,
  getCandidate,
  resolveActions,
  persistActionTranslation,
  persistCandidateTranslation,
  submitCuratorEdit,
  VersionConflictError,
  DuplicateExternalFeedError,
  DEFAULT_ACTIONS,
  setCandidatePushNotifier,
} from './queue/candidates.js';
export type {
  Actor,
  ResolutionResult,
  CandidateOp,
  CandidatePushNotifier,
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
  stripClaimAnchors,
  ensureTypeFrontmatter,
  prepareCompiledMarkdown,
} from './compile/claim-anchors.js';
export { kbSizes, toMB, type KbSize, type FileProbe } from './kb-size.js';

// F253.1 — hændelses-loggens dækning (forudsætningen for tilbagerulning).
export { auditEventLogCoverage, repairEventLogCoverage } from './history/coverage.js';
export type { CoverageReport, CoverageGap } from './history/coverage.js';

// F253.2 + F253.3 — hjerne-versioner og tilbagerulning.
export { takeBrainVersion, listBrainVersions, getBrainVersion, ensureRecentBrainVersion } from './history/versions.js';
export type { BrainVersion, BrainVersionReason } from './history/versions.js';
export { diffBrainVersion, restoreBrainVersion } from './history/restore.js';
export type { RestoreDiff, RestoreChange, RestoreResult } from './history/restore.js';

// F254 — hybrid genfinding: vektorer + fusion. Kompilering og Neuroner urørt.
export {
  encodeVector, decodeVector, cosine, contentHash,
  storeEmbedding, coverage, loadVectors,
  EMBEDDING_PROVIDER, EMBEDDING_MODEL,
} from './retrieval/vectors.js';
export type { EmbeddingRow } from './retrieval/vectors.js';
export { reciprocalRankFusion, RRF_K } from './retrieval/fusion.js';
export type { Ranked, FusedHit } from './retrieval/fusion.js';
export * from './queue/neuron-name.js';
