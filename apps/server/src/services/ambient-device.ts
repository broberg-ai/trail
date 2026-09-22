/**
 * F201.10 — hvilken ENHED en ambient-kandidat kom fra.
 *
 * To brugere på hver sin Mac skriver i samme delte Brain. Uden en afsender pr.
 * enhed er deres kandidater umulige at skelne i køen, og en kurator kan ikke se
 * hvis optagelse der sagde hvad.
 *
 * AFSENDEREN KOMMER FRA NØGLEN, ALDRIG FRA KROPPEN. Serveren ved hvilken nøgle
 * der godkendte kaldet — det har auth-laget lige slået op. Klienten kan skrive
 * hvad den vil i `metadata`, så et `device`-felt fra klienten er en påstand,
 * ikke en kendsgerning. Derfor OVERSKRIVES det altid: en enhed der udgiver sig
 * for at være en anden, lander stadig under sit eget navn.
 */

export interface AmbientDevice {
  /** Nøglens id — stabilt, også hvis to enheder har samme navn. */
  keyId: string;
  /** Det menneskelige navn, som brugeren så det ved forbindelsen. */
  name: string;
}

/**
 * Enhedsnavnet ud af en ambient-nøgles navn.
 *
 * Device-auth (routes/ambient.ts) mønter nøglen som `ambient:<enhed>:<id8>`.
 * Enhedsnavnet kan selv indeholde kolon («Christians MacBook: Pro»), så vi
 * skræller præfiks og hale af i stedet for at splitte på kolon.
 *
 * En ambient-nøgle mintet over API-key-ruten har et frit navn («helpdesk») og
 * ingen af delene — så returneres navnet som det er.
 */
export function deviceNameFromKeyName(keyName: string): string {
  let n = keyName;
  if (n.startsWith('ambient:')) n = n.slice('ambient:'.length);
  n = n.replace(/:[0-9a-f]{8}$/i, '');
  return n.trim() || keyName;
}

/**
 * Læg `device` ind i kandidatens metadata — og overskriv hvad klienten påstod.
 *
 * Er metadata ikke et JSON-objekt, rører vi den ikke: der er intet sted at
 * lægge feltet uden at kaste klientens egne felter væk, og en stille
 * omskrivning af formen er værre end en manglende afsender. Kalderen får
 * `stamped: false` og kan logge det.
 */
export function stampAmbientDevice(
  metadata: string | null | undefined,
  device: AmbientDevice,
): { metadata: string; stamped: boolean } {
  if (metadata == null || metadata.trim() === '') {
    return { metadata: JSON.stringify({ device }), stamped: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return { metadata, stamped: false };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { metadata, stamped: false };
  }
  return {
    metadata: JSON.stringify({ ...(parsed as Record<string, unknown>), device }),
    stamped: true,
  };
}
