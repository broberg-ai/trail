// =====================================================================
// Trail Admin — root app
// =====================================================================

const { useState: useState_App, useEffect: useEffect_App, useMemo: useMemo_App } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "locale": "en",
  "audio": false,
  "view": "tenants",
  "tenant": "sanne-andersen",
  "loginState": "cold",
  "emptyState": "none",
  "mobile": false,
  "showAnnotations": false
}/*EDITMODE-END*/;

function App() {
  const t0 = window.useTweaks(TWEAK_DEFAULTS);
  const tweaks = t0[0];
  const setTweak = t0[1];
  window.__trailTweaks = tweaks;
  window.__trailSetTweak = setTweak;

  // Local state (kept in sync with tweaks where it matters)
  const [view, setView] = useState_App(tweaks.view); // 'login' | 'home' | 'trail'
  const [authState, setAuthState] = useState_App('cold'); // for the login screen
  const [paletteOpen, setPaletteOpen] = useState_App(false);
  const [mobileMenu, setMobileMenu] = useState_App(false);
  const [activeTrailTab, setActiveTrailTab] = useState_App('neurons');

  useEffect_App(() => setView(tweaks.view), [tweaks.view]);
  useEffect_App(() => {
    document.documentElement.dataset.theme = tweaks.theme;
  }, [tweaks.theme]);

  const t = window.TRAIL_STRINGS[tweaks.locale] || window.TRAIL_STRINGS.en;

  const currentTenant = window.TRAIL_TENANTS.find(x => x.slug === tweaks.tenant) || window.TRAIL_TENANTS[0];
  const trails = window.TRAIL_TRAILS_BY_TENANT[currentTenant.slug] || [];

  // Cmd-K keyboard handler
  useEffect_App(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(p => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleTweakChange = (patch) => {
    Object.entries(patch).forEach(([k, v]) => setTweak(k, v));
  };

  const goToView = (v) => {
    setView(v);
    setTweak('view', v);
  };

  const onSignedIn = () => goToView('home');
  const onSignOut = () => { setAuthState('cold'); goToView('login'); };

  const onSwitchTenant = (slug) => {
    setTweak('tenant', slug);
    // Always land on home after switch (matches expected behavior)
    goToView('home');
  };

  const isMobile = tweaks.mobile;

  // Container — when mobile is forced, wrap in a phone-like frame
  const root = (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
    }}>
      {view === 'login' && (
        <window.LoginScreen
          t={t}
          initialState={tweaks.loginState || 'cold'}
          onSignedIn={onSignedIn}
        />
      )}

      {view !== 'login' && (
        <>
          <window.TopNav
            user={window.TRAIL_USER}
            tenants={window.TRAIL_TENANTS}
            currentTenant={currentTenant}
            onSwitchTenant={onSwitchTenant}
            theme={tweaks.theme}
            locale={tweaks.locale}
            audio={tweaks.audio}
            onChange={handleTweakChange}
            onOpenPalette={() => setPaletteOpen(true)}
            onSignOut={onSignOut}
            isMobile={isMobile}
            t={t}
            showKbCrumb={false}
            kbName={view === 'trail' ? (trails[0]?.name || currentTenant.name) : ''}
            onMobileMenu={() => setMobileMenu(true)}
            onManageTenants={() => goToView('tenants')}
            onOpenSettings={() => goToView('settings')}
          />

          {view === 'trail' ? (
            <main style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
              {!isMobile && (
                <window.TrailSidebar
                  trail={trails[0] || { name: currentTenant.name, slug: currentTenant.slug }}
                  tenant={currentTenant}
                  locale={tweaks.locale}
                  active={activeTrailTab}
                  onSelect={(id) => setActiveTrailTab(id)}
                  onBack={() => goToView('home')}
                  t={t}
                />
              )}
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <window.TrailMainPane
                  active={activeTrailTab}
                  trail={trails[0] || currentTenant}
                  locale={tweaks.locale}
                />
              </div>
            </main>
          ) : view === 'tenants' ? (
            <main style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
              <window.ManageTenants
                user={window.TRAIL_USER}
                tenants={window.TRAIL_TENANTS}
                currentSlug={currentTenant.slug}
                onSwitch={onSwitchTenant}
                locale={tweaks.locale}
                t={t}
              />
            </main>
          ) : view === 'settings' ? (
            <main style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
              <window.UserSettings
                user={window.TRAIL_USER}
                tenants={window.TRAIL_TENANTS}
                locale={tweaks.locale}
                theme={tweaks.theme}
                audio={tweaks.audio}
                onChange={handleTweakChange}
                t={t}
              />
            </main>
          ) : (
            <main style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
              <window.HomeView
                tenant={currentTenant}
                trails={trails}
                emptyState={tweaks.emptyState}
                t={t}
                locale={tweaks.locale}
                onOpenTrail={() => goToView('trail')}
              />
            </main>
          )}

        </>
      )}

      <window.CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tenant={currentTenant}
        trails={trails}
        neurons={window.TRAIL_RECENT_NEURONS}
        tenants={window.TRAIL_TENANTS}
        currentTenantSlug={currentTenant.slug}
        onNavigate={(item) => goToView('trail')}
        onSwitchTenant={onSwitchTenant}
        t={t}
      />

      {/* Mobile menu sheet — collapsed top-bar items */}
      {mobileMenu && (
        <window.MobileSheet onClose={() => setMobileMenu(false)} title={window.TRAIL_USER.name}>
          <MobileMenuBody user={window.TRAIL_USER} tenant={currentTenant}
            theme={tweaks.theme} locale={tweaks.locale} audio={tweaks.audio}
            onChange={handleTweakChange} t={t} onSignOut={() => { setMobileMenu(false); onSignOut(); }} />
        </window.MobileSheet>
      )}

      <TrailTweaksInline tweaks={tweaks} setTweak={setTweak} />
    </div>
  );

  // If mobile-mode tweak is on, render inside a phone-shaped frame for the prototype
  if (isMobile) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-bg-sunk)',
        padding: 24,
      }}>
        <div style={{
          width: 390, height: 'min(840px, 92vh)',
          border: '8px solid var(--color-fg)',
          borderRadius: 44,
          overflow: 'hidden',
          background: 'var(--color-bg)',
          boxShadow: 'var(--shadow-xl)',
          position: 'relative',
        }}>
          {root}
        </div>
      </div>
    );
  }

  return root;
}

