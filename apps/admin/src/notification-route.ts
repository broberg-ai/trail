/**
 * F263.10 — filteret der afgør om en adresse fra en push-nyttelast må følges.
 *
 * Adressen kommer udefra: den står i notifikationens data, og en router der
 * følger den blindt er en åben dør. Filteret bor i sin egen fil af én grund —
 * det er en sikkerhedskontrol, og en kontrol ingen kan prøve af er ingen
 * kontrol. Inde i komponenten kunne den ikke importeres af en test.
 *
 * `//andet-sted.dk` er den der plejer at slippe forbi: den STARTER med «/» og
 * er alligevel en absolut adresse til et fremmed domæne.
 */
export function erAppSti(navigate: unknown): navigate is string {
  return (
    typeof navigate === 'string' &&
    navigate.startsWith('/') &&
    !navigate.startsWith('//') &&
    !navigate.startsWith('/\\')
  );
}
