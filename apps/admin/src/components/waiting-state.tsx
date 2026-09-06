/**
 * F257.4 — vente-tilstanden. Godkendt mockup 6/9 2026: «Vente-tilstanden — tre
 * forslag», forslag 1 til lister og forslag 2 til alt andet.
 *
 * DEN GAMLE: en 320px neuron-animation i et 60vh-felt — omkring en tredjedel
 * af skærmen for at sige «vent». Forslag 3 (den voksende liste) er den bedste
 * oplevelse og blev valgt fra: den kræver at API'et kan levere i portioner, og
 * det kan link-check-ruten ikke i dag.
 *
 * OG DEN VIGTIGSTE BEMÆRKNING STÅR UDEN FOR KOMPONENTEN, så den ikke går tabt
 * her: den rigtige rettelse er at der ikke skal være noget at vente på. En
 * pænere animation gør 18 sekunder til 18 pænere sekunder. Det er F257.4's
 * eget emne — 284 sekunder på at markere ÉN kilde færdig.
 */
import { useEffect, useState } from 'preact/hooks';

/**
 * Hvor længe der IKKE vises noget.
 *
 * ÉN KILDE TIL TALLET. Komponenten og prøven læser begge denne konstant; to
 * kopier ville drive fra hinanden, og prøven ville så bevise noget om sin egen
 * kopi frem for om koden.
 *
 * Er svaret hurtigere end dette, ser man aldrig en animation — kun et blink der
 * aldrig kom. Det er den billigste forbedring af oplevet hastighed der findes.
 */
export const VENTE_FRIST_MS = 300;

/**
 * Er fristen udløbet?
 *
 * Returnerer FALSE indtil fristen er nået, så kalderen kan returnere `null` og
 * dermed rendere INTET. Det er en anden ting end at rendere noget usynligt: et
 * usynligt 60vh-felt fylder stadig i layoutet og skubber siden, når det
 * forsvinder.
 */
function brugFrist(ms: number): boolean {
  const [udløbet, sætUdløbet] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => sætUdløbet(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return udløbet;
}

/** Forslag 1 — skelettet. Formen af det der kommer, tegnet med det samme. */
function SkeletRækker({ antal = 3 }: { antal?: number }) {
  // Faste bredder, ikke tilfældige: to kald i træk skal se ens ud, ellers
  // flimrer siden ved hver gen-tegning — og et Lens-skærmbillede ville aldrig
  // kunne sammenlignes med det forrige.
  const bredder = [
    ['74%', '44%'],
    ['88%', '36%'],
    ['59%', '50%'],
    ['81%', '41%'],
  ];
  return (
    <div class="w-full max-w-[420px]" data-testid="waiting-skeleton">
      {Array.from({ length: antal }, (_, i) => {
        const [a, b] = bredder[i % bredder.length]!;
        return (
          <div
            key={i}
            class="flex items-start gap-3 py-3 border-b border-[color:var(--color-border)] last:border-b-0"
          >
            <span class="mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full bg-[color:var(--color-border)]" />
            <div class="min-w-0 flex-1">
              <span class="skeleton-bar block h-[9px] rounded-[5px]" style={{ width: a }} />
              <span class="skeleton-bar mt-[7px] block h-[9px] rounded-[5px]" style={{ width: b }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Forslag 2 — pulsen. Én tynd linje, og et sekundtal når det trækker ud. */
function Pulslinje({ label }: { label: string }) {
  const [sekunder, sætSekunder] = useState(0);
  useEffect(() => {
    const t = setInterval(() => sætSekunder((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div class="flex flex-col items-center gap-4" data-testid="waiting-pulse">
      <span class="pulse-track relative block h-[2px] w-[190px] overflow-hidden rounded-[2px] bg-[color:var(--color-border)]" />
      <span class="text-[13px] text-[color:var(--color-fg-muted)]">{label}</span>
      {/* Sekundtallet vises først når ventetiden er mærkbar. Et «0 sekunder»
          der straks bliver til 1 gør et hurtigt svar til en påmindelse om at
          man ventede. */}
      {sekunder >= 3 ? (
        <span
          class="font-mono text-[11.5px] text-[color:var(--color-fg-subtle)]"
          style="font-variant-numeric: tabular-nums;"
          data-testid="waiting-pulse-seconds"
        >
          {sekunder} sekunder
        </span>
      ) : null}
    </div>
  );
}

export interface WaitingStateProps {
  /** Tekst under pulsen. Ignoreres af skelet-varianten, som med vilje er tekstløs. */
  label?: string;
  /**
   * `list` → skelet-rækker (Forslag 1). `value` → pulslinje (Forslag 2).
   * Standard er `value`, så et kaldested der ikke tager stilling får den
   * variant der passer alle steder frem for den der kun passer lister.
   */
  variant?: 'list' | 'value';
  /** Antal skelet-rækker. Kun for `list`. */
  rows?: number;
}

export function WaitingState({ label, variant = 'value', rows }: WaitingStateProps) {
  const vis = brugFrist(VENTE_FRIST_MS);
  if (!vis) return null;
  return (
    <div
      class="flex min-h-[180px] flex-col items-center justify-center py-8 text-[color:var(--color-fg-muted)]"
      data-testid="waiting-state"
      data-variant={variant}
    >
      {variant === 'list' ? <SkeletRækker antal={rows} /> : <Pulslinje label={label ?? 'Henter…'} />}
    </div>
  );
}
