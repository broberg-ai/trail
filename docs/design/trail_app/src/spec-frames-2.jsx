// =====================================================================
// Trail — Spec frames part 2: tenant switcher, user menu, command palette
// =====================================================================

// -----------------------------------------------------------------------------
// 03 — TENANT SWITCHER (open)
// -----------------------------------------------------------------------------
function TenantSwitcherFrame({ theme = 'light' }) {
  const tenants = window.TRAIL_TENANTS;
  const current = tenants[0];

  return window.SpecFrame({
    theme,
    designWidth: 580,
    designHeight: 640,
    height: 640,
    design: (
      <div data-theme={theme} style={{ position: 'relative', height: '100%', background: 'var(--color-bg)' }}>
        {/* Faux chrome strip at top */}
        <div style={{
          padding: '12px 24px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <window.TrailLogoSvg size={26} />
          <span className="wordmark">trail</span>
          <span className="wordmark-sub">admin</span>
          <span style={{ width: 1, height: 16, background: 'var(--color-border-strong)', opacity: .7, marginLeft: 4, marginRight: 4 }} />

          {/* The pill (active state) */}
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '5px 8px 5px 10px', borderRadius: 'var(--radius)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-active)',
            color: 'var(--color-fg)', fontSize: 13, fontWeight: 500,
          }}>
            <span style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--color-accent-soft)', color: 'var(--color-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <window.Icons.Building size={11} stroke={2} />
            </span>
            <span>{current.name}</span>
            <window.Icons.Chevron size={12} style={{ color: 'var(--color-fg-subtle)' }} />
          </button>
        </div>

        {/* Dropdown — anchored to where the pill would be */}
        <div className="menu" style={{
          position: 'absolute', top: 56, left: 180,
          width: 340, zIndex: 5,
        }}>
          <div style={{
            padding: '10px 14px 8px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--color-border)',
          }}>
            <div className="menu-section" style={{ padding: 0 }}>Switch tenant</div>
            <span className="mono" style={{ fontSize: 10, color: 'var(--color-fg-subtle)' }}>{tenants.length}</span>
          </div>

          <div style={{ maxHeight: 380, overflow: 'hidden' }}>
            {tenants.slice(0, 5).map((tn, i) => (
              <div key={tn.slug} className={"menu-item" + (i === 0 ? " is-active" : "")} style={{ padding: '8px 14px', gap: 10 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: 5,
                  background: i === 0 ? 'var(--color-accent)' : 'var(--color-bg-sunk)',
                  color: i === 0 ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                }}>
                  {tn.name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase().slice(0,2)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: i === 0 ? 500 : 400 }}>
                    <span>{tn.name}</span>
                    <span className={"plan-badge " + tn.plan}>{tn.plan}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)', marginTop: 2 }}>
                    {tn.slug} · {tn.trails} {tn.trails === 1 ? 'trail' : 'trails'} · {tn.neurons} neurons
                  </div>
                </div>
                {i === 0 && <window.Icons.Check size={14} style={{ color: 'var(--color-accent)' }} />}
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--color-border)', padding: 6 }}>
            <div className="menu-item" style={{ borderRadius: 'var(--radius-sm)', fontSize: 12.5 }}>
              <window.Icons.Settings size={13} style={{ color: 'var(--color-fg-subtle)' }} />
              <span>Manage tenants…</span>
            </div>
          </div>
        </div>

        {/* Annotation pills */}
        <window.Anno n={1} top={20} left={140} />
        <window.Anno n={2} top={66} left={530} />
        <window.Anno n={3} top={130} left={530} />
        <window.Anno n={4} top={200} left={530} />
        <window.Anno n={5} top={380} left={530} />
      </div>
    ),
    rationale: "The tenant pill sits next to the logo because that's where 'where am I' answers live in every other product the user knows (Linear workspace, Vercel org, Notion sidebar). The dropdown leads with the heading 'Switch tenant' so the affordance is unambiguous — not just a list. Each row carries the plan badge (so users can scan their hobby/pro mix at a glance) and the mono slug + counts (so power users with similar tenant names can disambiguate). The 'Manage tenants…' link sits at the bottom under a divider — it's the route OUT of this immediate context.",
    tokens: [
      ['1 · Active pill',  'border: var(--color-border) · bg: var(--color-active)'],
      ['  hover',          'bg: var(--color-hover)'],
      ['  tenant icon bg', 'var(--color-accent-soft)'],
      ['2 · Menu',         'var(--color-bg-card) · shadow-lg · radius-lg'],
      ['  border',         'var(--color-border-strong)'],
      ['3 · Section head', 'var(--font-mono) · 10px · var(--color-fg-subtle)'],
      ['4 · Active row',   'bg: var(--color-accent-soft) · accent icon'],
      ['  slug line',      'var(--font-mono) · 10.5px · var(--color-fg-subtle)'],
      ['5 · Footer item',  'top border + 6px padding (separated from list)'],
      ['  animation',      'menuIn 180ms cubic-bezier(.4,0,.2,1)'],
    ],
    microcopy: [
      ['heading',           'Switch tenant', 'en'],
      ['',                  'Skift tenant', 'da'],
      ['search',            'Filter tenants…', 'en'],
      ['',                  'Filtrér tenants…', 'da'],
      ['footer',            'Manage tenants…', 'en'],
      ['',                  'Administrér tenants…', 'da'],
      ['plan badges',       'hobby · starter · pro — always lowercase mono', 'note'],
    ],
    edgeCases: [
      'User belongs to 50 tenants — auto-promote the search input (visible at >8); cap list to 8 visible + scroll; recent-tenants section above the alphabetical list.',
      'User belongs to 1 tenant — render the pill non-interactive (no chevron, no dropdown). No empty affordance.',
      'Tenant name is 40+ characters — truncate at 22ch with ellipsis; full name in title attr + as first line of dropdown row.',
      'Two tenants with the same display name — disambiguate by mono slug line (already shown).',
      'Role isn\'t owner/admin — show a "viewer" badge on the row so the user knows their permissions before switching.',
      'Recently-deleted tenant in the user\'s session — gracefully fall back to the next accessible tenant, with a toast.',
    ],
  });
}

