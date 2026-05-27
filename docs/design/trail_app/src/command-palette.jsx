// =====================================================================
// Trail — Command palette (Cmd+K) — Linear-style
// =====================================================================

const { useState: useState_CP, useEffect: useEffect_CP, useRef: useRef_CP, useMemo: useMemo_CP } = React;

function CommandPalette({ open, onClose, tenant, trails, neurons, tenants, currentTenantSlug, onNavigate, onSwitchTenant, t }) {
  const [q, setQ] = useState_CP('');
  const [selected, setSelected] = useState_CP(0);
  const inputRef = useRef_CP(null);

  useEffect_CP(() => {
    if (open) { setQ(''); setSelected(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  // Build flat groups
  const groups = useMemo_CP(() => {
    const s = q.toLowerCase().trim();
    const otherTenants = tenants.filter(tn => tn.slug !== currentTenantSlug);

    const actions = [
      { id: 'a-new-trail',   label: t.newTrail,                 hint: tenant.name, icon: 'Plus' },
      { id: 'a-new-neuron',  label: q ? `Create neuron "${q}"` : 'Create neuron', icon: 'FileText' },
      { id: 'a-chat',        label: 'Open chat',                hint: tenant.name, icon: 'MessageSquare' },
      { id: 'a-upload',      label: 'Upload source…',           hint: tenant.name, icon: 'Upload' },
      { id: 'a-settings',    label: t.settings,                 icon: 'Settings' },
    ];

    let g = [];
    const filt = (arr, key) => arr.filter(x => !s || x[key].toLowerCase().includes(s));

    if (neurons.length) g.push({ title: t.cpRecent, items: filt(neurons.map(n => ({
      id: 'n-' + n.slug, label: n.title, hint: n.trail, icon: 'FileText', meta: n.tags?.[0],
    })), 'label')});
    if (trails.length) g.push({ title: t.cpTrails, items: filt(trails.map(tr => ({
      id: 't-' + tr.slug, label: tr.name, hint: `${tr.neurons} neurons`, icon: 'Network',
    })), 'label')});
    g.push({ title: t.cpActions, items: filt(actions, 'label') });
    if (otherTenants.length) g.push({ title: t.cpTenants, items: filt(otherTenants.map(tn => ({
      id: 'sw-' + tn.slug, label: tn.name, hint: tn.slug, icon: 'Building', meta: tn.plan,
    })), 'label')});

    g = g.filter(grp => grp.items.length > 0);
    return g;
  }, [q, tenant, trails, neurons, tenants, currentTenantSlug, t]);

  const flat = useMemo_CP(() => groups.flatMap(g => g.items.map(it => ({ ...it, group: g.title }))), [groups]);

  useEffect_CP(() => { setSelected(0); }, [q]);

  useEffect_CP(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(flat.length - 1, s + 1)); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(0, s - 1)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const item = flat[selected];
        if (!item) return;
        if (item.id.startsWith('sw-')) onSwitchTenant(item.id.slice(3));
        else if (item.id.startsWith('n-') || item.id.startsWith('t-')) onNavigate(item);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flat, selected, onClose, onNavigate, onSwitchTenant]);

  if (!open) return null;

  let runningIdx = -1;

  return (
    <div className="anim-fade" style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(26,23,21,.36)',
      backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '12vh', paddingLeft: 16, paddingRight: 16,
    }} onClick={onClose}>
      <div className="menu anim-palette" onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 620,
          boxShadow: 'var(--shadow-xl)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'min(560px, 70vh)',
        }}>
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <window.Icons.Search size={16} style={{ color: 'var(--color-fg-subtle)' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t.searchHint}
            style={{
              flex: 1, border: 0, outline: 'none', background: 'transparent',
              color: 'var(--color-fg)', font: 'inherit', fontSize: 14,
            }}
          />
          <button onClick={onClose}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10.5,
              padding: '2px 6px', borderRadius: 4,
              color: 'var(--color-fg-subtle)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-sunk)',
            }}>esc</button>
        </div>

        {/* Result groups */}
        <div className="scroll-y" style={{ flex: 1, padding: '6px 0' }}>
          {flat.length === 0 && (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-fg-subtle)', fontSize: 13 }}>
              {t.cpEmpty}
            </div>
          )}
          {groups.map((grp, gi) => (
            <div key={gi}>
              <div className="menu-section">{grp.title}</div>
              {grp.items.map(it => {
                runningIdx++;
                const isSel = runningIdx === selected;
                const IconComp = window.Icons[it.icon] || window.Icons.FileText;
                return (
                  <button key={it.id}
                    className="menu-item"
                    data-highlighted={isSel}
                    onMouseEnter={() => setSelected(flat.findIndex(f => f.id === it.id))}
                    onClick={() => {
                      if (it.id.startsWith('sw-')) onSwitchTenant(it.id.slice(3));
                      else if (it.id.startsWith('n-') || it.id.startsWith('t-')) onNavigate(it);
                      onClose();
                    }}
                    style={{
                      padding: '8px 16px',
                      borderLeft: isSel ? '2px solid var(--color-accent)' : '2px solid transparent',
                      paddingLeft: 14,
                    }}>
                    <IconComp size={14} style={{ color: 'var(--color-fg-subtle)' }} />
                    <span style={{ flex: 1, textAlign: 'left', fontSize: 13 }}>{it.label}</span>
                    {it.meta && <span className={"plan-badge " + (it.meta || '')}>{it.meta}</span>}
                    {it.hint && (
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)' }}>
                        {it.hint}
                      </span>
                    )}
                    {isSel && <window.Icons.CornerDownLeft size={12} style={{ color: 'var(--color-fg-subtle)' }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hints */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-bg-sunk)',
          display: 'flex', alignItems: 'center', gap: 16,
          fontSize: 11, color: 'var(--color-fg-muted)',
        }}>
          <HintRow keys={['↑', '↓']}>{t.cpNavigate}</HintRow>
          <HintRow keys={['↵']}>{t.cpSelect}</HintRow>
          <HintRow keys={['esc']}>{t.cpClose}</HintRow>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <window.Icons.Sparkles size={12} style={{ color: 'var(--color-accent)' }} />
            <span className="mono" style={{ fontSize: 10.5 }}>{tenant.name}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HintRow({ keys, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {keys.map((k, i) => <span key={i} className="kbd">{k}</span>)}
      <span>{children}</span>
    </span>
  );
}

window.CommandPalette = CommandPalette;
