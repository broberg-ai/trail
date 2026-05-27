// =====================================================================
// Trail — User Settings (reached from user-menu → Settings)
// USER-level only — tenant-level settings live under Manage Tenants.
// =====================================================================

const { useState: useState_ST } = React;

function UserSettings({ user, tenants, locale, theme, audio, onChange, t }) {
  const isDa = locale === 'da';

  // mock state
  const [displayName, setDisplayName]   = useState_ST(user.name);
  const [notifyDigest, setNotifyDigest] = useState_ST('weekly'); // off | daily | weekly
  const [notifyApprovals, setNotifyApprovals] = useState_ST(true);
  const [notifyLint, setNotifyLint]     = useState_ST(false);
  const [showAnchors, setShowAnchors]   = useState_ST(false);
  const [volume, setVolume]             = useState_ST(60);

  // mock sessions
  const sessions = [
    { id: 1, device: isDa ? 'Mac · Chrome · København' : 'Mac · Chrome · Copenhagen', current: true,  lastActive: isDa ? 'Lige nu'         : 'Just now' },
    { id: 2, device: isDa ? 'iPhone · Safari · iOS 17'  : 'iPhone · Safari · iOS 17',  current: false, lastActive: isDa ? 'For 3 timer siden' : '3 hours ago' },
    { id: 3, device: 'Mac · Chrome · 192.0.0.1',         current: false, lastActive: isDa ? 'For 4 dage siden'  : '4 days ago' },
  ];

  const apiKeys = [
    { name: 'cli-local',        prefix: 'tk_local_8af3',     created: '2026-04-30', lastUsed: '2026-05-20' },
    { name: 'github-action',    prefix: 'tk_ci_b9cc',        created: '2026-03-12', lastUsed: '2026-05-19' },
  ];

  return (
    <div style={{ position: 'relative', maxWidth: 760, margin: '0 auto', padding: '48px 32px 80px' }}>
      <div className="constellation" style={{ opacity: .35 }} />

      {/* Header */}
      <div style={{ position: 'relative', marginBottom: 40 }}>
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-fg-subtle)', marginBottom: 8 }}>
          {isDa ? 'Indstillinger' : 'Settings'}
        </div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 32, letterSpacing: '-0.015em' }}>
          {isDa ? 'Din konto' : 'Your account'}
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--color-fg-muted)', maxWidth: 540, lineHeight: 1.55 }}>
          {isDa
            ? 'Personlige præferencer der følger dig på tværs af tenants. Tenant-specifikke indstillinger (plan, API-nøgler, backup) finder du under Administrér tenants.'
            : 'Personal preferences that follow you across tenants. Tenant-specific settings (plan, API keys, backup) live under Manage tenants.'}
        </p>
      </div>

      {/* In-page section nav */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 5,
        background: 'var(--color-bg)',
        marginLeft: -32, paddingLeft: 32, marginRight: -32, paddingRight: 32,
        borderBottom: '1px solid var(--color-border)',
        marginBottom: 0,
      }}>
        <nav style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {[
            { id: 'profile',        label: isDa ? 'Profil'           : 'Profile' },
            { id: 'preferences',    label: isDa ? 'Præferencer'      : 'Preferences' },
            { id: 'notifications',  label: isDa ? 'Notifikationer'   : 'Notifications' },
            { id: 'sessions',       label: isDa ? 'Sessions'         : 'Sessions' },
            { id: 'developer',      label: isDa ? 'Udvikler'         : 'Developer' },
            { id: 'danger',         label: isDa ? 'Farezone'         : 'Danger' },
          ].map(s => (
            <a key={s.id} href={`#${s.id}`}
              style={{
                padding: '12px 10px',
                fontSize: 12.5, fontWeight: 400,
                color: 'var(--color-fg-muted)',
                borderBottom: '2px solid transparent',
                marginBottom: -1,
                textDecoration: 'none',
                transition: 'color var(--dur) var(--ease)',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--color-fg)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--color-fg-muted)'}>
              {s.label}
            </a>
          ))}
        </nav>
      </div>

      {/* PROFILE */}
      <Section id="profile" title={isDa ? 'Profil' : 'Profile'} subtitle={isDa ? 'Sådan vises du for andre i tenants du deler' : 'How you appear to other members in shared tenants'}>
        <Field label={isDa ? 'Avatar' : 'Avatar'} hint={isDa ? 'Genereres fra dine initialer. Upload kommer senere.' : 'Generated from your initials. Photo upload coming later.'}>
          <span className="avatar lg">{user.initials}</span>
        </Field>
        <Field label={isDa ? 'Visningsnavn' : 'Display name'}>
          <input className="input" value={displayName} onChange={e => setDisplayName(e.target.value)} style={{ maxWidth: 320 }} />
        </Field>
        <Field label={isDa ? 'E-mail' : 'Email'} hint={isDa ? 'Kommer fra Google. For at ændre, log ind med en anden Google-konto.' : 'From Google. To change, sign in with a different Google account.'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="mono" style={{ fontSize: 13 }}>{user.email}</span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              padding: '2px 7px', borderRadius: 999,
              background: 'rgba(21,128,61,.10)',
              color: 'var(--color-success)',
              border: '1px solid rgba(21,128,61,.20)',
            }}>{isDa ? 'verificeret' : 'verified'}</span>
          </div>
        </Field>
      </Section>

      {/* PREFERENCES */}
      <Section id="preferences" title={isDa ? 'Præferencer' : 'Preferences'} subtitle={isDa ? 'Tema, sprog og lyd. Synkroniseret med kontroller i bruger-menuen.' : 'Theme, language and audio. Synced with the user-menu controls.'}>
        <Field label={isDa ? 'Tema' : 'Theme'}>
          <div className="segmented">
            <button aria-pressed={theme === 'light'} onClick={() => onChange({ theme: 'light' })}>{isDa ? 'Lyst' : 'Light'}</button>
            <button aria-pressed={theme === 'dark'}  onClick={() => onChange({ theme: 'dark' })}>{isDa ? 'Mørkt' : 'Dark'}</button>
          </div>
        </Field>
        <Field label={isDa ? 'Sprog' : 'Language'} hint={isDa ? 'Sproget for admin-UI. Indhold i neuroner følger den enkelte trail.' : 'Language of the admin UI. Neuron content follows the per-trail setting.'}>
          <div className="segmented">
            <button aria-pressed={locale === 'en'} onClick={() => onChange({ locale: 'en' })}>EN</button>
            <button aria-pressed={locale === 'da'} onClick={() => onChange({ locale: 'da' })}>DA</button>
          </div>
        </Field>
        <Field label={isDa ? 'Ambient lyd' : 'Ambient audio'} hint={isDa ? 'Afspil ambient-loops mens du arbejder. Kun mens fanen er aktiv.' : 'Play ambient loops while you work. Only while the tab is active.'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div className="segmented">
              <button aria-pressed={!audio} onClick={() => onChange({ audio: false })}>{isDa ? 'Fra' : 'Off'}</button>
              <button aria-pressed={audio}  onClick={() => onChange({ audio: true })}>{isDa ? 'Til' : 'On'}</button>
            </div>
            {audio && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, maxWidth: 280 }}>
                <window.Icons.Volume size={14} style={{ color: 'var(--color-fg-subtle)' }} />
                <input type="range" min={0} max={100} value={volume} onChange={e => setVolume(+e.target.value)} style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 11, color: 'var(--color-fg-muted)', minWidth: 28, textAlign: 'right' }}>{volume}</span>
              </div>
            )}
          </div>
        </Field>
        <Field label={isDa ? 'Vis claim-anchors' : 'Show claim-anchors'} hint={isDa ? 'Små # ikoner foran hvert afsnit der linker til en stabil identifier (fx claim-0791f933). Slået fra som standard — slå til hvis du deep-linker til specifikke claims.' : 'Small # icons before each paragraph that link to a stable identifier (e.g. claim-0791f933). Off by default — turn on if you deep-link to specific claims.'}>
          <Toggle on={showAnchors} onChange={setShowAnchors} />
        </Field>
      </Section>

      {/* NOTIFICATIONS */}
      <Section id="notifications" title={isDa ? 'Notifikationer' : 'Notifications'} subtitle={isDa ? 'Hvornår Trail rækker ud. Per-tenant kan finjusteres på tenant-indstillinger.' : 'When Trail reaches out. Per-tenant overrides live on the tenant settings page.'}>
        <Field label={isDa ? 'Daglig opsummering' : 'Digest'} hint={isDa ? 'E-mail med aktivitet på tværs af dine tenants.' : 'Email summary of activity across your tenants.'}>
          <div className="segmented">
            <button aria-pressed={notifyDigest === 'off'}     onClick={() => setNotifyDigest('off')}>{isDa ? 'Fra' : 'Off'}</button>
            <button aria-pressed={notifyDigest === 'daily'}   onClick={() => setNotifyDigest('daily')}>{isDa ? 'Dagligt' : 'Daily'}</button>
            <button aria-pressed={notifyDigest === 'weekly'}  onClick={() => setNotifyDigest('weekly')}>{isDa ? 'Ugentligt' : 'Weekly'}</button>
          </div>
        </Field>
        <Field label={isDa ? 'Kø-godkendelser' : 'Queue approvals'} hint={isDa ? 'Ping når noget afventer din godkendelse i en trail du administrerer.' : 'Ping when something needs your approval in a trail you manage.'}>
          <Toggle on={notifyApprovals} onChange={setNotifyApprovals} />
        </Field>
        <Field label={isDa ? 'Lint-fund' : 'Lint findings'} hint={isDa ? 'Når scheduleren finder modsigelser eller forældreløse neuroner. Stille som standard — det er en daglig bunke, ikke en akut sag.' : 'When the scheduler finds contradictions or orphan neurons. Off by default — it\u2019s a daily pile, not an emergency.'}>
          <Toggle on={notifyLint} onChange={setNotifyLint} />
        </Field>
      </Section>

      {/* SESSIONS */}
      <Section id="sessions" title={isDa ? 'Aktive sessions' : 'Active sessions'} subtitle={isDa ? 'Steder du er logget ind. Log ud af alt for at tilbagekalde sessions.' : 'Where you\u2019re signed in. Use sign-out-everywhere to revoke them.'}>
        <div style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          {sessions.map((s, i) => (
            <div key={s.id} style={{
              padding: '14px 18px',
              display: 'flex', alignItems: 'center', gap: 14,
              borderBottom: i === sessions.length - 1 ? 'none' : '1px solid var(--color-border)',
            }}>
              <span style={{
                width: 28, height: 28, borderRadius: '50%',
                background: s.current ? 'var(--color-accent-soft)' : 'var(--color-bg-sunk)',
                color: s.current ? 'var(--color-accent)' : 'var(--color-fg-subtle)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                flex: '0 0 auto',
              }}>
                <window.Icons.Monitor size={13} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{s.device}</span>
                  {s.current && (
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 9.5,
                      padding: '1px 6px', borderRadius: 3,
                      background: 'var(--color-accent-soft)',
                      color: 'var(--color-fg)',
                      letterSpacing: '.04em', textTransform: 'uppercase',
                    }}>{isDa ? 'denne enhed' : 'this device'}</span>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)', marginTop: 2 }}>
                  {s.lastActive}
                </div>
              </div>
              {!s.current && (
                <button className="btn" style={{ padding: '5px 12px', fontSize: 12.5 }}>
                  {isDa ? 'Log ud' : 'Sign out'}
                </button>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn" style={{ color: 'var(--color-danger)', borderColor: 'var(--color-border-strong)' }}>
            {isDa ? 'Log ud alle andre sessions' : 'Sign out all other sessions'}
          </button>
        </div>
      </Section>

      {/* DEVELOPER */}
      <Section id="developer" title={isDa ? 'Personlige API-nøgler' : 'Personal API keys'} subtitle={isDa ? 'Bearer tokens bundet til DIN bruger på tværs af tenants. For tenant-niveau nøgler, se den enkelte tenant.' : 'Bearer tokens bound to YOUR user across tenants. For tenant-level keys, see the individual tenant.'}>
        <div style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1.5fr 1fr 1fr 64px',
            padding: '10px 18px',
            background: 'var(--color-bg-sunk)',
            borderBottom: '1px solid var(--color-border)',
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '.08em', textTransform: 'uppercase',
            color: 'var(--color-fg-subtle)', gap: 16,
          }}>
            <div>{isDa ? 'Navn' : 'Name'}</div>
            <div>{isDa ? 'Prefix' : 'Prefix'}</div>
            <div>{isDa ? 'Oprettet' : 'Created'}</div>
            <div>{isDa ? 'Sidst brugt' : 'Last used'}</div>
            <div></div>
          </div>
          {apiKeys.map((k) => (
            <div key={k.name} style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1.5fr 1fr 1fr 64px',
              padding: '12px 18px',
              gap: 16, alignItems: 'center',
              borderBottom: '1px solid var(--color-border)',
              fontSize: 13,
            }}>
              <div style={{ fontWeight: 500 }}>{k.name}</div>
              <div className="mono" style={{ fontSize: 11.5, color: 'var(--color-fg-muted)' }}>{k.prefix}…</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--color-fg-subtle)' }}>{k.created}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--color-fg-subtle)' }}>{k.lastUsed}</div>
              <div style={{ textAlign: 'right' }}>
                <button style={{ fontSize: 11.5, color: 'var(--color-danger)', padding: '4px 8px' }}>
                  {isDa ? 'Tilbagekald' : 'Revoke'}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary" style={{ padding: '8px 14px' }}>
            <window.Icons.Plus size={13} />
            <span>{isDa ? 'Generér ny nøgle' : 'Generate new key'}</span>
          </button>
        </div>
      </Section>

      {/* DANGER */}
      <Section id="danger" title={isDa ? 'Farezone' : 'Danger zone'} subtitle={isDa ? 'Permanente handlinger. Kan ikke fortrydes uden support.' : 'Permanent actions. Cannot be undone without support intervention.'}>
        <div style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderLeft: '3px solid var(--color-danger)',
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-danger)' }}>
              {isDa ? 'Slet din bruger' : 'Delete your account'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-fg-muted)', marginTop: 4, maxWidth: 460, lineHeight: 1.5 }}>
              {isDa
                ? 'Du forlader alle tenants du er medlem af. Tenants du ejer skal forfremmes til en anden ejer eller arkiveres først.'
                : 'You leave every tenant you\u2019re a member of. Tenants you own must be transferred to another owner or archived first.'}
            </div>
          </div>
          <button className="btn" style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)', flex: '0 0 auto' }}>
            {isDa ? 'Slet bruger…' : 'Delete account…'}
          </button>
        </div>
      </Section>
    </div>
  );
}

