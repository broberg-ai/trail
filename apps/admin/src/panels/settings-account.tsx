import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { fetchAuthMe, type AuthMe } from '../api';
import { useLocale, getLocale, t, setLocale, type Locale } from '../lib/i18n';
import { getTheme, toggleTheme, onThemeChange, type Theme } from '../theme';
import { Icons } from '../components/ui/icons';
import { CenteredLoader } from '../components/centered-loader';

/**
 * F186 — Account Preferences. Ported from
 * docs/design/trail_app/src/user-settings.jsx 1:1. Six sticky-nav
 * sections per F186 Q10.1:
 *
 *   Profile        — Functional (display name editable; persist deferred)
 *   Preferences    — Functional (theme/locale synced with user-menu)
 *   Notifications  — Stub (toggles visible, no backend yet)
 *   Sessions       — Stub (shows this device, sign-out-elsewhere disabled)
 *   Developer      — "Coming Soon" F188 (user-level personal API keys)
 *   Danger         — Stub with disabled "Delete account" button
 *
 * Per F186 plan-doc the route is /settings and the page is labelled
 * "Account Preferences".
 */
export function SettingsAccountPanel() {
  useLocale();
  const [me, setMe] = useState<AuthMe | null>(null);

  useEffect(() => {
    fetchAuthMe().then(setMe).catch(() => setMe(null));
  }, []);

  if (!me) {
    return (
      <div style={{ padding: 60 }}>
        <CenteredLoader label="Loading…" />
      </div>
    );
  }

  const isDa = getLocale() === 'da';

  return (
    <div style={{ position: 'relative', maxWidth: 760, margin: '0 auto', padding: '48px 32px 80px' }}>
      <div class="constellation" style={{ opacity: 0.35 }} />

      <header style={{ position: 'relative', marginBottom: 40 }}>
        <div
          class="mono"
          style={{
            fontSize: 10.5,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-fg-subtle)',
            marginBottom: 8,
          }}
        >
          {isDa ? 'Indstillinger' : 'Settings'}
        </div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 32, letterSpacing: '-0.015em' }}>
          {t('accountPrefs.heading')}
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--color-fg-muted)', maxWidth: 540, lineHeight: 1.55 }}>
          {t('accountPrefs.subtitle')}
        </p>
      </header>

      {/* Sticky section nav */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          background: 'var(--color-bg)',
          marginLeft: -32,
          paddingLeft: 32,
          marginRight: -32,
          paddingRight: 32,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <nav style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {(['profile', 'login', 'preferences', 'notifications', 'sessions', 'developer', 'danger'] as const).map((id) => (
            <a
              key={id}
              href={`#${id}`}
              style={{
                padding: '12px 10px',
                fontSize: 12.5,
                fontWeight: 400,
                color: 'var(--color-fg-muted)',
                borderBottom: '2px solid transparent',
                marginBottom: -1,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-fg)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-fg-muted)')}
            >
              {t(`accountPrefs.sections.${id}`)}
            </a>
          ))}
        </nav>
      </div>

      <ProfileSection me={me} />
      <LoginMethodsSection me={me} />
      <PreferencesSection />
      <NotificationsSection />
      <SessionsSection isDa={isDa} />
      <DeveloperSection isDa={isDa} />
      <DangerSection isDa={isDa} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

function initialsOf(name: string | null, email: string): string {
  const src = (name && name.trim()) || email.split('@')[0] || '?';
  return src.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function ProfileSection({ me }: { me: AuthMe }) {
  const isDa = getLocale() === 'da';
  const [displayName, setDisplayName] = useState(me.user.name ?? '');
  const initials = initialsOf(me.user.name, me.user.email);
  return (
    <Section id="profile" title={t('accountPrefs.sections.profile')} subtitle={isDa ? 'Sådan vises du for andre i tenants du deler' : 'How you appear to other members in shared tenants'}>
      <Field label={isDa ? 'Avatar' : 'Avatar'} hint={isDa ? 'Genereres fra dine initialer. Upload kommer senere.' : 'Generated from your initials. Photo upload coming later.'}>
        <span class="avatar lg">{initials}</span>
      </Field>
      <Field label={isDa ? 'Visningsnavn' : 'Display name'}>
        <input class="input" value={displayName} onInput={(e) => setDisplayName((e.currentTarget as HTMLInputElement).value)} style={{ maxWidth: 320 }} />
      </Field>
      <Field
        label={isDa ? 'E-mail' : 'Email'}
        hint={isDa ? 'Fra Google/GitHub. For at ændre, log ind med en anden konto.' : 'From Google/GitHub. To change, sign in with a different account.'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span class="mono" style={{ fontSize: 13 }}>{me.user.email}</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              padding: '2px 7px',
              borderRadius: 999,
              background: 'rgba(21,128,61,.10)',
              color: 'var(--color-success)',
              border: '1px solid rgba(21,128,61,.20)',
            }}
          >
            {isDa ? 'verificeret' : 'verified'}
          </span>
        </div>
      </Field>
    </Section>
  );
}

function LoginMethodsSection({ me }: { me: AuthMe }) {
  // F186-followup — visual section showing the identity providers a
  // user can sign in with. Email-link is always active (the account is
  // anchored to email). Google + GitHub render as "Link account"
  // buttons that redirect through /api/auth/<provider> — the OAuth
  // handler will reuse the existing account when the provider returns
  // a matching email. Actual link-tracking (so we can show "Remove"
  // instead of "Link account") needs an oauth_identities table — F-
  // followup.
  return (
    <Section
      id="login"
      title={t('accountPrefs.loginMethods.heading')}
      subtitle={t('accountPrefs.loginMethods.subtitle')}
    >
      <LoginMethodRow
        icon={<MailIcon />}
        name={t('accountPrefs.loginMethods.emailLink')}
        email={me.user.email}
        right={
          <span
            style={{
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'var(--color-accent-soft)',
              color: 'var(--color-fg)',
              fontWeight: 500,
            }}
          >
            {t('accountPrefs.loginMethods.alwaysActive')}
          </span>
        }
      />
      <LoginMethodRow
        icon={<GoogleIcon />}
        name="Google"
        email={me.user.email}
        right={
          <button
            type="button"
            class="btn"
            disabled
            style={{ padding: '6px 12px', fontSize: 12.5, opacity: 0.5, cursor: 'not-allowed' }}
            title={t('comingSoonToast')}
          >
            {t('accountPrefs.loginMethods.linkAccount')}
          </button>
        }
      />
      <LoginMethodRow
        icon={<GitHubIcon />}
        name="GitHub"
        email={me.user.email}
        right={
          <button
            type="button"
            class="btn"
            disabled
            style={{ padding: '6px 12px', fontSize: 12.5, opacity: 0.5, cursor: 'not-allowed' }}
            title={t('comingSoonToast')}
          >
            {t('accountPrefs.loginMethods.linkAccount')}
          </button>
        }
      />
    </Section>
  );
}

function LoginMethodRow({
  icon,
  name,
  email,
  right,
}: {
  icon: JSX.Element;
  name: string;
  email: string;
  right: JSX.Element;
}) {
  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        marginBottom: 10,
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-fg)',
          flex: '0 0 auto',
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{name}</div>
        <div class="mono" style={{ fontSize: 11, color: 'var(--color-fg-muted)', marginTop: 2 }}>
          {email}
        </div>
      </div>
      <div style={{ flex: '0 0 auto' }}>{right}</div>
    </div>
  );
}

function MailIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .3a12 12 0 0 0-3.79 23.4c.6.11.82-.26.82-.58v-2c-3.34.72-4.04-1.61-4.04-1.61a3.18 3.18 0 0 0-1.34-1.76c-1.09-.74.08-.72.08-.72a2.52 2.52 0 0 1 1.84 1.24 2.56 2.56 0 0 0 3.5 1 2.56 2.56 0 0 1 .76-1.6c-2.66-.3-5.46-1.33-5.46-5.93a4.65 4.65 0 0 1 1.23-3.21 4.32 4.32 0 0 1 .12-3.17s1-.32 3.3 1.23a11.43 11.43 0 0 1 6 0c2.3-1.55 3.3-1.23 3.3-1.23a4.32 4.32 0 0 1 .12 3.17 4.64 4.64 0 0 1 1.23 3.21c0 4.6-2.81 5.62-5.48 5.92a2.88 2.88 0 0 1 .82 2.23v3.32c0 .32.22.7.83.58A12 12 0 0 0 12 .3z" />
    </svg>
  );
}

function PreferencesSection() {
  const locale = useLocale();
  const [theme, setTheme] = useState<Theme>(getTheme());
  useEffect(() => onThemeChange(setTheme), []);
  return (
    <Section
      id="preferences"
      title={t('accountPrefs.sections.preferences')}
      subtitle={getLocale() === 'da' ? 'Tema og sprog. Synkroniseret med kontroller i bruger-menuen.' : 'Theme and language. Synced with the user-menu controls.'}
    >
      <Field label={t('userMenu.theme')}>
        <div class="segmented">
          <button aria-pressed={theme === 'light'} onClick={() => theme !== 'light' && toggleTheme()}>{t('userMenu.themeLight')}</button>
          <button aria-pressed={theme === 'dark'} onClick={() => theme !== 'dark' && toggleTheme()}>{t('userMenu.themeDark')}</button>
        </div>
      </Field>
      <Field label={t('userMenu.language')}>
        <div class="segmented">
          <button aria-pressed={locale === 'en'} onClick={() => setLocale('en' as Locale)}>EN</button>
          <button aria-pressed={locale === 'da'} onClick={() => setLocale('da' as Locale)}>DA</button>
        </div>
      </Field>
    </Section>
  );
}

