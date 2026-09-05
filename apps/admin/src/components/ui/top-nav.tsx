import { useLocation } from 'preact-iso';
import { useKb } from '../../lib/kb-cache';
import { TenantSwitcher } from './tenant-switcher';
import { UserMenu } from './user-menu';
import { Icons } from './icons';
import type { AuthMe } from '../../api';

/**
 * F186 — top-bar. Logo all the way left (per Christian's call —
 * F186 plan-doc Section 02). Wordmark + avatar size matches our current
 * sizing (Christian's call), NOT the design proposal's size. Then
 * TenantSwitcher pill, KB-breadcrumb when inside a trail, ⌘K palette
 * affordance, UserMenu pill on the right.
 *
 * The full 11-tab KB-tab-strip is gone — TrailSidebar takes over
 * navigation when inside a trail.
 */
export interface TopNavProps {
  me: AuthMe;
  onOpenPalette: () => void;
}

export function TopNav({ me, onOpenPalette }: TopNavProps) {
  const { path } = useLocation();
  const kbId = path.match(/^\/kb\/([^/]+)/)?.[1];
  const kb = useKb(kbId ?? '');

  return (
    <header
      style={{
        position: 'relative',
        zIndex: 50,
        background: 'color-mix(in srgb, var(--color-bg) 80%, transparent)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          height: 56,
        }}
      >
        {/* Logo cluster — flush left */}
        <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', flex: '0 0 auto' }}>
          <TrailLogo />
          <span
            class="font-mono"
            style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: 22, color: 'var(--color-fg)' }}
          >
            trail
          </span>
          <span class="topnav-hide-mobile" style={{ color: 'var(--color-fg-subtle)', fontSize: 14, marginLeft: 2 }}>admin</span>
        </a>

        {/* Tenant switcher */}
        {/* F211.1 — read defensively. A body without `tenants` must render a
            usable bar, not a blank page: this line crashed the whole SPA on
            2026-08-27 when it was served a response shape it did not expect.
            The 401 upstream is the fix; this is the guard that keeps a single
            missing field from taking the entire admin down again. */}
        {me.tenants && me.tenants.length > 0 ? (
          <TenantSwitcher tenants={me.tenants} />
        ) : null}

        {/* KB-breadcrumb (only when inside a trail) */}
        {kbId && kb ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-fg-muted)', minWidth: 0 }}>
            <Icons.Chevron size={11} style={{ transform: 'rotate(-90deg)', flex: '0 0 auto' }} />
            <span
              class="topnav-crumb"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 14,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 280,
              }}
            >
              {kb.name}
            </span>
          </div>
        ) : null}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* ⌘K palette affordance (right-aligned per Christian's call) */}
        <button
          type="button"
          data-testid="topnav-palette"
          onClick={onOpenPalette}
          aria-label="Open command palette"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 10px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: 'var(--color-fg-muted)',
            fontSize: 12.5,
            cursor: 'pointer',
            transition: 'background var(--dur) var(--ease), color var(--dur) var(--ease)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-hover)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-fg)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-fg-muted)';
          }}
        >
          <Icons.Search size={13} />
          <span class="topnav-hide-mobile" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>⌘K</span>
        </button>

        {/* User menu */}
        <UserMenu user={me.user} tenant={me.tenant} />
      </div>
    </header>
  );
}

function TrailLogo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={32} height={32} aria-hidden="true">
      <circle cx={16} cy={16} r={14} fill="none" stroke="currentColor" stroke-width={2} />
      <circle cx={16} cy={16} r={9} fill="none" stroke="var(--color-accent)" stroke-width={0.9} opacity={0.55} />
      <circle cx={16} cy={16} r={3.5} fill="var(--color-accent)" />
    </svg>
  );
}