// -- helpers ----------------------------------------------------------

function Section({ id, title, subtitle, children }) {
  return (
    <section id={id} style={{ position: 'relative', paddingTop: 40, scrollMarginTop: 80 }}>
      <h2 style={{
        margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400,
        fontSize: 22, letterSpacing: '-0.01em',
      }}>{title}</h2>
      {subtitle && (
        <p style={{ margin: '6px 0 24px', fontSize: 12.5, color: 'var(--color-fg-muted)', maxWidth: 520, lineHeight: 1.55 }}>
          {subtitle}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {children}
      </div>
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gap: 24,
      padding: '16px 0',
      borderBottom: '1px solid var(--color-border)',
      alignItems: 'flex-start',
    }}>
      <div style={{ paddingTop: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 11.5, color: 'var(--color-fg-subtle)', marginTop: 4, lineHeight: 1.5 }}>
            {hint}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} role="switch" aria-checked={on}
      style={{
        position: 'relative',
        width: 36, height: 20, borderRadius: 999,
        background: on ? 'var(--color-accent)' : 'var(--color-bg-sunk)',
        border: '1px solid ' + (on ? 'transparent' : 'var(--color-border-strong)'),
        transition: 'background var(--dur) var(--ease)',
        flex: '0 0 auto',
      }}>
      <span style={{
        position: 'absolute',
        top: 1, left: on ? 17 : 1,
        width: 16, height: 16, borderRadius: '50%',
        background: 'var(--color-bg-card)',
        boxShadow: '0 1px 2px rgba(0,0,0,.18)',
        transition: 'left var(--dur) var(--ease)',
      }} />
    </button>
  );
}

window.UserSettings = UserSettings;