function NotificationsSection() {
  const isDa = getLocale() === 'da';
  const [digest, setDigest] = useStored<'off' | 'daily' | 'weekly'>('trail.notify.digest', 'weekly');
  const [approvals, setApprovals] = useStored('trail.notify.approvals', true);
  const [lint, setLint] = useStored('trail.notify.lint', false);
  return (
    <Section
      id="notifications"
      title={t('accountPrefs.sections.notifications')}
      subtitle={isDa ? 'Hvornår Trail rækker ud. (Coming soon — backend ikke wired endnu.)' : 'When Trail reaches out. (Coming soon — backend not wired yet.)'}
    >
      <Field label={isDa ? 'Daglig opsummering' : 'Digest'}>
        <div class="segmented">
          <button aria-pressed={digest === 'off'} onClick={() => setDigest('off')}>{isDa ? 'Fra' : 'Off'}</button>
          <button aria-pressed={digest === 'daily'} onClick={() => setDigest('daily')}>{isDa ? 'Dagligt' : 'Daily'}</button>
          <button aria-pressed={digest === 'weekly'} onClick={() => setDigest('weekly')}>{isDa ? 'Ugentligt' : 'Weekly'}</button>
        </div>
      </Field>
      <Field label={isDa ? 'Kø-godkendelser' : 'Queue approvals'}>
        <Toggle on={approvals} onChange={setApprovals} />
      </Field>
      <Field label={isDa ? 'Lint-fund' : 'Lint findings'}>
        <Toggle on={lint} onChange={setLint} />
      </Field>
    </Section>
  );
}

function SessionsSection({ isDa }: { isDa: boolean }) {
  return (
    <Section
      id="sessions"
      title={t('accountPrefs.sections.sessions')}
      subtitle={isDa ? 'Steder du er logget ind. (Coming soon — backend ikke wired endnu.)' : 'Where you’re signed in. (Coming soon.)'}
    >
      <div
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--color-accent-soft)',
              color: 'var(--color-accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 auto',
            }}
          >
            <Icons.Monitor size={13} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{isDa ? 'Denne enhed' : 'This device'}</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9.5,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'var(--color-accent-soft)',
                  color: 'var(--color-fg)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {isDa ? 'aktiv' : 'current'}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          class="btn"
          disabled
          style={{ color: 'var(--color-danger)', borderColor: 'var(--color-border-strong)', opacity: 0.5 }}
          title={isDa ? 'Kommer snart — F186 follow-up' : 'Coming soon — F186 follow-up'}
        >
          {isDa ? 'Log ud alle andre sessions' : 'Sign out all other sessions'}
        </button>
      </div>
    </Section>
  );
}

