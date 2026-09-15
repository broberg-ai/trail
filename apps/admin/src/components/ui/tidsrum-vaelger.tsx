/**
 * F273.2 — «Hvad lærte jeg mellem X og Y».
 *
 * Ejerens ord: «jeg kan ikke finde en given aktivitet der er sket i Trail i et
 * bestemt interval.» Det er kontrollen der stiller spørgsmålet.
 *
 * INGEN NATIVE KONTROLLER. Ingen `<input type="date">`, ingen `<select>`.
 * Husreglen er ikke kosmetik: macOS' egen kalender-popover matcher intet brand,
 * ignorerer temaet og ser billig ud ved siden af resten. Felterne er derfor
 * almindelige tekstfelter med et fast format, og hurtigvalgene dækker det man
 * i praksis spørger om.
 *
 * Datoerne er DANSK vægur-tid hele vejen — det er den tid ejeren tænker i, og
 * motoren omregner (se packages/shared/src/tidsvindue.ts).
 */
import { useState } from 'preact/hooks';
import type { Tidsrum } from '../../api';

/** Et hurtigvalg. `byg` kaldes når man trykker — aldrig på forhånd, så
 *  «i dag» ikke bliver hængende på gårsdagens dato i en åben fane. */
type Hurtigvalg = { id: string; mærkat: string; byg: () => Tidsrum };

/** `YYYY-MM-DD` for en dag N dage siden, i BESKUERENS zone (= dansk hos ejeren). */
function dagsdato(forskyd = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + forskyd);
  // sv-SE giver ISO-formen uden at vi selv regner på måneder.
  return new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const HURTIGVALG: readonly Hurtigvalg[] = [
  { id: 'i-dag', mærkat: 'I dag', byg: () => ({ fra: dagsdato(), til: dagsdato() }) },
  { id: 'i-gaar', mærkat: 'I går', byg: () => ({ fra: dagsdato(-1), til: dagsdato(-1) }) },
  { id: 'syv-dage', mærkat: 'Sidste 7 dage', byg: () => ({ fra: dagsdato(-6), til: dagsdato() }) },
  { id: 'tredive-dage', mærkat: 'Sidste 30 dage', byg: () => ({ fra: dagsdato(-29), til: dagsdato() }) },
];

export interface TidsrumVaelgerProps {
  værdi: Tidsrum;
  onVælg: (t: Tidsrum) => void;
  /** Serverens kvittering på hvad der faktisk blev spurgt om. */
  opløst?: { fra: string | null; til: string | null; zone: string } | null;
  /** Antal fundne — så «0» kan vises SAMMEN med vinduet og ikke alene. */
  antal?: number | null;
  fejl?: string | null;
}

const felt =
  'px-2 py-1 text-[12px] font-mono rounded-md border border-[color:var(--color-border)] ' +
  'bg-[color:var(--color-bg-card)] focus:border-[color:var(--color-accent)] focus:outline-none ' +
  'transition w-[150px]';

const chip =
  'px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-md border transition ' +
  'hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-elevated)] ' +
  'active:scale-[0.97]';

export function TidsrumVaelger({ værdi, onVælg, opløst, antal, fejl }: TidsrumVaelgerProps) {
  const [fra, setFra] = useState(værdi.fra ?? '');
  const [til, setTil] = useState(værdi.til ?? '');
  const aktiv = Boolean(værdi.fra || værdi.til);

  const anvend = (f: string, t: string) => {
    setFra(f);
    setTil(t);
    onVælg({ fra: f || undefined, til: t || undefined });
  };

  return (
    <div class="flex flex-col gap-2" data-testid="neurons-timerange">
      <div class="flex flex-wrap items-center gap-2">
        {HURTIGVALG.map((h) => (
          <button
            key={h.id}
            type="button"
            data-testid={`neurons-timerange-${h.id}`}
            class={`${chip} border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]`}
            onClick={() => {
              const v = h.byg();
              anvend(v.fra ?? '', v.til ?? '');
            }}
          >
            {h.mærkat}
          </button>
        ))}

        <span class="text-[11px] font-mono text-[color:var(--color-fg-subtle)] px-1">fra</span>
        <input
          type="text"
          inputMode="numeric"
          data-testid="neurons-timerange-from"
          class={felt}
          placeholder="ÅÅÅÅ-MM-DD"
          aria-label="Fra-dato (dansk tid)"
          value={fra}
          onInput={(e) => setFra((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter') anvend(fra, til); }}
        />
        <span class="text-[11px] font-mono text-[color:var(--color-fg-subtle)] px-1">til</span>
        <input
          type="text"
          inputMode="numeric"
          data-testid="neurons-timerange-to"
          class={felt}
          placeholder="ÅÅÅÅ-MM-DD"
          aria-label="Til-dato (dansk tid)"
          value={til}
          onInput={(e) => setTil((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter') anvend(fra, til); }}
        />
        <button
          type="button"
          data-testid="neurons-timerange-apply"
          class={`${chip} border-[color:var(--color-accent)] bg-[color:var(--color-bg-card)]`}
          onClick={() => anvend(fra, til)}
        >
          Vis
        </button>
        {aktiv && (
          <button
            type="button"
            data-testid="neurons-timerange-clear"
            class={`${chip} border-[color:var(--color-border)] bg-transparent text-[color:var(--color-fg-subtle)]`}
            onClick={() => anvend('', '')}
          >
            Ryd
          </button>
        )}
      </div>

      {/* Kvitteringen. Den er SERVERENS opløsning af vinduet, ikke vores eget
          valg — ellers ville skærmen bekræfte sin egen hensigt. Antallet står
          sammen med vinduet, så «0» aldrig kan læses som «noget gik galt». */}
      {fejl ? (
        <span
          data-testid="neurons-timerange-error"
          class="text-[11px] font-mono text-[color:var(--color-danger)]"
        >
          {fejl}
        </span>
      ) : opløst && (opløst.fra || opløst.til) ? (
        <span
          data-testid="neurons-timerange-resolved"
          class="text-[11px] font-mono text-[color:var(--color-fg-subtle)]"
        >
          {antal === 0 ? 'Ingen Neuroner' : `${antal ?? '—'} Neuroner`} mellem{' '}
          {opløst.fra ?? 'begyndelsen'} og {opløst.til ?? 'nu'} ({opløst.zone})
        </span>
      ) : null}
    </div>
  );
}
