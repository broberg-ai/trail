// =====================================================================
// Trail — Inner-trail sidebar (the "click into a trail" view)
// Replaces the 11-tab horizontal strip with a grouped sidebar.
// =====================================================================

const { useState: useState_IT } = React;

const TRAIL_NAV_EN = [
  { group: 'Use',
    items: [
      { id: 'chat',    label: 'Chat',     icon: 'MessageSquare' },
      { id: 'search',  label: 'Search',   icon: 'Search' },
    ],
  },
  { group: 'Canon',
    items: [
      { id: 'neurons', label: 'Neurons',  icon: 'FileText',  count: 76 },
      { id: 'graph',   label: 'Graph',    icon: 'Network' },
    ],
  },
  { group: 'Pipeline',
    items: [
      { id: 'queue',   label: 'Queue',    icon: 'Inbox',     count: 68, attention: true },
      { id: 'work',    label: 'Work',     icon: 'Cpu' },
      { id: 'links',   label: 'Links',    icon: 'ArrowUpRight', count: 3, attention: true },
    ],
  },
  { group: 'Inputs',
    items: [
      { id: 'sources', label: 'Sources',  icon: 'Upload',    count: 12 },
      { id: 'images',  label: 'Images',   icon: 'FileText' },
    ],
  },
];

const TRAIL_NAV_DA = [
  { group: 'Brug',
    items: [
      { id: 'chat',    label: 'Chat',          icon: 'MessageSquare' },
      { id: 'search',  label: 'Søg',           icon: 'Search' },
    ],
  },
  { group: 'Kanon',
    items: [
      { id: 'neurons', label: 'Neuroner',      icon: 'FileText',     count: 76 },
      { id: 'graph',   label: 'Graf',          icon: 'Network' },
    ],
  },
  { group: 'Pipeline',
    items: [
      { id: 'queue',   label: 'Kø',            icon: 'Inbox',        count: 68, attention: true },
      { id: 'work',    label: 'Arbejde',       icon: 'Cpu' },
      { id: 'links',   label: 'Links',         icon: 'ArrowUpRight', count: 3,  attention: true },
    ],
  },
  { group: 'Input',
    items: [
      { id: 'sources', label: 'Kilder',        icon: 'Upload',       count: 12 },
      { id: 'images',  label: 'Billeder',      icon: 'FileText' },
    ],
  },
];

