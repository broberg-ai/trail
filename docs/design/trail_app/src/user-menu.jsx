// =====================================================================
// Trail — User menu (top-right)
// =====================================================================

const { useState: useState_UM, useEffect: useEffect_UM, useRef: useRef_UM } = React;

function UserMenu({ user, tenant, theme, locale, audio, onChange, t, isMobile, onSignOut, onSettings }) {
  const [open, setOpen] = useState_UM(false);
  const ref = useRef_UM(null);

  useEffect_UM(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // Plan caps (mock)
  const caps = { hobby: 50, starter: 200, pro: 5000 };
  const cap = caps[tenant.plan] || 200;
  const used = tenant.neurons;
  const pct = Math.min(100, (used / cap) * 100);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '4px 10px 4px 4px',
          borderRadius: 999,
          border: '1px solid var(--color-border)',
          background: open ? 'var(--color-active)' : 'transparent',
          transition: 'background var(--dur) var(--ease)',
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'var(--color-hover)'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}>
        <span className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{user.initials}</span>
        {!isMobile && <span style={{ fontSize: 13, fontWeight: 500 }}>{user.name.split(' ')[0]}</span>}
        <window.Icons.Chevron size={11} style={{ color: 'var(--color-fg-subtle)' }} />
      </button>

      {open && !isMobile && (
        <div className="menu anim-menu" role="menu" style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          width: 320, zIndex: 60,
        }}>
          <UserMenuBody user={user} tenant={tenant} theme={theme} locale={locale} audio={audio}
            onChange={onChange} t={t} pct={pct} used={used} cap={cap} onSignOut={onSignOut}
            onSettings={() => { setOpen(false); onSettings && onSettings(); }} />
        </div>
      )}

      {open && isMobile && (
        <window.MobileSheet onClose={() => setOpen(false)} title={user.name}>
          <UserMenuBody user={user} tenant={tenant} theme={theme} locale={locale} audio={audio}
            onChange={onChange} t={t} pct={pct} used={used} cap={cap} onSignOut={onSignOut}
            onSettings={() => { setOpen(false); onSettings && onSettings(); }} mobile />
        </window.MobileSheet>
      )}
    </div>
  );
}

function UserMenuBody({ user, tenant, theme, locale, audio, onChange, t, pct, used, cap, onSignOut, onSettings, mobile }) {
  return (
    <div>
      {/* Identity header */}
      <div style={{ padding: '14px 14px 12px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span className="avatar lg">{user.initials}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.2 }}>{user.name}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--color-fg-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.email}
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <window.Icons.Building size={11} style={{ color: 'var(--color-fg-subtle)' }} />
            <span style={{ fontSize: 11.5, color: 'var(--color-fg-muted)' }}>{tenant.name}</span>
            <span className={"plan-badge " + tenant.plan}>{tenant.plan}</span>
          </div>
        </div>
      </div>

      <div className="menu-sep" />

      {/* Settings link */}
      <button className="menu-item" style={{ padding: '8px 14px' }} onClick={onSettings}>
        <window.Icons.Settings size={14} style={{ color: 'var(--color-fg-subtle)' }} />
        <span>{t.settings}</span>
        <window.Icons.ChevronRight size={12} style={{ color: 'var(--color-fg-subtle)', marginLeft: 'auto' }} />
      </button>

      <div className="menu-sep" />

      {/* Personal preferences — relocated from top-bar */}
      <div style={{ padding: '8px 14px 4px' }}>
        <div className="menu-section" style={{ padding: '0 0 6px' }}>preferences</div>

        <PrefRow label={t.theme}>
          <div className="segmented">
            <button aria-pressed={theme === 'light'} onClick={() => onChange({ theme: 'light' })}>
              <window.Icons.Sun size={11} stroke={2} style={{ marginRight: 4, display: 'inline-block', verticalAlign: -1 }} />
              {t.light}
            </button>
            <button aria-pressed={theme === 'dark'} onClick={() => onChange({ theme: 'dark' })}>
              <window.Icons.Moon size={11} stroke={2} style={{ marginRight: 4, display: 'inline-block', verticalAlign: -1 }} />
              {t.dark}
            </button>
          </div>
        </PrefRow>

        <PrefRow label={t.locale}>
          <div className="segmented">
            <button aria-pressed={locale === 'en'} onClick={() => onChange({ locale: 'en' })}>EN</button>
            <button aria-pressed={locale === 'da'} onClick={() => onChange({ locale: 'da' })}>DA</button>
          </div>
        </PrefRow>

        <PrefRow label={t.audio}>
          <div className="segmented">
            <button aria-pressed={!audio} onClick={() => onChange({ audio: false })}>{t.off}</button>
            <button aria-pressed={audio} onClick={() => onChange({ audio: true })}>{t.on}</button>
          </div>
        </PrefRow>
      </div>

      <div className="menu-sep" />

      {/* Plan + usage */}
      <div style={{ padding: '10px 14px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11.5, color: 'var(--color-fg-muted)' }}>
            <span style={{ textTransform: 'capitalize' }}>{tenant.plan}</span> {t.plan.toLowerCase()}
          </span>
          <a href="#" style={{ fontSize: 11.5, color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}>
            {t.upgrade}
          </a>
        </div>
        <div style={{
          height: 4, borderRadius: 2,
          background: 'var(--color-bg-sunk)',
          overflow: 'hidden',
          border: '1px solid var(--color-border)',
        }}>
          <div style={{
            width: pct + '%', height: '100%',
            background: pct > 90 ? 'var(--color-danger)' : 'var(--color-accent)',
            transition: 'width 240ms var(--ease)',
          }} />
        </div>
        <div className="mono" style={{ marginTop: 6, fontSize: 10.5, color: 'var(--color-fg-subtle)' }}>
          {t.neuronsOf(used, cap)}
        </div>
      </div>

      <div className="menu-sep" />

      <div style={{ padding: 6 }}>
        <button className="menu-item is-danger" style={{ borderRadius: 'var(--radius-sm)' }} onClick={onSignOut}>
          <window.Icons.LogOut size={14} />
          <span>{t.signOut}</span>
        </button>
      </div>
    </div>
  );
}

function PrefRow({ label, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 0',
    }}>
      <span style={{ fontSize: 12.5, color: 'var(--color-fg-muted)' }}>{label}</span>
      {children}
    </div>
  );
}

window.UserMenu = UserMenu;