function MobileMenuBody({ user, tenant, theme, locale, audio, onChange, t, onSignOut }) {
  return (
    <div>
      <div style={{ padding: '4px 16px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
        <span className="avatar lg">{user.initials}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{user.name}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--color-fg-muted)' }}>{user.email}</div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'var(--color-fg-muted)' }}>{tenant.name}</span>
            <span className={"plan-badge " + tenant.plan}>{tenant.plan}</span>
          </div>
        </div>
      </div>

      <div className="menu-sep" />

      <button className="menu-item" style={{ padding: '12px 16px' }}>
        <window.Icons.Settings size={14} style={{ color: 'var(--color-fg-subtle)' }} />
        <span>{t.settings}</span>
      </button>

      <div className="menu-sep" />

      <div style={{ padding: '10px 16px 6px' }}>
        <div className="menu-section" style={{ padding: 0, marginBottom: 8 }}>preferences</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
          <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>{t.theme}</span>
          <div className="segmented">
            <button aria-pressed={theme === 'light'} onClick={() => onChange({ theme: 'light' })}>{t.light}</button>
            <button aria-pressed={theme === 'dark'} onClick={() => onChange({ theme: 'dark' })}>{t.dark}</button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
          <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>{t.locale}</span>
          <div className="segmented">
            <button aria-pressed={locale === 'en'} onClick={() => onChange({ locale: 'en' })}>EN</button>
            <button aria-pressed={locale === 'da'} onClick={() => onChange({ locale: 'da' })}>DA</button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
          <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>{t.audio}</span>
          <div className="segmented">
            <button aria-pressed={!audio} onClick={() => onChange({ audio: false })}>{t.off}</button>
            <button aria-pressed={audio} onClick={() => onChange({ audio: true })}>{t.on}</button>
          </div>
        </div>
      </div>

      <div className="menu-sep" />

      <div style={{ padding: 8 }}>
        <button className="menu-item is-danger" style={{ borderRadius: 'var(--radius-sm)', padding: '12px 14px' }} onClick={onSignOut}>
          <window.Icons.LogOut size={14} />
          <span>{t.signOut}</span>
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Tweaks UI — rendered inside App so it shares state via props
// =====================================================================
function TrailTweaksInline({ tweaks, setTweak }) {
  const TP = window.TweaksPanel;
  const TS = window.TweakSection;
  const TR = window.TweakRadio;
  const TT = window.TweakToggle;
  const TSel = window.TweakSelect;
  if (!TP) return null;

  return (
    <TP title="Trail prototype">
      <TS label="View" />
      <TR label="Screen" value={tweaks.view} onChange={(v) => setTweak('view', v)}
        options={[
          { value: 'login', label: 'Login' },
          { value: 'home', label: 'Home' },
          { value: 'trail', label: 'Trail' },
          { value: 'tenants', label: 'Tenants' },
          { value: 'settings', label: 'Settings' },
        ]} />
      <TR label="Login state" value={tweaks.loginState} onChange={(v) => setTweak('loginState', v)}
        options={[
          { value: 'cold', label: 'Cold' },
          { value: 'error', label: 'Error' },
        ]} />

      <TS label="Tenant" />
      <TSel label="Active" value={tweaks.tenant} onChange={(v) => setTweak('tenant', v)}
        options={window.TRAIL_TENANTS.map(t => ({ value: t.slug, label: `${t.name} · ${t.plan}` }))} />

      <TS label="Empty state" />
      <TR label="State" value={tweaks.emptyState} onChange={(v) => setTweak('emptyState', v)}
        options={[
          { value: 'none', label: 'Normal' },
          { value: 'no-trails', label: 'No trails' },
          { value: 'no-tenants', label: 'No tenants' },
        ]} />

      <TS label="Appearance" />
      <TR label="Theme" value={tweaks.theme} onChange={(v) => setTweak('theme', v)}
        options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      <TR label="Locale" value={tweaks.locale} onChange={(v) => setTweak('locale', v)}
        options={[{ value: 'en', label: 'EN' }, { value: 'da', label: 'DA' }]} />
      <TT label="Mobile viewport" value={tweaks.mobile} onChange={(v) => setTweak('mobile', v)} />
    </TP>
  );
}

window.TrailApp = App;
