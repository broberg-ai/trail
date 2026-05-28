import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

/**
 * F186 — bottom-sheet primitive (mobile/tablet overlay that slides up from
 * the bottom of the viewport). Ported 1:1 from
 * docs/design/trail_app/src/tenant-switcher.jsx::MobileSheet, but exported
 * here so any component (TenantSwitcher, UserMenu, row-menus, ManageTenants
 * actions) can reuse the same primitive without inlining.
 *
 * Renders as a fixed overlay with backdrop. Click outside the panel or hit
 * Escape to close. Locks body scroll while open.
 */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ComponentChildren;
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      class="anim-fade"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(26,23,21,.4)',
      }}
      onClick={onClose}
    >
      <div
        class="sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--color-bg-card)',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {title ? (
          <div
            style={{
              padding: '14px 16px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <div style={{ fontWeight: 500, fontSize: 14 }}>{title}</div>
            <button class="icon-btn" onClick={onClose} aria-label="Close sheet">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ) : null}
        <div class="scroll-y" style={{ flex: 1, padding: '8px 0' }}>
          {children}
        </div>
        <div style={{ height: 'env(safe-area-inset-bottom)' }} />
      </div>
    </div>
  );
}
