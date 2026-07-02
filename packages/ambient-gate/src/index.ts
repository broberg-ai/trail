/**
 * @trail/ambient-gate — F201 layer 2a: the on-device gate between raw
 * ambient capture (Swift agent, F201.3+) and Trail's curation queue.
 *
 * Pipeline: scoreChunk → shouldEmit → routeKb → postCandidate.
 * Only gated, redacted TEXT ever leaves the machine (F201 privacy rule).
 */

export {
  scoreChunk,
  shouldEmit,
  DEFAULT_GATE_THRESHOLD,
  type GateScore,
  type GateSignal,
} from './gate.js';

export {
  classifyChunk,
  routeKb,
  type RouteClass,
  type RoutingConfig,
} from './routing.js';

export {
  AMBIENT_CONNECTOR,
  buildCandidateBody,
  postCandidate,
  type AmbientCandidateInput,
  type AssembledCandidate,
  type CandidateBody,
  type PostCandidateOptions,
  type PostCandidateResult,
} from './candidate.js';

export {
  windowEvents,
  summarizeWindow,
  DEFAULT_WINDOW_OPTIONS,
  type RelayEvent,
  type WindowOptions,
  type WindowSummary,
} from './session-window.js';

export { isDenyListed, DENY_LIST } from './relay.js';
