import { useEffect } from 'preact/hooks';
import { t } from '../../lib/i18n';

/**
 * F186 Phase A — placeholder command palette shell. The real
 * implementation lands in Phase C (Recent neurons / Trails / Actions /
 * Switch tenant groups with keyboard navigation). For now we render the
 * overlay + search field so ⌘K does *something* visible while the
 * sidebar/chrome work proceeds.
 */
export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      class="anim-fade"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(26,23,21,.36)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <div
        class="menu anim-palette"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 620,
          boxShadow: 'var(--shadow-xl)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'min(560px, 70vh)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 16px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            style={{ color: 'var(--color-fg-subtle)' }}
          >
            <circle cx={11} cy={11} r={7} />
            <line x1={21} y1={21} x2={16.65} y2={16.65} />
          </svg>
          <input
            autoFocus
            placeholder={t('palette.placeholder')}
            style={{
              flex: 1,
              border: 0,
              outline: 'none',
              background: 'transparent',
              color: 'var(--color-fg)',
              font: 'inherit',
              fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={onClose}
            class="kbd"
            style={{ cursor: 'pointer' }}
          >
            esc
          </button>
        </div>

        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-fg-subtle)', fontSize: 13 }}>
          {t('palette.empty')}
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-fg-faint)' }}>
            (Phase C — under construction)
          </div>
        </div>
      </div>
    </div>
  );
}
