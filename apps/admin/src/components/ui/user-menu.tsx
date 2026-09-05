import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { signOut } from '../../api';
import { Sheet } from './sheet';
import { Icons } from './icons';
import { t, useLocale, setLocale, type Locale } from '../../lib/i18n';
import { getTheme, toggleTheme, onThemeChange, type Theme } from '../../theme';
import { ambientEnabled } from '../../lib/ambient-store';

/**
 * F186 — UserMenu pill at the top-right. Identity header + Settings link
 * + preferences (theme/locale/ambient audio segmented controls) + plan
 * usage (hidden until F40.2b) + sign-out.
 *
 * Theme/locale/audio controls were lifted out of the top-bar and parked
 * here per F186 Q4.1.
 */
export interface UserMenuProps {
  user: { name: string | null; email: string };
  tenant: { name: string; plan: string | null } | null;
  isMobile?: boolean;
}

function initialsOf(name: string | null, email: string): string {
  const src = (name && name.trim()) || email.split('@')[0] || '?';
  return src
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function UserMenu({ user, tenant, isMobile = false }: UserMenuProps) {
  const { route } = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const initials = initialsOf(user.name, user.email);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function handleSignOut() {
    try { await signOut(); } catch { /* ignore */ }
    window.location.href = '/login';
  }

  const body = (
    <Body
      user={user}
      tenant={tenant}
      initials={initials}
      onSettings={() => {
        setOpen(false);
        route('/settings');
      }}
      onSignOut={() => {
        setOpen(false);
        void handleSignOut();
      }}
    />
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="topnav-user-menu"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px 4px 4px',
          borderRadius: 999,
          border: '1px solid var(--color-border)',
          background: open ? 'var(--color-active)' : 'transparent',
          transition: 'background var(--dur) var(--ease)',
          cursor: 'pointer',
        }}
      >
        <span class="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
          {initials}
        </span>
        {!isMobile ? (
          <span class="topnav-hide-mobile" style={{ fontSize: 13, fontWeight: 500 }}>
            {(user.name?.split(' ')[0]) || user.email.split('@')[0]}
          </span>
        ) : null}
        <Icons.Chevron size={11} style={{ color: 'var(--color-fg-subtle)' }} />
      </button>

      {open && !isMobile ? (
        <div
          class="menu anim-menu"
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: 320,
            zIndex: 60,
          }}
        >
          {body}
        </div>
      ) : null}

      <Sheet open={open && isMobile} onClose={() => setOpen(false)} title={user.name ?? user.email}>
        {body}
      </Sheet>
    </div>
  );
}

function Body({
  user,
  tenant,
  initials,
  onSettings,
  onSignOut,
}: {
  user: { name: string | null; email: string };
  tenant: { name: string; plan: string | null } | null;
  initials: string;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const locale = useLocale();
  const [theme, setTheme] = useState<Theme>(getTheme());
  useEffect(() => onThemeChange(setTheme), []);

  return (
    <div>
      {/* Identity header */}
      <div style={{ padding: '14px 14px 12px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span class="avatar lg">{initials}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.2 }}>{user.name ?? user.email}</div>
          <div
            class="mono"
            style={{
              fontSize: 11,
              color: 'var(--color-fg-muted)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.email}
          </div>
          {tenant ? (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icons.Building size={11} style={{ color: 'var(--color-fg-subtle)' }} />
              <span style={{ fontSize: 11.5, color: 'var(--color-fg-muted)' }}>{tenant.name}</span>
              {tenant.plan ? <span class={'plan-badge ' + tenant.plan}>{tenant.plan}</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div class="menu-sep" />

      <button type="button" class="menu-item" style={{ padding: '8px 14px' }} onClick={onSettings}>
        <Icons.Settings size={14} style={{ color: 'var(--color-fg-subtle)' }} />
        <span>{t('userMenu.settings')}</span>
        <Icons.ChevronRight size={12} style={{ color: 'var(--color-fg-subtle)', marginLeft: 'auto' }} />
      </button>

      <div class="menu-sep" />

      {/* Preferences */}
      <div style={{ padding: '8px 14px 4px' }}>
        <div class="menu-section" style={{ padding: '0 0 6px' }}>
          {t('userMenu.preferences')}
        </div>

        <PrefRow label={t('userMenu.theme')}>
          <div class="segmented">
            <button aria-pressed={theme === 'light'} onClick={() => theme !== 'light' && toggleTheme()}>
              <Icons.Sun size={11} stroke={2} style={{ marginRight: 4, display: 'inline-block', verticalAlign: -1 }} />
              {t('userMenu.themeLight')}
            </button>
            <button aria-pressed={theme === 'dark'} onClick={() => theme !== 'dark' && toggleTheme()}>
              <Icons.Moon size={11} stroke={2} style={{ marginRight: 4, display: 'inline-block', verticalAlign: -1 }} />
              {t('userMenu.themeDark')}
            </button>
          </div>
        </PrefRow>

        <PrefRow label={t('userMenu.language')}>
          <div class="segmented">
            <button aria-pressed={locale === 'en'} onClick={() => setLocale('en' as Locale)}>EN</button>
            <button aria-pressed={locale === 'da'} onClick={() => setLocale('da' as Locale)}>DA</button>
          </div>
        </PrefRow>

        <PrefRow label={t('userMenu.ambient')}>
          <div class="segmented">
            <button
              aria-pressed={!ambientEnabled.value}
              onClick={() => { ambientEnabled.value = false; }}
            >
              {t('userMenu.ambientOff')}
            </button>
            <button
              aria-pressed={ambientEnabled.value}
              onClick={() => { ambientEnabled.value = true; }}
            >
              {t('userMenu.ambientOn')}
            </button>
          </div>
        </PrefRow>
      </div>

      {/* Plan + usage — hidden until F40.2b lands. F186 locked decision Q4.2. */}

      <div class="menu-sep" />

      <div style={{ padding: 6 }}>
        <button type="button" class="menu-item is-danger" style={{ borderRadius: 'var(--radius-sm)' }} onClick={onSignOut}>
          <Icons.LogOut size={14} />
          <span>{t('userMenu.signOut')}</span>
        </button>
      </div>
    </div>
  );
}

function PrefRow({ label, children }: { label: string; children: any }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ fontSize: 12.5, color: 'var(--color-fg-muted)' }}>{label}</span>
      {children}
    </div>
  );
}
