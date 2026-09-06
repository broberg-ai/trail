/**
 * F160 — audience-aware filtering for retrieval endpoints.
 *
 * Trail eksponerer KB-content i tre lag (retrieval / knowledge-prose /
 * render-ready). Hvert lag har en orthogonal audience-akse der styrer
 * hvilke Neurons der må returneres og — for chat-lagene — hvordan
 * prosa-tonen skal formes:
 *
 *   - curator: admin-curator (fagperson). Alt er synligt incl.
 *              heuristik-Neurons og internal-tagged docs.
 *   - tool:    site-LLM-orchestrator. Heuristics + internal-tagged
 *              docs filtreres væk — orchestratoren skal ikke se Trail's
 *              egne self-improvement notes når den hjælper en kunde.
 *   - public:  slutbruger-vendt. Samme som tool i v1 (filter er
 *              identisk); divergens lever på chat-prompt-template-niveau.
 *
 * Default-audience pickes baseret på `authType` (set af auth-middleware):
 * Bearer-keys defaulter til `tool` (det safe valg for external integrations);
 * session-cookie (admin-UI) defaulter til `curator`.
 */

import { HEURISTIC_PATH } from '@trail/shared';

export type Audience = 'curator' | 'tool' | 'public';

export const AUDIENCE_VALUES: ReadonlyArray<Audience> = ['curator', 'tool', 'public'];

/**
 * Parse and validate the audience query/body param. Returns null when
 * caller didn't supply one, an invalid value when they sent garbage
 * (caller decides whether to 400 or fall back to a default).
 */
export function parseAudienceParam(raw: string | undefined | null): Audience | null {
  if (!raw) return null;
  if ((AUDIENCE_VALUES as ReadonlyArray<string>).includes(raw)) return raw as Audience;
  return null;
}

/**
 * Default audience based on how the request was authenticated.
 * Bearer = external = `tool`; session-cookie = admin-UI = `curator`.
 * Used when the caller didn't explicitly pass an audience param.
 */
export function defaultAudienceForAuth(authType: 'bearer' | 'session' | undefined): Audience {
  return authType === 'bearer' ? 'tool' : 'curator';
}

/**
 * Should a Neuron with this `path` and `tags` (raw comma-separated
 * string from documents.tags) be visible to the given audience?
 *
 * curator: always true.
 * tool/public: false if path is under /neurons/heuristics/ OR tags
 *              contain 'internal'. The heuristics check uses the same
 *              HEURISTIC_PATH constant the runtime decay logic does
 *              (F139), so we can never drift apart.
 */
export function isVisibleToAudience(
  audience: Audience,
  path: string,
  tags: string | null,
): boolean {
  if (audience === 'curator') return true;
  if (path.startsWith(HEURISTIC_PATH)) return false;
  if (tags) {
    const normalised = tags.toLowerCase().split(',').map((t) => t.trim());
    if (normalised.includes('internal')) return false;
  }
  return true;
}

/**
 * F255 — DET EFFEKTIVE PUBLIKUM. Kalderen må INDSNÆVRE, aldrig UDVIDE.
 *
 * MÅLT I PRODUKTION 6/9 2026, samme bearer-nøgle, samme søgning, samme minut:
 *
 *   mål: /neurons/heuristics/trail.md — skjult for 'tool' pr. design
 *     standard (ingen parameter)  → heuristik-dokument i svaret:  nej
 *     ?audience=tool              → heuristik-dokument i svaret:  nej
 *     ?audience=curator           → heuristik-dokument i svaret:  JA
 *
 * De to første linjer er kontrollen: filteret VIRKER. Den tredje er fejlen:
 * kalderen kunne slukke det.
 *
 * ÅRSAGEN VAR ÉN OPERATOR. Kaldestederne skrev
 *
 *     parseAudienceParam(raw) ?? defaultAudienceForAuth(authType)
 *
 * og `defaultAudienceForAuth` er det ENESTE sted der ved hvem kalderen er. Med
 * `??` kører den kun når kalderen intet har sagt — altså blev autentificeringen
 * sprunget over præcis når nogen bad om mere end de måtte. Det læser som «brug
 * standarden hvis intet er angivet» og betyder «kalderens ønske vinder».
 *
 * Samme fejlform som resten af døgnet, nu i en spærre: EN MANGLENDE VÆRDI
 * DEGRADERER TAVST TIL DET MEST GENERØSE UDFALD. Ingen fejl, ingen log, intet
 * der ser forkert ud — svaret er bare større.
 *
 * Parameteren beholdes, for indsnævring er en ægte funktion: en kurator i admin
 * vil kunne se HVAD EN EKSTERN KALDER SER uden at logge ud og hente en nøgle.
 *
 *                 ønsket: tool      ønsket: curator
 *   session       tool (lovlig)     curator
 *   bearer        tool              tool   ← afvist eskalering
 *
 * INGEN 4xx VED ESKALERING. Anmodningen betjenes med den snævre visning. En
 * fejlkode ville lække at der ER noget mere at se.
 */

/** Hvor meget hvert publikum må se. Højere tal = bredere adgang. */
const BREDDE: Record<Audience, number> = { public: 0, tool: 0, curator: 1 };

export function effectiveAudience(
  authType: 'bearer' | 'session' | undefined,
  requested: string | undefined | null,
): Audience {
  const loft = defaultAudienceForAuth(authType);
  const ønsket = parseAudienceParam(requested);
  if (!ønsket) return loft;
  // Er ønsket bredere end loftet, vinder loftet. Ellers kalderens ønske —
  // `public` og `tool` filtrerer ens i dag, men er forskellige på
  // chat-prompt-niveau, så et ønske MELLEM dem må ikke omskrives.
  return BREDDE[ønsket] > BREDDE[loft] ? loft : ønsket;
}