function DeveloperSection({ isDa }: { isDa: boolean }) {
  return (
    <Section
      id="developer"
      title={isDa ? 'Personlige API-nøgler' : 'Personal API keys'}
      subtitle={isDa ? 'Bearer tokens bundet til DIN bruger på tværs af tenants. (F188 — Coming soon.)' : 'Bearer tokens bound to YOUR user across tenants. (F188 — Coming soon.)'}
    >
      <div
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '32px 24px',
          textAlign: 'center',
        }}
      >
        <Icons.CreditCard size={28} style={{ color: 'var(--color-fg-subtle)', marginBottom: 12 }} />
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, marginBottom: 6 }}>
          {isDa ? 'Kommer snart' : 'Coming soon'}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-fg-muted)', maxWidth: 380, margin: '0 auto', lineHeight: 1.5 }}>
          {isDa
            ? 'Personlige API-nøgler følger med F188. For tenant-niveau bearers, kontakt admin.'
            : 'Personal API keys are tracked under F188. For tenant-level bearers, contact admin.'}
        </div>
        <button type="button" class="btn btn-primary" disabled style={{ marginTop: 16, opacity: 0.5 }}>
          <Icons.Plus size={13} />
          <span>{isDa ? 'Generér ny nøgle' : 'Generate new key'}</span>
        </button>
      </div>
    </Section>
  );
}

function DangerSection({ isDa }: { isDa: boolean }) {
  return (
    <Section
      id="danger"
      title={t('accountPrefs.sections.danger')}
      subtitle={isDa ? 'Permanente handlinger. Kan ikke fortrydes uden support.' : 'Permanent actions. Cannot be undone without support intervention.'}
    >
      <div
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderLeft: '3px solid var(--color-danger)',
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-danger)' }}>
            {isDa ? 'Slet din bruger' : 'Delete your account'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--color-fg-muted)', marginTop: 4, maxWidth: 460, lineHeight: 1.5 }}>
            {isDa
              ? 'Du forlader alle tenants du er medlem af. Tenants du ejer skal forfremmes til en anden ejer eller arkiveres først.'
              : 'You leave every tenant you’re a member of. Tenants you own must be transferred to another owner or archived first.'}
          </div>
        </div>
        <button
          type="button"
          class="btn"
          disabled
          style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)', opacity: 0.5, flex: '0 0 auto' }}
          title={isDa ? 'Kommer snart — F186 follow-up' : 'Coming soon — F186 follow-up'}
        >
          {isDa ? 'Slet bruger…' : 'Delete account…'}
        </button>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers

function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: JSX.Element | JSX.Element[] }) {
  return (
    <section id={id} style={{ position: 'relative', paddingTop: 40, scrollMarginTop: 80 }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 22, letterSpacing: '-0.01em' }}>{title}</h2>
      {subtitle ? (
        <p style={{ margin: '6px 0 24px', fontSize: 12.5, color: 'var(--color-fg-muted)', maxWidth: 520, lineHeight: 1.55 }}>{subtitle}</p>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: JSX.Element | JSX.Element[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        gap: 24,
        padding: '16px 0',
        borderBottom: '1px solid var(--color-border)',
        alignItems: 'flex-start',
      }}
    >
      <div style={{ paddingTop: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {hint ? <div style={{ fontSize: 11.5, color: 'var(--color-fg-subtle)', marginTop: 4, lineHeight: 1.5 }}>{hint}</div> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      style={{
        position: 'relative',
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? 'var(--color-accent)' : 'var(--color-bg-sunk)',
        border: '1px solid ' + (on ? 'transparent' : 'var(--color-border-strong)'),
        transition: 'background var(--dur) var(--ease)',
        flex: '0 0 auto',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 1,
          left: on ? 17 : 1,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: 'var(--color-bg-card)',
          boxShadow: '0 1px 2px rgba(0,0,0,.18)',
          transition: 'left var(--dur) var(--ease)',
        }}
      />
    </button>
  );
}

function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  });
  function update(v: T) {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
  }
  return [value, update];
}
