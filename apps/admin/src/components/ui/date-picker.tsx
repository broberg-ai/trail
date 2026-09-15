/**
 * Datovælger — en rigtig kalender, i husets eget udtryk.
 *
 * INGEN `<input type="date">`. macOS' egen kalender-popover matcher intet
 * brand, ignorerer temaet og ser billig ud ved siden af resten. Mønsteret her
 * er det samme som GroupFilter i activity.tsx og SourceFilter i images.tsx:
 * en knap der åbner et popover, med klik-udenfor og Escape.
 *
 * DATOEN VISES ALTID PÅ DANSK, også når sproget er engelsk — se lib/dates.ts
 * for hvorfor. Ugen starter mandag, og ugedagene er de danske forkortelser.
 * Det er ikke en oversættelse der er glemt; det er den regel produktet har.
 *
 * VÆRDIEN ind og ud er `YYYY-MM-DD` — den form motorens filter forventer, og
 * den eneste der ikke kan læses to måder. Kun VISNINGEN er dansk.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatLocaleDate, danskISODato } from '../../lib/dates';

const UGEDAGE = ['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'] as const;
const MAANEDER = [
  'januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december',
] as const;

/** Mandag = 0. JS' getDay() har søndag = 0, hvilket ville rykke hele gitteret. */
function ugedagMandagFoerst(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function iso(aar: number, maaned: number, dag: number): string {
  return `${aar}-${String(maaned + 1).padStart(2, '0')}-${String(dag).padStart(2, '0')}`;
}

/** Dagene i måneden, polstret med tomme pladser så ugen starter mandag. */
function maanedsGitter(aar: number, maaned: number): Array<number | null> {
  const foerste = new Date(aar, maaned, 1);
  const dageIMaaned = new Date(aar, maaned + 1, 0).getDate();
  const polstring = ugedagMandagFoerst(foerste);
  return [
    ...Array<null>(polstring).fill(null),
    ...Array.from({ length: dageIMaaned }, (_, i) => i + 1),
  ];
}

export interface DatePickerProps {
  /** `YYYY-MM-DD`, eller tom for «ingen grænse». */
  value: string;
  onChange: (iso: string) => void;
  /** Vises når intet er valgt — fx «Fra» / «Til». */
  placeholder: string;
  /** Tilgængeligt navn på knappen. */
  label: string;
  testid: string;
  /** Datoer før denne kan ikke vælges (til at spærre «til» før «fra»). */
  min?: string;
}

const KNAP =
  'relative flex items-center gap-2 pl-3 pr-8 py-1 text-[12px] rounded-md border ' +
  'border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] ' +
  'hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] ' +
  'focus:outline-none transition cursor-pointer w-[150px] text-left';

export function DatePicker({ value, onChange, placeholder, label, testid, min }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Hvilken måned kalenderen står på. Følger værdien når den skifter udefra
  // (et hurtigvalg), så popoveren ikke åbner på en anden måned end den valgte.
  const valgt = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  const [vist, setVist] = useState(() => {
    const d = valgt ? new Date(`${valgt}T00:00:00`) : new Date();
    return { aar: d.getFullYear(), maaned: d.getMonth() };
  });
  useEffect(() => {
    if (!valgt) return;
    const d = new Date(`${valgt}T00:00:00`);
    setVist({ aar: d.getFullYear(), maaned: d.getMonth() });
  }, [valgt]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const gitter = useMemo(() => maanedsGitter(vist.aar, vist.maaned), [vist.aar, vist.maaned]);
  const iDag = danskISODato();

  const skiftMaaned = (delta: number) => {
    setVist(({ aar, maaned }) => {
      const m = maaned + delta;
      if (m < 0) return { aar: aar - 1, maaned: 11 };
      if (m > 11) return { aar: aar + 1, maaned: 0 };
      return { aar, maaned: m };
    });
  };

  return (
    <div class="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        data-testid={testid}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        class={KNAP}
      >
        <span
          class={`truncate flex-1 min-w-0 ${valgt ? '' : 'text-[color:var(--color-fg-subtle)]'}`}
        >
          {valgt ? formatLocaleDate(valgt) : placeholder}
        </span>
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[color:var(--color-fg-muted)]">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={label}
          data-testid={`${testid}-popover`}
          class="absolute left-0 top-full mt-1 z-30 w-[252px] p-3 rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-card)] shadow-2xl"
        >
          <div class="flex items-center justify-between mb-2">
            <button
              type="button"
              data-testid={`${testid}-prev`}
              aria-label="Forrige måned"
              onClick={() => skiftMaaned(-1)}
              class="px-2 py-0.5 text-[12px] rounded hover:bg-[color:var(--color-hover)] active:bg-[color:var(--color-active)] transition"
            >
              ‹
            </button>
            <span class="text-[12px] font-mono" data-testid={`${testid}-month`}>
              {MAANEDER[vist.maaned]} {vist.aar}
            </span>
            <button
              type="button"
              data-testid={`${testid}-next`}
              aria-label="Næste måned"
              onClick={() => skiftMaaned(1)}
              class="px-2 py-0.5 text-[12px] rounded hover:bg-[color:var(--color-hover)] active:bg-[color:var(--color-active)] transition"
            >
              ›
            </button>
          </div>

          <div class="grid grid-cols-7 gap-0.5 mb-1">
            {UGEDAGE.map((u) => (
              <span
                key={u}
                class="text-center text-[10px] font-mono uppercase text-[color:var(--color-fg-subtle)] py-1"
              >
                {u}
              </span>
            ))}
          </div>

          <div class="grid grid-cols-7 gap-0.5">
            {gitter.map((dag, i) => {
              if (dag === null) return <span key={`tom-${i}`} />;
              const d = iso(vist.aar, vist.maaned, dag);
              const erValgt = d === valgt;
              const erIDag = d === iDag;
              const spaerret = min !== undefined && min !== '' && d < min;
              return (
                <button
                  key={d}
                  type="button"
                  data-testid={`${testid}-dag-${d}`}
                  disabled={spaerret}
                  onClick={() => {
                    onChange(d);
                    setOpen(false);
                  }}
                  class={
                    'h-7 text-[12px] rounded transition ' +
                    (erValgt
                      ? 'bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] '
                      : 'hover:bg-[color:var(--color-hover)] active:bg-[color:var(--color-active)] ') +
                    (erIDag && !erValgt ? 'border border-[color:var(--color-accent)] ' : '') +
                    (spaerret ? 'opacity-30 cursor-not-allowed ' : '')
                  }
                >
                  {dag}
                </button>
              );
            })}
          </div>

          {valgt ? (
            <button
              type="button"
              data-testid={`${testid}-clear`}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              class="mt-2 w-full py-1 text-[11px] font-mono uppercase tracking-wider rounded border border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-elevated)] active:scale-[0.99] transition text-[color:var(--color-fg-muted)]"
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
