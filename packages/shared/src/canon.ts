/**
 * F275.2 — the TWO switches: "a new edition of the same source automatically
 * becomes canon".
 *
 * The owner, 16 September 2026, verbatim: *"It sounds really smart that there is
 * one on a brain and one on a connector. We set both default on, so the same
 * source with new innards becomes the new canon."*
 *
 * ## Why two and not one
 *
 * A Brain such as CB-M1 receives BOTH website sync AND manual uploads. One choice
 * for the whole brain would necessarily be wrong for one of them: an edited page
 * is always a new edition, while an upload may just as well be an ADDITION. So
 * the Brain switch is the master switch and the connector switch is the precise
 * one.
 *
 * ## The hierarchy is unambiguous, and it only runs one way
 *
 *   Brain OFF  ⇒  no connector supersedes, whatever its own switch says.
 *   Brain ON   ⇒  the connector's own switch decides.
 *
 * That is why the resolver returns a REASON rather than a bare yes/no: a
 * connector switch that reads ON while being overridden by the Brain switch MUST
 * be visible as exactly that in the product. A switch that looks active without
 * working is worse than no switch — the user believes they turned something on.
 *
 * ## Absence means ON, not "unknown"
 *
 * We store the DISABLED connectors, not the enabled ones. That is the only way a
 * connector never seen before is automatically ON — as the owner decided —
 * without anyone having to remember to create a row for it. Store the enabled
 * ones and a fresh connector would be OFF until someone touched it, and nobody
 * would be able to see why.
 *
 * Note this is a DIFFERENT third state from the one in `source-identity.ts`:
 * there, `null` means "we do not know which source this is", and the doubt falls
 * out as a CONTRADICTION. Here there is no doubt — the owner settled the default,
 * and absence IS the default.
 */

/** Why a new edition supersedes — or does not. */
export type CanonReason = 'on' | 'brain-off' | 'connector-off';

export interface CanonSwitches {
  /** The master switch on the Brain. Defaults to `true`. */
  brain: boolean;
  /** Connector ids switched OFF in this Brain specifically. Every other is ON. */
  disabledConnectors: string[];
}

export interface CanonVerdict {
  canon: boolean;
  reason: CanonReason;
}

/**
 * Read the `canon_off_connectors` column (a JSON list) back into an array.
 *
 * If parsing fails, or the content is not a list of strings, we return an EMPTY
 * list — that is, "nothing is disabled", which is the default state. This is
 * deliberate: a corrupted value must never be able to DISABLE something silently.
 * The wrong direction to fail in would be treating nonsense as "everything is
 * off".
 */
export function readDisabledConnectors(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

/** Write the list back. An empty list is stored as `null` so an untouched Brain stays clean. */
export function writeDisabledConnectors(ids: string[]): string | null {
  const clean = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.trim().length > 0))).sort();
  return clean.length === 0 ? null : JSON.stringify(clean);
}

/**
 * Decide whether a new edition from `connector` should supersede the previous one
 * in this Brain.
 *
 * `connector` may be `null` — 4 of broberg.ai's 70 raw sources carry none. Then
 * the Brain switch decides alone. That is the safe choice: an unknown connector
 * never gets its own hidden exception, it follows the master switch.
 */
export function newEditionIsCanon(
  switches: CanonSwitches,
  connector: string | null | undefined,
): CanonVerdict {
  if (!switches.brain) return { canon: false, reason: 'brain-off' };
  const id = (connector ?? '').trim();
  if (id && switches.disabledConnectors.includes(id)) {
    return { canon: false, reason: 'connector-off' };
  }
  return { canon: true, reason: 'on' };
}

/**
 * What the UI should show for ONE connector row.
 *
 * `overriddenByBrain` is the whole reason this function exists rather than the UI
 * working it out itself: the switch reads ON, and it still has no effect. If the
 * panel derived that on its own, the two could end up disagreeing — and the
 * disagreement would surface as a switch that lies.
 */
export function connectorState(
  switches: CanonSwitches,
  connector: string,
): { ownSwitch: boolean; overriddenByBrain: boolean; effective: boolean } {
  const ownSwitch = !switches.disabledConnectors.includes(connector);
  return {
    ownSwitch,
    overriddenByBrain: ownSwitch && !switches.brain,
    effective: newEditionIsCanon(switches, connector).canon,
  };
}

/**
 * F275.5 — the caveat that follows a page whose source got a new edition.
 *
 * The text lives in ONE place because it goes into two contexts — the answer
 * context for chat and the retrieval API for third parties — and because it is a
 * CLAIM about how reliable the page is right now. Two wordings would sooner or
 * later disagree about how strong the caveat was.
 *
 * It says what happened and what it means, not that the page is wrong: a page
 * whose source was edited is usually still the most accurate thing we have. It
 * has simply not been reviewed since.
 *
 * The returned string is shown to end users, so it stays Danish.
 */
export function sourceChangedCaveat(at: number | null | undefined): string | null {
  if (!at) return null;
  const date = new Date(at).toLocaleDateString('da-DK', {
    day: 'numeric',
    month: 'long',
    // The server runs UTC. Without the zone NAME, a change at 00:30 Danish time
    // would be written as the previous day — and only in the window nobody looks.
    timeZone: 'Europe/Copenhagen',
  });
  return (
    `⚠️ Kilden bag denne side fik en ny udgave den ${date}, og siden er ikke skrevet om siden. ` +
    `Behandl indholdet som muligvis forældet og sig det videre — svar aldrig som om det er bekræftet mod den nyeste kilde.`
  );
}