// -----------------------------------------------------------------------------
// 04 — USER MENU (open)
// -----------------------------------------------------------------------------
function UserMenuFrame({ theme = 'light' }) {
  const user = window.TRAIL_USER;
  const tenant = window.TRAIL_TENANTS[0];
  const cap = 200, used = 76;
  const pct = (used / cap) * 100;

  return window.SpecFrame({
    theme,
    designWidth: 560,
    designHeight: 600,
    height: 600,
    design: (
      <div data-theme={theme} style={{ position: 'relative', height: '100%', background: 'var(--color-bg)' }}>
        {/* faux nav strip with user pill on the right */}
        <div style={{
          padding: '12px 24px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center',
        }}>
          <div style={{ flex: 1 }} />
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '4px 10px 4px 4px', borderRadius: 999,
            border: '1px solid var(--color-border)',
            background: 'var(--color-active)',
          }}>
            <span className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>SA</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Sanne</span>
            <window.Icons.Chevron size={11} style={{ color: 'var(--color-fg-subtle)' }} />
          </button>
        </div>

        {/* Open menu */}
        <div className="menu" style={{
          position: 'absolute', top: 56, right: 24,
          width: 320, zIndex: 5,
        }}>
          {/* Identity header */}
          <div style={{ padding: '14px 14px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span className="avatar lg">{user.initials}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{user.name}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--color-fg-muted)', marginTop: 2 }}>{user.email}</div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <window.Icons.Building size={11} style={{ color: 'var(--color-fg-subtle)' }} />
                <span style={{ fontSize: 11.5, color: 'var(--color-fg-muted)' }}>{tenant.name}</span>
                <span className={"plan-badge " + tenant.plan}>{tenant.plan}</span>
              </div>
            </div>
          </div>
          <div className="menu-sep" />

          <div className="menu-item" style={{ padding: '8px 14px' }}>
            <window.Icons.Settings size={14} style={{ color: 'var(--color-fg-subtle)' }} />
            <span>Settings</span>
            <window.Icons.ChevronRight size={12} style={{ color: 'var(--color-fg-subtle)', marginLeft: 'auto' }} />
          </div>
          <div className="menu-sep" />

          <div style={{ padding: '8px 14px 4px' }}>
            <div className="menu-section" style={{ padding: '0 0 6px' }}>preferences</div>
            <PrefRowStatic label="Theme">
              <div className="segmented">
                <button>Light</button><button aria-pressed="true">Dark</button>
              </div>
            </PrefRowStatic>
            <PrefRowStatic label="Language">
              <div className="segmented">
                <button>EN</button><button aria-pressed="true">DA</button>
              </div>
            </PrefRowStatic>
            <PrefRowStatic label="Ambient audio">
              <div className="segmented">
                <button aria-pressed="true">Off</button><button>On</button>
              </div>
            </PrefRowStatic>
          </div>
          <div className="menu-sep" />

          <div style={{ padding: '10px 14px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, color: 'var(--color-fg-muted)' }}>Starter plan</span>
              <span style={{ fontSize: 11.5, color: 'var(--color-accent)', fontWeight: 500 }}>Upgrade →</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--color-bg-sunk)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
              <div style={{ width: pct + '%', height: '100%', background: 'var(--color-accent)' }} />
            </div>
            <div className="mono" style={{ marginTop: 6, fontSize: 10.5, color: 'var(--color-fg-subtle)' }}>
              {used} / {cap} neurons used
            </div>
          </div>
          <div className="menu-sep" />

          <div style={{ padding: 6 }}>
            <div className="menu-item is-danger" style={{ borderRadius: 'var(--radius-sm)' }}>
              <window.Icons.LogOut size={14} />
              <span>Sign out</span>
            </div>
          </div>
        </div>

        <window.Anno n={1} top={62} left={350} />
        <window.Anno n={2} top={140} left={350} />
        <window.Anno n={3} top={186} left={350} />
        <window.Anno n={4} top={356} left={350} />
        <window.Anno n={5} top={456} left={350} />
      </div>
    ),
    rationale: "The header section is identity — avatar, name, email, current tenant + plan. Settings sits alone above the fold because it's the only navigation; preferences are sticky-relocated from the top-bar (theme/locale/audio) and grouped under a mono 'preferences' section header. Plan + usage gets a tiny bar with mono caption — power users monitor the cap, casual users ignore it. Sign-out is destructive-red and below a divider so muscle-memory accidents don't happen.",
    tokens: [
      ['1 · User pill',     'open: bg var(--color-active)'],
      ['  avatar fallback', 'var(--color-accent) bg · mono initials'],
      ['2 · Header',        '14px padding · lg avatar (40px)'],
      ['  email',           'var(--font-mono) · var(--color-fg-muted)'],
      ['3 · Settings',      'menu-item · ChevronRight (sub-page)'],
      ['4 · Preferences',   'segmented controls · 2-state'],
      ['  active segment',  'bg var(--color-accent) · accent-fg'],
      ['5 · Plan bar',      'fill var(--color-accent) → var(--color-danger) @>90%'],
      ['  upgrade link',    'var(--color-accent) · 11.5px'],
      ['  sign out',        'var(--color-danger) · is-danger row'],
    ],
    microcopy: [
      ['settings',     'Settings', 'en'],
      ['',             'Indstillinger', 'da'],
      ['preferences',  'Theme · Language · Ambient audio', 'en'],
      ['',             'Tema · Sprog · Ambient lyd', 'da'],
      ['plan label',   'Starter plan', 'en'],
      ['plan caption', '76 / 200 neurons used', 'en'],
      ['',             '76 / 200 neuroner brugt', 'da'],
      ['upgrade',      'Upgrade →', 'en'],
      ['',             'Opgradér →', 'da'],
      ['sign out',     'Sign out', 'en'],
      ['',             'Log ud', 'da'],
    ],
    edgeCases: [
      'No avatar image and Google didn\'t return one — render initials on a hash-derived background (per brief), keep within the peach family.',
      'User on pro plan — hide the plan-bar (caps are practically infinite), keep just "Pro plan" with no progress.',
      'Usage at 100% — bar fills to var(--color-danger), caption goes red, upgrade link gains a subtle pulse on first open.',
      'Very long email (40+ chars) — single line truncation with ellipsis; full email in title attr.',
      'User belongs to 1 tenant — hide the tenant chip in the header (it would be the only one ever shown).',
      'Audio preference unset (first-time) — default to Off; don\'t auto-play even if device allows.',
    ],
  });
}

