/**
 * F201.1 — candidate assembly + POST client.
 *
 * The ONE place ambient text is turned into a Trail queue candidate.
 * Redaction runs HERE, on the final assembled title+content, via
 * @broberg/secret-scan re-exported from @trail/shared — the fleet's single
 * canonical detector (F197). No local pattern list exists in this package;
 * new ambient-specific patterns go INTO @broberg/secret-scan (components).
 *
 * Because assembly and redaction are fused, a secret can never reach the
 * outgoing POST body — the candidate.test.ts invariant test locks this in.
 */

import { redactSecrets, type RedactionFinding } from '@trail/shared';

export const AMBIENT_CONNECTOR = 'trail-ambient-capture';

export interface AmbientCandidateInput {
  /** KB slug or UUID (the engine resolves both, F135). */
  kb: string;
  title: string;
  content: string;
  /** 'external-feed' (default) or 'user-correction' for supersedes. */
  kind?: 'external-feed' | 'user-correction';
  /** App/window/call reference, e.g. "app://Safari/Acme CRM — Deal 123". */
  sourceUrl?: string;
  /** ISO timestamp of capture. */
  capturedAt?: string;
  /** Gate confidence 0..1 — feeds Trail's auto-approval policy (F201.8). */
  confidence?: number;
}

export interface CandidateBody {
  knowledgeBaseId: string;
  kind: 'external-feed' | 'user-correction';
  title: string;
  content: string;
  metadata: string;
  confidence?: number;
}

export interface AssembledCandidate {
  body: CandidateBody;
  /** What redaction removed (empty = clean). Log locally, never persist raw. */
  redactionFindings: RedactionFinding[];
}

export function buildCandidateBody(input: AmbientCandidateInput): AssembledCandidate {
  const title = redactSecrets(input.title);
  const content = redactSecrets(input.content);
  const metadata = JSON.stringify({
    connector: AMBIENT_CONNECTOR,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}),
  });
  return {
    body: {
      knowledgeBaseId: input.kb,
      kind: input.kind ?? 'external-feed',
      title: title.redacted,
      content: content.redacted,
      metadata,
      ...(input.confidence != null ? { confidence: input.confidence } : {}),
    },
    redactionFindings: [...title.findings, ...content.findings],
  };
}

export interface PostCandidateOptions {
  /** Engine base, e.g. https://app.trailmem.com or http://127.0.0.1:7474 */
  apiBase: string;
  /** trail_ bearer token (from the F201.2 device-auth flow). */
  token: string;
  /** Injectable for tests/in-process probes; defaults to global fetch. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface PostCandidateResult {
  ok: boolean;
  status: number;
  candidateId?: string;
  /** 409 = engine-side external-feed de-dup — expected under re-capture. */
  duplicate?: boolean;
  error?: string;
  redactionFindings: RedactionFinding[];
}

export async function postCandidate(
  input: AmbientCandidateInput,
  opts: PostCandidateOptions,
): Promise<PostCandidateResult> {
  const { body, redactionFindings } = buildCandidateBody(input);
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.apiBase.replace(/\/$/, '')}/api/v1/queue/candidates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as
    | { candidate?: { id?: string }; error?: unknown }
    | null;
  if (res.status === 201) {
    return { ok: true, status: res.status, candidateId: json?.candidate?.id, redactionFindings };
  }
  return {
    ok: false,
    status: res.status,
    duplicate: res.status === 409,
    error: typeof json?.error === 'string' ? json.error : JSON.stringify(json?.error ?? 'unknown'),
    redactionFindings,
  };
}