function TrailSidebar({ trail, tenant, locale, active = 'neurons', onSelect, onBack, t }) {
  const groups = locale === 'da' ? TRAIL_NAV_DA : TRAIL_NAV_EN;
  const settingsLabel = locale === 'da' ? 'Indstillinger' : 'Settings';
  const costLabel     = locale === 'da' ? 'Omkostning'   : 'Cost';
  const backLabel     = locale === 'da' ? 'Trails'       : 'Trails';

  return (
    <aside style={{
      width: 240, flex: '0 0 240px',
      borderRight: '1px solid var(--color-border)',
      background: 'var(--color-bg)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header — trail identity */}
      <div style={{
        padding: '14px 16px 14px',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <button onClick={onBack}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, color: 'var(--color-fg-muted)',
            padding: '2px 4px 2px 0', borderRadius: 4,
            marginBottom: 8,
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-fg)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--color-fg-muted)'}>
          <window.Icons.Chevron size={11} style={{ transform: 'rotate(90deg)' }} />
          <span>{backLabel}</span>
        </button>
        <div style={{
          fontFamily: 'var(--font-serif)', fontWeight: 400,
          fontSize: 17, letterSpacing: '-0.01em', lineHeight: 1.2,
        }}>{trail.name}</div>
        <div className="mono" style={{
          fontSize: 10.5, color: 'var(--color-fg-subtle)',
          marginTop: 4, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
            background: 'var(--color-success)',
          }} />
          <span>{trail.slug}</span>
        </div>
      </div>

      {/* Groups */}
      <nav className="scroll-y" style={{ flex: 1, padding: '8px 8px 0' }}>
        {groups.map((grp) => (
          <div key={grp.group} style={{ marginBottom: 14 }}>
            <div className="menu-section" style={{ padding: '6px 8px 4px' }}>
              {grp.group}
            </div>
            {grp.items.map((it) => (
              <SidebarItem
                key={it.id} item={it}
                active={active === it.id}
                onClick={() => onSelect && onSelect(it.id)}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Footer — admin items */}
      <div style={{ padding: 8, borderTop: '1px solid var(--color-border)' }}>
        <SidebarItem
          item={{ id: 'cost', label: costLabel, icon: 'CreditCard' }}
          active={active === 'cost'}
          onClick={() => onSelect && onSelect('cost')}
          dim
        />
        <SidebarItem
          item={{ id: 'settings', label: settingsLabel, icon: 'Settings' }}
          active={active === 'settings'}
          onClick={() => onSelect && onSelect('settings')}
          dim
        />
      </div>
    </aside>
  );
}

function SidebarItem({ item, active, onClick, dim }) {
  const IconComp = window.Icons[item.icon] || window.Icons.FileText;
  return (
    <button onClick={onClick}
      className={"sidebar-item" + (active ? " is-active" : "") + (dim ? " is-dim" : "")}>
      {active && <span className="sidebar-item__bar" />}
      <IconComp size={14} className="sidebar-item__icon" style={{ flex: '0 0 auto' }} />
      <span className="sidebar-item__label">
        {item.label}
      </span>
      {item.count != null && (
        <span className={"sidebar-item__count" + (item.attention ? " is-attention" : "")}>
          {item.count}
        </span>
      )}
    </button>
  );
}

// =====================================================================
// Inner-trail main pane — example content (Chat / Neurons preview)
// =====================================================================
function TrailMainPane({ active, trail, locale }) {
  if (active === 'chat')    return <TrailChatPane locale={locale} trail={trail} />;
  if (active === 'queue')   return <TrailQueuePane locale={locale} trail={trail} />;
  return <TrailNeuronsPane locale={locale} trail={trail} />;
}

function TrailNeuronsPane({ locale, trail }) {
  const isDa = locale === 'da';
  const neurons = [
    { tag: null,        title: isDa ? 'Sanne'           : 'Sanne',           file: 'sanne_00000001.md',   v: 'v20' },
    { tag: null,        title: isDa ? 'Log'             : 'Log',             file: 'log.md',              v: 'v3' },
    { tag: null,        title: isDa ? 'Ordliste'        : 'Glossary',        file: 'glossary.md',         v: 'v4' },
    { tag: 'concept',   title: isDa ? 'NADA-protokollen': 'NADA protocol',   file: 'nada_protokol.md',    v: 'v8' },
    { tag: 'concept',   title: isDa ? 'Hjertechakraet'  : 'Heart chakra',    file: 'hjertechakraet.md',   v: 'v3' },
    { tag: 'concept',   title: isDa ? 'Fennikel'        : 'Fennel',          file: 'fennikel.md',         v: 'v2' },
    { tag: 'concept',   title: isDa ? 'Magnesium'       : 'Magnesium',       file: 'magnesium.md',        v: 'v4' },
  ];
  return (
    <div style={{ position: 'relative', padding: '32px 36px', maxWidth: 920, height: '100%', overflow: 'auto' }}>
      <div className="constellation" style={{ opacity: .35 }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 28, letterSpacing: '-0.015em' }}>
            {isDa ? 'Neuroner' : 'Neurons'}
          </h1>
          <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--color-fg-muted)' }}>
            {isDa ? '76 neuroner' : '76 neurons'} · {isDa ? 'sorteret efter aktivitet' : 'sorted by activity'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase' }}>
            {isDa ? 'Kør lint' : 'Run lint'}
          </button>
          <button className="btn btn-primary" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase' }}>
            <window.Icons.Plus size={12} />
            <span>{isDa ? 'Ny' : 'New'}</span>
          </button>
        </div>
      </div>

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {neurons.map((n, i) => (
          <a key={i} href="#" style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '12px 14px',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-card)',
            borderRadius: 8,
            textDecoration: 'none', color: 'var(--color-fg)',
            transition: 'all var(--dur) var(--ease)',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.transform = 'translateX(2px)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.transform = 'translateX(0)'; }}>
            {n.tag && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5,
                padding: '1px 6px', borderRadius: 3,
                background: 'var(--color-bg-sunk)',
                color: 'var(--color-fg-muted)',
                textTransform: 'uppercase', letterSpacing: '.06em',
                border: '1px solid var(--color-border)',
              }}>{n.tag}</span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{n.title}</div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)', marginTop: 2 }}>
                {n.file}
              </div>
            </div>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)' }}>{n.v}</span>
            <window.Icons.ChevronRight size={13} style={{ color: 'var(--color-fg-faint)' }} />
          </a>
        ))}
      </div>
    </div>
  );
}

function TrailChatPane({ locale, trail }) {
  const isDa = locale === 'da';
  const messages = [
    { who: 'user', text: isDa ? 'Hvad bruges fennikel til?' : 'What is fennel used for?' },
    { who: 'trail', text: isDa
      ? 'Fennikel (Foeniculum vulgare) bruges i zoneterapi-praksis primært til fordøjelsesproblemer — særligt oppustethed og kolik. Sanne anbefaler te af knuste frø, 1 tsk pr. kop, 3× dagligt.'
      : 'Fennel (Foeniculum vulgare) is used in zone-therapy practice primarily for digestive issues — particularly bloating and colic. Sanne recommends tea from crushed seeds, 1 tsp per cup, 3× daily.',
      cites: ['fennikel.md', 'urteliste-2021.pdf'],
    },
  ];

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="constellation" style={{ opacity: .35 }} />
      <div style={{
        padding: '20px 36px 14px',
        borderBottom: '1px solid var(--color-border)',
        position: 'relative',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 22 }}>
            {isDa ? 'Chat' : 'Chat'}
          </h1>
          <div className="mono" style={{ marginTop: 4, fontSize: 11, color: 'var(--color-fg-muted)' }}>
            {isDa ? 'svar er funderet i denne trail\u2019s neuroner' : 'answers grounded in this trail\u2019s neurons'}
          </div>
        </div>
        <button className="btn">
          <window.Icons.Plus size={12} />
          <span style={{ fontSize: 12.5 }}>{isDa ? 'Ny chat' : 'New chat'}</span>
        </button>
      </div>

      <div style={{ flex: 1, padding: '24px 36px', overflow: 'auto', position: 'relative', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.who === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: 600,
          }}>
            {m.who === 'trail' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <window.TrailLogoSvg size={14} />
                <span className="mono" style={{ fontSize: 10, color: 'var(--color-fg-subtle)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Trail</span>
              </div>
            )}
            <div style={{
              padding: m.who === 'user' ? '10px 14px' : 0,
              background: m.who === 'user' ? 'var(--color-bg-card)' : 'transparent',
              border: m.who === 'user' ? '1px solid var(--color-border)' : 'none',
              borderRadius: m.who === 'user' ? 12 : 0,
              fontFamily: m.who === 'trail' ? 'var(--font-serif)' : 'var(--font-sans)',
              fontSize: m.who === 'trail' ? 15 : 13.5,
              lineHeight: m.who === 'trail' ? 1.6 : 1.45,
              color: 'var(--color-fg)',
            }}>{m.text}</div>
            {m.cites && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {m.cites.map((c, j) => (
                  <span key={j} style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    padding: '2px 7px', borderRadius: 999,
                    background: 'var(--color-bg-sunk)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-fg-muted)',
                  }}>{c}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div style={{
        padding: '14px 36px 20px',
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        position: 'relative',
      }}>
        <div style={{ position: 'relative' }}>
          <input className="input" placeholder={isDa ? 'Spørg om hvad som helst i denne Trail…' : 'Ask anything in this Trail…'}
            style={{ paddingRight: 96 }} />
          <button className="btn btn-primary" style={{
            position: 'absolute', right: 6, top: 6, bottom: 6,
            padding: '0 16px', fontSize: 12.5,
          }}>
            {isDa ? 'Spørg' : 'Ask'}
            <window.Icons.CornerDownLeft size={12} />
          </button>
        </div>
        <div className="mono" style={{ marginTop: 6, fontSize: 10, color: 'var(--color-fg-subtle)' }}>
          ↵ {isDa ? 'for at sende' : 'to send'} · ⇧↵ {isDa ? 'ny linje' : 'new line'}
        </div>
      </div>
    </div>
  );
}

function TrailQueuePane({ locale, trail }) {
  const isDa = locale === 'da';
  const items = [
    { type: 'reader-feedback',  tone: 'positive', title: '👍 Positive feedback: post-recovery smoke test',
      body: 'Reader question post-recovery smoke test. AI answer smoke. Submitted from: http://test',
      meta: '14/05/2026 23:05 · u-cb-webhouse',  cnd: 'cnd_d3bf316c-29e' },
    { type: 'reader-feedback',  tone: 'positive', title: '👍 Positive feedback: test q',
      body: 'Reader question test q. AI answer test a.',
      meta: '14/05/2026 10:17 · u-cb-webhouse',  cnd: 'cnd_011876ad-e92' },
    { type: 'lint',            tone: 'contradiction', title: 'Contradiction: Sannes praksis vs. Eir',
      body: 'New passage explicitly counts 8 treatment types with zoneterapi as 3 separate entries (01-03), while existing passage lists only 6 named modalities.',
      meta: '01/05/2026 02:18 · pipeline',  cnd: 'cnd_0de2da9f-596',  confidence: 0.75 },
  ];
  return (
    <div style={{ position: 'relative', padding: '24px 32px', overflow: 'auto', height: '100%' }}>
      <div className="constellation" style={{ opacity: .35 }} />
      <div style={{ position: 'relative', marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 24 }}>
          {isDa ? 'Kø til godkendelse' : 'Approval queue'}
        </h1>
        <div className="mono" style={{ marginTop: 4, fontSize: 11, color: 'var(--color-fg-muted)' }}>
          68 {isDa ? 'kandidater afventer' : 'candidates pending'}
        </div>
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it, i) => (
          <div key={i} style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: '14px 16px',
            display: 'flex', gap: 16, alignItems: 'flex-start',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                <span className="plan-badge" style={{ background: 'var(--color-accent-soft)', borderColor: 'transparent' }}>
                  {it.type}
                </span>
                <span className="plan-badge">{isDa ? 'læser-feedback' : 'reader-feedback'}</span>
                <span className="plan-badge">{isDa ? 'afventer' : 'pending'}</span>
                {it.confidence && (
                  <span className="plan-badge" style={{ background: 'var(--color-bg-sunk)' }}>{it.confidence.toFixed(2)}</span>
                )}
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{it.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--color-fg-muted)', lineHeight: 1.55 }}>{it.body}</div>
              <div className="mono" style={{ marginTop: 8, fontSize: 10.5, color: 'var(--color-fg-subtle)' }}>
                {it.meta} · {it.cnd}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 auto' }}>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '5px 12px' }}>
                {isDa ? 'Godkend' : 'Approve'}
              </button>
              <button className="btn" style={{ fontSize: 12, padding: '5px 12px' }}>
                {isDa ? 'Afvis' : 'Reject'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.TrailSidebar = TrailSidebar;
window.TrailMainPane = TrailMainPane;
