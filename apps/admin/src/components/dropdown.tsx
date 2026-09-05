import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * Trail-branded dropdown — popover listbox over a button. Replaces native
 * `<select>` whose macOS chrome breaks against Trail's dark/Bauhaus
 * palette and ignores tokens like --color-bg-card / --color-accent.
 *
 * Mirrors the popover pattern in panels/images.tsx SourceFilter and
 * panels/activity.tsx GroupFilter — extracted so future surfaces don't
 * each re-implement click-outside / Escape / aria-listbox.
 *
 * Closes on click-outside, Escape, and selection. Chevron + checkmark
 * for the selected row keep affordance and "what's selected" visible.
 */
export interface DropdownOption {
  value: string;
  label: string;
  /** Optional secondary text rendered subdued after the label. */
  hint?: string;
}

export function Dropdown({
  value,
  onChange,
  options,
  placeholder,
  buttonClass,
  menuClass,
  disabled,
  testid,
  hintInMenuOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  options: DropdownOption[];
  /** Rendered when no option matches `value`. Defaults to "—". */
  placeholder?: string;
  /** Extra classes on the button (typically width). */
  buttonClass?: string;
  /** Extra classes on the popover (typically width). */
  menuClass?: string;
  disabled?: boolean;
  /** F210.3 — stable anchor for Lens. Rendered as data-testid on the button. */
  testid?: string;
  /**
   * F210.3 — show the hint only inside the menu, not on the closed button.
   *
   * The button states the CURRENT value; the hint explains a CHOICE, and it
   * is only a choice while the menu is open. In a narrow table cell the
   * combined string truncates mid-word ("Ejer — Ful…"), which reads as a
   * rendering bug rather than a deliberate abbreviation.
   */
  hintInMenuOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const current = options.find((o) => o.value === value);
  const label = current?.label ?? placeholder ?? '—';

  return (
    {/* F248.3 — max-w-full på WRAPPEREN: den dimensionerer sig efter knappen,
        så en max-bredde på knappen alene måler mod wrapperen og gør intet.
        Med denne kappes fx w-[28rem]-vælgerne til skærmbredden på en telefon. */}
    <div class="relative inline-block max-w-full" ref={wrapRef}>
      <button
        data-testid={testid}
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        class={
          'relative flex items-center gap-2 pl-3 pr-8 py-1.5 text-sm rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]/40 hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] focus:outline-none transition disabled:opacity-50 disabled:cursor-not-allowed text-left ' +
          (buttonClass ?? 'w-[20rem]') + ' max-w-full'
        }
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span class="truncate flex-1 min-w-0">
          {current?.hint && !hintInMenuOnly ? (
            <>
              {current.label}{' '}
              <span class="text-[color:var(--color-fg-subtle)]">— {current.hint}</span>
            </>
          ) : (
            label
          )}
        </span>
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[color:var(--color-fg-muted)]">
          ▾
        </span>
      </button>
      {open ? (
        <div
          class={
            'absolute left-0 top-full mt-1 z-20 rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-card)] shadow-2xl max-h-[60vh] overflow-y-auto ' +
            (menuClass ?? 'min-w-full')
          }
          role="listbox"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              data-testid={testid ? `${testid}-option-${opt.value}` : undefined}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              onClick={() => select(opt.value)}
              class={
                'w-full text-left px-3 py-2 text-sm transition flex items-center gap-2 ' +
                (opt.value === value
                  ? 'bg-[color:var(--color-accent)]/10 text-[color:var(--color-fg)]'
                  : 'text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-bg)]/60 hover:text-[color:var(--color-fg)]')
              }
            >
              <span
                class={
                  'inline-block w-3 flex-shrink-0 text-[color:var(--color-accent)] ' +
                  (opt.value === value ? 'opacity-100' : 'opacity-0')
                }
              >
                ✓
              </span>
              <span class="flex-1 min-w-0">
                {opt.label}
                {opt.hint ? (
                  <span class="ml-2 text-[color:var(--color-fg-subtle)]">— {opt.hint}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
