/**
 * Slider — custom range control. The project bans native `<input type="range">`
 * (unstyleable, breaks the token palette + dark mode), so this is a
 * pointer-draggable + keyboard-accessible track/thumb built from tokens.
 *
 * Keyboard: ←/→ step, Home/End jump to min/max. ARIA slider role with
 * valuemin/max/now so it's announced like a native range. Hover/active/focus
 * feedback per the project UI rules.
 */
import { useRef, useCallback } from 'preact/hooks';

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  disabled?: boolean;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function Slider({ value, min, max, step = 1, onChange, ariaLabel, disabled }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = max > min ? ((clamp(value, min, max) - min) / (max - min)) * 100 : 0;

  const valueFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const raw = min + ratio * (max - min);
      const snapped = Math.round(raw / step) * step;
      return clamp(snapped, min, max);
    },
    [min, max, step, value],
  );

  const startDrag = useCallback(
    (e: PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      onChange(valueFromClientX(e.clientX));
      const move = (ev: PointerEvent) => onChange(valueFromClientX(ev.clientX));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [disabled, onChange, valueFromClientX],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (disabled) return;
      let next: number | null = null;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step;
      else if (e.key === 'Home') next = min;
      else if (e.key === 'End') next = max;
      if (next !== null) {
        e.preventDefault();
        onChange(clamp(next, min, max));
      }
    },
    [disabled, value, step, min, max, onChange],
  );

  return (
    <div
      ref={trackRef}
      onPointerDown={startDrag}
      class={
        'relative h-5 flex items-center select-none ' +
        (disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer')
      }
    >
      {/* track */}
      <div class="absolute left-0 right-0 h-1 rounded-full bg-[color:var(--color-border)]" />
      {/* filled portion */}
      <div
        class="absolute left-0 h-1 rounded-full bg-[color:var(--color-accent)]"
        style={{ width: `${pct}%` }}
      />
      {/* thumb */}
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled}
        onKeyDown={onKeyDown}
        class={
          'absolute w-3.5 h-3.5 -ml-1.5 rounded-full border-2 border-[color:var(--color-accent)] bg-[color:var(--color-bg)] shadow-sm transition-transform ' +
          (disabled ? '' : 'hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]/40')
        }
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}
