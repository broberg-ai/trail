// =====================================================================
// Trail — Top-nav chrome
// =====================================================================

function TopNav({
  user, tenants, currentTenant, onSwitchTenant,
  theme, locale, audio, onChange,
  onOpenPalette, onSignOut, isMobile, t,
  showKbCrumb, kbName, onMobileMenu,
  onManageTenants, onOpenSettings,
}) {
  return (
    <header style={{
      position: 'relative', zIndex: 30,
      borderBottom: '1px solid var(--color-border)',
      background: 'var(--color-bg)',
      backdropFilter: 'saturate(140%)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: isMobile ? '10px 14px' : '12px 28px',
        gap: isMobile ? 8 : 14,
        minHeight: isMobile ? 52 : 60,
      }}>
        {/* LEFT CLUSTER: identity + location ------------------------------- */}
        <a href="#" style={{
          display: 'flex', alignItems: 'center', gap: 10,
          textDecoration: 'none', color: 'var(--color-fg)',
        }}>
          <window.TrailLogoSvg size={isMobile ? 24 : 28} />
          {!isMobile && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="wordmark">trail</span>
              <span className="wordmark-sub">admin</span>
            </div>
          )}
        </a>

        {/* Divider between identity and tenant pill */}
        {!isMobile && (
          <span style={{
            width: 1, height: 18,
            background: 'var(--color-border-strong)',
            opacity: .7,
            marginLeft: 4, marginRight: 4,
          }} />
        )}

        <window.TenantSwitcher
          tenants={tenants}
          currentSlug={currentTenant.slug}
          onSwitch={onSwitchTenant}
          onManageTenants={onManageTenants}
          t={t}
          isMobile={isMobile}
        />

        {/* KB crumb (when inside a trail) */}
        {showKbCrumb && !isMobile && (
          <>
            <span style={{ color: 'var(--color-fg-faint)', fontSize: 14 }}>/</span>
            <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>{kbName}</span>
          </>
        )}

        {/* SPACER ---------------------------------------------------------- */}
        <div style={{ flex: 1 }} />

        {/* CENTER: command-K affordance ------------------------------------ */}
        <button onClick={onOpenPalette}
          aria-label="Open command palette"
          style={{
            display: isMobile ? 'none' : 'inline-flex',
            alignItems: 'center', gap: 10,
            padding: '6px 10px 6px 12px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-sunk)',
            color: 'var(--color-fg-muted)',
            minWidth: 240, maxWidth: 320,
            fontSize: 12.5,
            transition: 'all var(--dur) var(--ease)',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.color = 'var(--color-fg)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-fg-muted)'; }}>
          <window.Icons.Search size={13} />
          <span style={{ flex: 1, textAlign: 'left' }}>{t.searchHint}</span>
          <span className="kbd">⌘K</span>
        </button>

        {/* MOBILE: search + menu trigger ----------------------------------- */}
        {isMobile && (
          <>
            <button className="icon-btn" onClick={onOpenPalette} aria-label="Search">
              <window.Icons.Search size={16} />
            </button>
            <button className="icon-btn" onClick={onMobileMenu} aria-label="Menu">
              <window.Icons.Menu size={16} />
            </button>
          </>
        )}

        {/* RIGHT CLUSTER: user --------------------------------------------- */}
        {!isMobile && (
          <window.UserMenu
            user={user}
            tenant={currentTenant}
            theme={theme}
            locale={locale}
            audio={audio}
            onChange={onChange}
            t={t}
            isMobile={isMobile}
            onSignOut={onSignOut}
            onSettings={onOpenSettings}
          />
        )}
      </div>
    </header>
  );
}

// Inner-trail sub-nav (the tab strip below the chrome).
// Out-of-scope for redesign but rendered for context.
function TrailSubNav({ kbName, t, locale }) {
  const tabsEn = ['Neurons', 'Graph', 'Queue', 'Chat', 'Search', 'Sources', 'Settings'];
  const tabsDa = ['Neuroner', 'Graf', 'Kø', 'Chat', 'Søg', 'Kilder', 'Indstillinger'];
  const tabs = (locale === 'da' ? tabsDa : tabsEn);
  const badges = { 'Queue': 68, 'Kø': 68 };

  return (
    <div style={{
      borderBottom: '1px solid var(--color-border)',
      padding: '0 28px',
      display: 'flex', alignItems: 'center', gap: 4,
      overflowX: 'auto',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        fontSize: 13, color: 'var(--color-fg-muted)',
        padding: '8px 0',
      }}>
        <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>{locale === 'da' ? 'Trails' : 'Trails'}</a>
        <span style={{ color: 'var(--color-fg-faint)', margin: '0 8px' }}>/</span>
        <span style={{ color: 'var(--color-fg)' }}>{kbName}</span>
      </div>
      <div style={{ flex: 1 }} />
      <nav style={{ display: 'flex', gap: 4, padding: '0 0' }}>
        {tabs.map((tab, i) => (
          <a key={tab} href="#" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '14px 12px 12px',
            fontSize: 13,
            color: i === 0 ? 'var(--color-fg)' : 'var(--color-fg-muted)',
            borderBottom: i === 0 ? '2px solid var(--color-accent)' : '2px solid transparent',
            textDecoration: 'none',
            transition: 'color var(--dur) var(--ease)',
          }}>
            {tab}
            {badges[tab] && (
              <span style={{
                background: 'var(--color-accent-soft)',
                color: 'var(--color-fg)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                padding: '1px 5px',
                borderRadius: 999,
              }}>{badges[tab]}</span>
            )}
          </a>
        ))}
      </nav>
    </div>
  );
}

window.TopNav = TopNav;
window.TrailSubNav = TrailSubNav;
