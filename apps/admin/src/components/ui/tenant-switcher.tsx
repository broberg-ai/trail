import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { switchTenant, type AuthTenant } from '../../api';
import { Sheet } from './sheet';
import { Icons } from './icons';
import { t } from '../../lib/i18n';

/**
 * F186 — TenantSwitcher pill that sits next to the logo in the top-bar.
 * Ported from docs/design/trail_app/src/tenant-switcher.jsx.
 *
 * Renders the active tenant + chevron. Click opens a dropdown listing
 * every tenant the signed-in user has access to (admin-server's
 * /api/auth/me populates the list). On mobile, the dropdown becomes a
 * bottom-sheet via <Sheet>. When `tenants.length > 8` a filter input
 * is shown above the list.
 *
 * Tenant-switch behaviour: POST /api/auth/switch-tenant sets the
 * active-tenant cookie, then we navigate to / so the user lands on
 * Home for the new tenant (per F186 locked decision Q3.2).
 */
export interface TenantSwitcherProps {
  tenants: AuthTenant[];
  isMobile?: boolean;
  onManageTenants?: () => void;
}

export function TenantSwitcher({ tenants, isMobile = false, onManageTenants }: TenantSwitcherProps) {
  const { route } = useLocation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const current = tenants.find((x) => x.active) ?? tenants[0];

  useEffect(() => {
    if (!open) {
      setQ('');
      return;
    }
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    if (tenants.length > 8) setTimeout(() => inputRef.current?.focus(), 80);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open, tenants.length]);

  const filtered = useMemo(() => {
    if (!q) return tenants;
    const s = q.toLowerCase();
    return tenants.filter((x) => x.name.toLowerCase().includes(s) || x.slug.toLowerCase().includes(s));
  }, [q, tenants]);

  const searchable = tenants.length > 8;

  async function handleSwitch(slug: string) {
    if (slug === current?.slug) {
      setOpen(false);
      return;
    }
    setPending(slug);
    try {
      await switchTenant(slug);
      // Hard navigate to "/" so the new active-tenant cookie is picked up
      // by every subsequent /api/v1/* call AND any in-flight in-memory
      // tenant state gets a clean reset.
      window.location.href = '/';
    } catch (err) {
      console.error('[tenant-switcher] switch failed', err);
      setPending(null);
      setOpen(false);
    }
  }

  if (!current) return null;

  const list = (
    <div class="scroll-y" style={{ flex: 1, maxHeight: 320, padding: '4px 0' }}>
      {filtered.length === 0 ? (
        <div style={{ padding: '24px 14px', color: 'var(--color-fg-subtle)', fontSize: 12.5, textAlign: 'center' }}>
          {t('tenantSwitcher.empty')}
        </div>
      ) : null}
      {filtered.map((tn) => {
        const isCurrent = tn.slug === current.slug;
        return (
          <button
            key={tn.slug}
            class={'menu-item' + (isCurrent ? ' is-active' : '')}
            onClick={() => handleSwitch(tn.slug)}
            disabled={pending === tn.slug}
            style={{ padding: '8px 14px', gap: 10 }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                background: isCurrent ? 'var(--color-accent)' : 'var(--color-bg-sunk)',
                color: isCurrent ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 600,
                flex: '0 0 auto',
              }}
            >
              {tn.name.split(' ').slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase().slice(0, 2)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: isCurrent ? 500 : 400,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tn.name}</span>
                {tn.plan ? <span class={'plan-badge ' + tn.plan}>{tn.plan}</span> : null}
              </div>
              <div class="mono" style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)', marginTop: 2 }}>
                {tn.slug}
              </div>
            </div>
            {isCurrent ? <Icons.Check size={14} style={{ color: 'var(--color-accent)', flex: '0 0 auto' }} /> : null}
          </button>
        );
      })}
    </div>
  );

  const search = searchable ? (
    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ position: 'relative' }}>
        <Icons.Search
          size={13}
          style={{
            position: 'absolute',
            left: 9,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--color-fg-subtle)',
          }}
        />
        <input
          ref={inputRef}
          class="input"
          placeholder={t('tenantSwitcher.search')}
          value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
          style={{ padding: '6px 10px 6px 28px', fontSize: 12.5 }}
        />
      </div>
    </div>
  ) : null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="topnav-tenant-switcher"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 8px 5px 10px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--color-border)',
          background: open ? 'var(--color-active)' : 'transparent',
          color: 'var(--color-fg)',
          fontSize: 13,
          fontWeight: 500,
          maxWidth: isMobile ? 160 : 240,
          transition: 'background var(--dur) var(--ease), border-color var(--dur) var(--ease)',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: 4,
            background: 'var(--color-accent-soft)',
            color: 'var(--color-accent)',
            flex: '0 0 auto',
          }}
        >
          <Icons.Building size={11} stroke={2} />
        </span>
        <span
          class="topnav-tenant-label"
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: isMobile ? 100 : 180,
          }}
        >
          {current.name}
        </span>
        <Icons.Chevron size={12} style={{ color: 'var(--color-fg-subtle)', flex: '0 0 auto' }} />
      </button>

      {open && !isMobile ? (
        <div
          class="menu anim-menu"
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 320,
            maxHeight: 480,
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '10px 14px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <div class="menu-section" style={{ padding: 0 }}>
              {t('tenantSwitcher.heading')}
            </div>
            <span class="mono" style={{ fontSize: 10, color: 'var(--color-fg-subtle)' }}>
              {tenants.length}
            </span>
          </div>

          {search}
          {list}

          <div style={{ borderTop: '1px solid var(--color-border)', padding: '6px' }}>
            <button
              type="button"
              class="menu-item"
              style={{ borderRadius: 'var(--radius-sm)', fontSize: 12.5 }}
              onClick={() => {
                setOpen(false);
                if (onManageTenants) onManageTenants();
                else route('/tenants');
              }}
            >
              <Icons.Settings size={13} style={{ color: 'var(--color-fg-subtle)' }} />
              <span>{t('tenantSwitcher.manage')}</span>
            </button>
          </div>
        </div>
      ) : null}

      <Sheet open={open && isMobile} onClose={() => setOpen(false)} title={t('tenantSwitcher.heading')}>
        {search}
        {list}
        <button
          type="button"
          class="menu-item"
          style={{ padding: '14px 16px', borderTop: '1px solid var(--color-border)', marginTop: 6 }}
          onClick={() => {
            setOpen(false);
            if (onManageTenants) onManageTenants();
            else route('/tenants');
          }}
        >
          <Icons.Settings size={14} style={{ color: 'var(--color-fg-subtle)' }} />
          <span>{t('tenantSwitcher.manage')}</span>
        </button>
      </Sheet>
    </div>
  );
}