function PrefRowStatic({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ fontSize: 12.5, color: 'var(--color-fg-muted)' }}>{label}</span>
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 05 — COMMAND PALETTE
// -----------------------------------------------------------------------------
function PaletteFrame({ theme = 'light' }) {
  return window.SpecFrame({
    theme,
    designWidth: 720,
    designHeight: 600,
    height: 600,
    design: (
      <div data-theme={theme} style={{
        position: 'relative', height: '100%',
        background: 'var(--color-bg)',
        overflow: 'hidden',
      }}>
        {/* Page chrome stub for context */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12, opacity: .5 }}>
          <window.TrailLogoSvg size={24} />
          <span className="wordmark" style={{ fontSize: 18 }}>trail</span>
          <span className="wordmark-sub">admin</span>
          <span style={{ flex: 1 }} />
          <span className="avatar" style={{ width: 22, height: 22, fontSize: 9 }}>SA</span>
        </div>

        {/* Overlay backdrop */}
        <div style={{
          position: 'absolute', inset: 0, top: 49,
          background: 'rgba(26,23,21,.36)',
          backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          paddingTop: 50,
        }}>
          <div className="menu" style={{
            width: 560, boxShadow: 'var(--shadow-xl)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
              <window.Icons.Search size={16} style={{ color: 'var(--color-fg-subtle)' }} />
              <span style={{ flex: 1, color: 'var(--color-fg-subtle)', fontSize: 14 }}>fenn</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10.5,
                padding: '2px 6px', borderRadius: 4,
                color: 'var(--color-fg-subtle)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-sunk)',
              }}>esc</span>
            </div>

            <div className="menu-section">Recent neurons</div>
            <CmdRow icon="FileText" label="Fennikel" hint="Sanne Andersen" selected />
            <CmdRow icon="FileText" label="Hvad bruges Fennikel til?" hint="Sanne Andersen" />

            <div className="menu-section">Trails</div>
            <CmdRow icon="Network" label="Sanne Andersen" hint="68 neurons" />

            <div className="menu-section">Actions</div>
            <CmdRow icon="Plus" label='Create neuron "fenn"' />
            <CmdRow icon="MessageSquare" label="Open chat" hint="Sanne Andersen" />

            <div className="menu-section">Switch to tenant</div>
            <CmdRow icon="Building" label="Broberg.ai" hint="broberg-ai" badge="pro" />

            <div style={{
              padding: '8px 16px', borderTop: '1px solid var(--color-border)',
              background: 'var(--color-bg-sunk)',
              display: 'flex', alignItems: 'center', gap: 16,
              fontSize: 11, color: 'var(--color-fg-muted)',
            }}>
              <span><span className="kbd">↑</span><span className="kbd">↓</span> navigate</span>
              <span><span className="kbd">↵</span> open</span>
              <span><span className="kbd">esc</span> close</span>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <window.Icons.Sparkles size={12} style={{ color: 'var(--color-accent)' }} />
                <span className="mono" style={{ fontSize: 10.5 }}>Sanne Andersen</span>
              </span>
            </div>
          </div>
        </div>

        <window.Anno n={1} top={80} left={620} />
        <window.Anno n={2} top={150} left={620} />
        <window.Anno n={3} top={296} left={620} />
        <window.Anno n={4} top={420} left={620} />
        <window.Anno n={5} top={510} left={620} />
      </div>
    ),
    rationale: "The palette is the single biggest leverage point added by this redesign — Trail is fundamentally a knowledge-jumper, and the palette makes every neuron/trail/tenant addressable from one keystroke. Results are grouped (Neurons → Trails → Actions → Switch to tenant) rather than ranked into a single flat list, because the user almost always knows which kind of thing they're after — grouping is a faster scan than blended ranking. Tenant switching IS a palette command, not just a sidebar UI, because power users will switch by name far more often than by clicking the pill.",
    tokens: [
      ['1 · Backdrop',     'rgba(26,23,21,.36) · 2px blur'],
      ['2 · Surface',      'var(--color-bg-card) · shadow-xl'],
      ['  width',          '620px max · 70vh max-height'],
      ['3 · Group head',   'var(--font-mono) 10px uppercase'],
      ['  selected row',   'left-border 2px var(--color-accent)'],
      ['4 · Action row',   'icon var(--color-fg-subtle) · ↵ arrow on selected'],
      ['5 · Footer',       'bg var(--color-bg-sunk) · kbd pills'],
      ['  context tag',    'mono · tenant name w/ Sparkles glyph'],
      ['  animation',      'paletteIn 200ms · top fade+translate'],
    ],
    microcopy: [
      ['placeholder',  'Search or jump to…', 'en'],
      ['',             'Søg eller hop til…', 'da'],
      ['empty state',  'No matches', 'en'],
      ['',             'Ingen match', 'da'],
      ['groups',       'Recent neurons · Trails · Actions · Switch to tenant', 'en'],
      ['',             'Seneste neuroner · Trails · Handlinger · Skift til tenant', 'da'],
      ['hints',        '↑↓ navigate · ↵ open · esc close', 'both'],
      ['action prefix','Create neuron "{q}" — uses literal query', 'note'],
    ],
    edgeCases: [
      'Empty query — show "Recent" neurons (last 5 opened by this user) above any trails/actions.',
      'Query matches no neuron/trail but matches a tenant — "Switch to tenant" group still surfaces.',
      'User has Cmd-K bound by an extension — the trigger button still works; we don\'t fight the conflict.',
      'Long neuron title (>50 chars) — truncate with ellipsis; full title in title attr.',
      'IME composition (Japanese, Korean) — disable Enter-to-select while composing; only fire on confirm.',
      'Right-to-left languages — flip the left-border indicator to the right; keep arrow icon mirrored.',
    ],
  });
}

function CmdRow({ icon, label, hint, selected, badge }) {
  const IconComp = window.Icons[icon] || window.Icons.FileText;
  return (
    <div className="menu-item"
      data-highlighted={selected ? "true" : undefined}
      style={{
        padding: '8px 16px',
        borderLeft: selected ? '2px solid var(--color-accent)' : '2px solid transparent',
        paddingLeft: 14,
        background: selected ? 'var(--color-hover)' : 'transparent',
      }}>
      <IconComp size={14} style={{ color: 'var(--color-fg-subtle)' }} />
      <span style={{ flex: 1, textAlign: 'left', fontSize: 13 }}>{label}</span>
      {badge && <span className={"plan-badge " + badge}>{badge}</span>}
      {hint && <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)' }}>{hint}</span>}
      {selected && <window.Icons.CornerDownLeft size={12} style={{ color: 'var(--color-fg-subtle)' }} />}
    </div>
  );
}

window.TenantSwitcherFrame = TenantSwitcherFrame;
window.UserMenuFrame = UserMenuFrame;
window.PaletteFrame = PaletteFrame;
