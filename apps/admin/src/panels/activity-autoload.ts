/**
 * F273.4 — beslutningen bag auto-hentningen i Activity, som en ren funktion.
 *
 * Den ligger for sig selv fordi den er en SPÆRRE, og en spærre der kun findes
 * inde i en komponent kan ikke bevises rød. Hele fejlen den findes for er
 * usynlig fra skærmen: listen ville blive ved med at hente side efter side
 * uden at der kom noget frem, og det ligner «den arbejder», ikke «den kører
 * løbsk».
 *
 * Grunden til at den overhovedet kan ske: gruppe-filteret sorterer fra i
 * BROWSEREN, ikke i motoren. En side kan derfor lande med 50 rækker hvoraf 0
 * slipper igennem — og så bliver vagtposten nederst stående i billedet og
 * beder om den næste.
 */

/** Hvor mange sider i træk uden én eneste SYNLIG række der accepteres. */
export const MAX_GOLDE_RUNDER = 5;

/**
 * Hvad blev en hentet side til, og skal auto-hentningen fortsætte?
 *
 * `groupKinds` er de hændelsestyper det valgte gruppe-filter slipper igennem,
 * eller `null` når der ikke er valgt noget filter. Bemærk at der tælles
 * SYNLIGE rækker, ikke hentede — «kom der rækker» og «kom der rækker man kan
 * se» er ikke det samme spørgsmål, og det er præcis dér forskellen mellem at
 * hente videre og at køre løbsk ligger.
 */
export function naesteAutoTilstand(input: {
  items: ReadonlyArray<{ kind: string }>;
  groupKinds: readonly string[] | null;
  goldeFoer: number;
}): { golde: number; stop: boolean } {
  const synlige = input.groupKinds
    ? input.items.filter((r) => input.groupKinds!.includes(r.kind)).length
    : input.items.length;

  if (synlige > 0) return { golde: 0, stop: false };

  const golde = input.goldeFoer + 1;
  return { golde, stop: golde >= MAX_GOLDE_RUNDER };
}
