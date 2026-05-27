// =====================================================================
// Trail — Tenant switcher (next to logo)
// =====================================================================

const { useState: useState_TS, useEffect: useEffect_TS, useRef: useRef_TS, useMemo: useMemo_TS } = React;

function TenantSwitcher({ tenants, currentSlug, onSwitch, t, isMobile, onManageTenants }) {
  const [open, setOpen] = useState_TS(false);
  const [q, setQ] = useState_TS('');
  const ref = useRef_TS(null);
  const inputRef = useRef_TS(null);

  const current = tenants.find(x => x.slug === currentSlug) || tenants[0];

  useEffect_TS(() => {
    if (!open) { setQ(''); return; }
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    if (tenants.length > 8) setTimeout(() => inputRef.current?.focus(), 80);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const filtered = useMemo_TS(() => {
    if (!q) return tenants;
    const s = q.toLowerCase();
    return tenants.filter(t => t.name.toLowerCase().includes(s) || t.slug.toLowerCase().includes(s));
  }, [q, tenants]);

  const searchable = tenants.length > 8;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '5px 8px 5px 10px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--color-border)',
          background: open ? 'var(--color-active)' : 'transparent',
          color: 'var(--color-fg)',
          fontSize: 13, fontWeight: 500,
          maxWidth: isMobile ? 160 : 240,
          transition: 'background var(--dur) var(--ease), border-color var(--dur) var(--ease)',
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'var(--color-hover)'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, borderRadius: 4,
          background: 'var(--color-accent-soft)',
          color: 'var(--color-accent)',
          flex: '0 0 auto',
        }}>
          <window.Icons.Building size={11} stroke={2} />
        </span>
        <span style={{
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: isMobile ? 100 : 180,
        }}>{current.name}</span>
        <window.Icons.Chevron size={12} style={{ color: 'var(--color-fg-subtle)', flex: '0 0 auto' }} />
      </button>

      {open && !isMobile && (
        <div className="menu anim-menu" role="listbox" style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          minWidth: 320, maxHeight: 480, zIndex: 60,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '10px 14px 8px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--color-border)',
          }}>
            <div className="menu-section" style={{ padding: 0 }}>{t.tenantSwitcherHeading}</div>
            <span className="mono" style={{ fontSize: 10, color: 'var(--color-fg-subtle)' }}>
              {tenants.length}
            </span>
          </div>

          {searchable && (
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ position: 'relative' }}>
                <window.Icons.Search size={13} style={{
                  position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--color-fg-subtle)'
                }} />
                <input
                  ref={inputRef}
                  className="input"
                  placeholder={t.tenantSearch}
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  style={{ padding: '6px 10px 6px 28px', fontSize: 12.5 }}
                />
              </div>
            </div>
          )}

          <div className="scroll-y" style={{ flex: 1, maxHeight: 320, padding: '4px 0' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '24px 14px', color: 'var(--color-fg-subtle)', fontSize: 12.5, textAlign: 'center' }}>
                {t.cpEmpty}
              </div>
            )}
            {filtered.map(tn => (
              <button key={tn.slug}
                className={"menu-item" + (tn.slug === currentSlug ? " is-active" : "")}
                onClick={() => { onSwitch(tn.slug); setOpen(false); }}
                style={{ padding: '8px 14px', gap: 10 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: 5,
                  background: tn.slug === currentSlug ? 'var(--color-accent)' : 'var(--color-bg-sunk)',
                  color: tn.slug === currentSlug ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                  flex: '0 0 auto',
                }}>
                  {tn.name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase().slice(0,2)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 13, fontWeight: tn.slug === currentSlug ? 500 : 400,
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tn.name}
                    </span>
                    <span className={"plan-badge " + tn.plan}>{tn.plan}</span>
                  </div>
                  <div className="mono" style={{
                    fontSize: 10.5, color: 'var(--color-fg-subtle)', marginTop: 2,
                  }}>
                    {tn.slug} · {tn.trails} {tn.trails === 1 ? 'trail' : 'trails'} · {tn.neurons} neurons
                  </div>
                </div>
                {tn.slug === currentSlug && (
                  <window.Icons.Check size={14} style={{ color: 'var(--color-accent)', flex: '0 0 auto' }} />
                )}
              </button>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--color-border)', padding: '6px' }}>
            <button className="menu-item" style={{ borderRadius: 'var(--radius-sm)', fontSize: 12.5 }}
              onClick={() => { setOpen(false); onManageTenants && onManageTenants(); }}>
              <window.Icons.Settings size={13} style={{ color: 'var(--color-fg-subtle)' }} />
              <span>{t.manageTenants}</span>
            </button>
          </div>
        </div>
      )}

      {/* Mobile bottom-sheet */}
      {open && isMobile && (
        <MobileSheet onClose={() => setOpen(false)} title={t.tenantSwitcherHeading}>
          {searchable && (
            <div style={{ padding: '0 16px 12px' }}>
              <div style={{ position: 'relative' }}>
                <window.Icons.Search size={13} style={{
                  position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--color-fg-subtle)'
                }} />
                <input className="input" placeholder={t.tenantSearch} value={q}
                  onChange={e => setQ(e.target.value)} style={{ padding: '8px 10px 8px 28px' }} />
              </div>
            </div>
          )}
          {filtered.map(tn => (
            <button key={tn.slug}
              className={"menu-item" + (tn.slug === currentSlug ? " is-active" : "")}
              onClick={() => { onSwitch(tn.slug); setOpen(false); }}
              style={{ padding: '12px 16px', gap: 12 }}>
              <span style={{
                width: 28, height: 28, borderRadius: 6,
                background: tn.slug === currentSlug ? 'var(--color-accent)' : 'var(--color-bg-sunk)',
                color: tn.slug === currentSlug ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
              }}>
                {tn.name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase().slice(0,2)}
              </span>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{tn.name}</span>
                  <span className={"plan-badge " + tn.plan}>{tn.plan}</span>
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)', marginTop: 2 }}>
                  {tn.trails} trails · {tn.neurons} neurons
                </div>
              </div>
              {tn.slug === currentSlug && <window.Icons.Check size={14} style={{ color: 'var(--color-accent)' }} />}
            </button>
          ))}
          <button className="menu-item" style={{ padding: '14px 16px', borderTop: '1px solid var(--color-border)', marginTop: 6 }}
            onClick={() => { setOpen(false); onManageTenants && onManageTenants(); }}>
            <window.Icons.Settings size={14} style={{ color: 'var(--color-fg-subtle)' }} />
            <span>{t.manageTenants}</span>
          </button>
        </MobileSheet>
      )}
    </div>
  );
}

// Re-usable mobile bottom-sheet
function MobileSheet({ children, onClose, title }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(26,23,21,.4)',
    }} onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--color-bg-card)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
        <div style={{
          padding: '14px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{ fontWeight: 500, fontSize: 14 }}>{title}</div>
          <button className="icon-btn" onClick={onClose}>
            <window.Icons.X size={16} />
          </button>
        </div>
        <div className="scroll-y" style={{ flex: 1, padding: '8px 0' }}>
          {children}
        </div>
        <div style={{ height: 'env(safe-area-inset-bottom)' }} />
      </div>
    </div>
  );
}

window.TenantSwitcher = TenantSwitcher;
window.MobileSheet = MobileSheet;
