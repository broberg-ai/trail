/**
 * F263.13 — hvilken Neuron skal en «kilde klar»-notifikation pege på?
 *
 * Reglen bor her, ikke inde i ruten, fordi det er DEN der kan være forkert.
 * Ejeren 8/9: «de linker ikke til noget relevant. Skal linke til en neuron.»
 */

export interface NeuronKandidat {
  filename: string;
  path: string | null;
  title: string | null;
}

export interface NeuronRute {
  navigate: string;
  /** Neuronens titel, til notifikationens tekst. Null når vi faldt tilbage. */
  titel: string | null;
}

/**
 * KILDE-REFERATET FORETRÆKKES når en kilde gav flere Neuroner: det er den side
 * der handler om netop denne kilde, og den linker videre til de øvrige. «Den
 * første» ville være vilkårligt — og lander man på en begrebsside, kan man ikke
 * se hvad den har med ens egen upload at gøre.
 *
 * Ingen Neuroner → kildelisten, som før. En notifikation der peger på en tom
 * side er værre end en der peger et sted man kan bruge.
 */
export function vaelgNeuronRute(kandidater: NeuronKandidat[], kbId: string): NeuronRute {
  const valgt =
    kandidater.find((n) => (n.path ?? '').startsWith('/neurons/sources/')) ?? kandidater[0];
  if (!valgt?.filename) {
    return { navigate: `/kb/${kbId}/sources`, titel: null };
  }
  // Adressen er filnavnet uden endelse — samme form læseren matcher på
  // (wiki-reader.tsx: `d.filename.replace(/\.md$/i, '')`). Bruger vi titlen i
  // stedet, rammer vi ved siden af hver gang de to ikke er ens.
  const slug = valgt.filename.replace(/\.md$/i, '');
  return {
    navigate: `/kb/${kbId}/neurons/${encodeURIComponent(slug)}`,
    titel: valgt.title ?? slug,
  };
}
