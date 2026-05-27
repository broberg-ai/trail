// =====================================================================
// Trail — Spec frame: inner-trail sidebar redesign
// =====================================================================

function InnerTrailFrame({ theme = 'light' }) {
  const trail = { slug: 'sanne-andersen', name: 'Sanne Andersen' };
  return window.SpecFrame({
    theme,
    designWidth: 920,
    designHeight: 580,
    height: 600,
    design: (
      <div data-theme={theme} style={{
        position: 'relative', height: '100%',
        background: 'var(--color-bg)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Top nav stub for context */}
        <div style={{
          padding: '10px 20px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 12, flex: '0 0 auto',
        }}>
          <window.TrailLogoSvg size={22} />
          <span className="wordmark" style={{ fontSize: 16 }}>trail</span>
          <span className="wordmark-sub" style={{ fontSize: 12 }}>admin</span>
          <span style={{ width: 1, height: 14, background: 'var(--color-border-strong)', opacity: .7, margin: '0 6px' }} />
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 7px 3px 8px', borderRadius: 6,
            border: '1px solid var(--color-border)',
            fontSize: 11.5, fontWeight: 500,
          }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--color-accent-soft)', color: 'var(--color-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <window.Icons.Building size={9} stroke={2} />
            </span>
            <span>Sanne Andersen</span>
            <window.Icons.Chevron size={10} style={{ color: 'var(--color-fg-subtle)' }} />
          </button>
          <div style={{ flex: 1 }} />
          <span className="avatar" style={{ width: 22, height: 22, fontSize: 9 }}>SA</span>
        </div>

        {/* Sidebar + main */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Sidebar — inline version for static frame */}
          <aside style={{
            width: 220, flex: '0 0 220px',
            borderRight: '1px solid var(--color-border)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--color-fg-muted)', marginBottom: 6 }}>
                <window.Icons.Chevron size={10} style={{ transform: 'rotate(90deg)' }} />
                <span>Trails</span>
              </div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 15, lineHeight: 1.2 }}>{trail.name}</div>
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--color-fg-subtle)', marginTop: 3, display: 'flex', gap: 5, alignItems: 'center' }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--color-success)' }} />
                <span>{trail.slug}</span>
              </div>
            </div>

            <div style={{ padding: 6, flex: 1 }}>
              <Group title="USE">
                <Item icon="MessageSquare" label="Chat" active />
                <Item icon="Search" label="Search" />
              </Group>
              <Group title="CANON">
                <Item icon="FileText" label="Neurons" count={76} />
                <Item icon="Network" label="Graph" />
              </Group>
              <Group title="PIPELINE">
                <Item icon="Inbox" label="Queue" count={68} attention />
                <Item icon="Cpu" label="Work" />
                <Item icon="ArrowUpRight" label="Links" count={3} attention />
              </Group>
              <Group title="INPUTS">
                <Item icon="Upload" label="Sources" count={12} />
                <Item icon="FileText" label="Images" />
              </Group>
            </div>
            <div style={{ borderTop: '1px solid var(--color-border)', padding: 6 }}>
              <Item icon="CreditCard" label="Cost" dim />
              <Item icon="Settings" label="Settings" dim />
            </div>
          </aside>

          {/* Main content stub */}
          <div style={{ flex: 1, padding: '20px 28px', position: 'relative', overflow: 'hidden' }}>
            <div className="constellation" style={{ opacity: .3 }} />
            <div style={{ position: 'relative' }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 22 }}>Chat</h2>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-fg-muted)', marginTop: 4 }}>
                answers grounded in this trail's neurons
              </div>
              <div style={{ marginTop: 24, alignSelf: 'flex-end', maxWidth: 360, padding: '8px 12px', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 12, marginLeft: 'auto' }}>
                What is fennel used for?
              </div>
              <div style={{ marginTop: 14, maxWidth: 420 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                  <window.TrailLogoSvg size={12} />
                  <span className="mono" style={{ fontSize: 9, color: 'var(--color-fg-subtle)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Trail</span>
                </div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, lineHeight: 1.55 }}>
                  Fennel (Foeniculum vulgare) is used in zone-therapy practice primarily for digestive issues — particularly bloating and colic.
                </div>
              </div>
            </div>
          </div>
        </div>

        <window.Anno n={1} top={70} left={75} />
        <window.Anno n={2} top={155} left={245} />
        <window.Anno n={3} top={302} left={245} />
        <window.Anno n={4} top={510} left={245} />
        <window.Anno n={5} top={130} left={650} />
      </div>
    ),
    rationale: "The current 11-tab horizontal strip is doing too much — every verb (Chat, Search), every noun (Neurons, Graph), every queue (Kø, Links, Arbejde), and every admin lever (Cost, Settings) sits as a sibling tab. The grouped sidebar gives each thing a home: USE (the verbs end-users do), CANON (the compiled knowledge), PIPELINE (work the curator owes the system), INPUTS (raw material going in), and a separated footer for admin. Counts surface as mono pills, with peach-soft when they need attention (Queue at 68, Links at 3) and neutral when they're just informational (Neurons at 76).",
    tokens: [
      ['1 · Trail header',  'serif 15px · slug as mono w/ live dot'],
      ['  back link',       'Chevron(rotated) + Trails · 10px muted'],
      ['2 · Active item',   'bg var(--color-accent-soft) · 2px left bar var(--color-accent)'],
      ['  icon color',      'var(--color-accent) when active'],
      ['3 · Group head',    'var(--font-mono) 10px uppercase · .08em'],
      ['  count badge',     'attention: bg var(--color-accent-soft) · neutral: var(--color-bg-sunk)'],
      ['4 · Admin footer',  'top-border separation · dim items'],
      ['5 · Main pane',     'serif 22px title · constellation @ 30% opacity'],
      ['  chat answer',     'Fraunces 13px for narrative answers'],
      ['  user message',    'var(--color-bg-card) bubble · right-aligned · max 360px'],
    ],
    microcopy: [
      ['groups (en)',  'USE · CANON · PIPELINE · INPUTS', 'en'],
      ['',             'BRUG · KANON · PIPELINE · INPUT', 'da'],
      ['back link',    'Trails', 'en'],
      ['',             'Trails', 'da'],
      ['use group',    'Chat · Search', 'en'],
      ['',             'Chat · Søg', 'da'],
      ['canon group',  'Neurons · Graph', 'en'],
      ['',             'Neuroner · Graf', 'da'],
      ['pipeline',     'Queue · Work · Links', 'en'],
      ['',             'Kø · Arbejde · Links', 'da'],
      ['inputs',       'Sources · Images', 'en'],
      ['',             'Kilder · Billeder', 'da'],
      ['footer',       'Cost · Settings', 'en'],
      ['',             'Omkostning · Indstillinger', 'da'],
    ],
    edgeCases: [
      'Trail with no pipeline items (queue=0, links=0) — hide the count pill entirely rather than show "0". The PIPELINE group still renders.',
      'Trail with so many pipeline items that the count is 4 digits — pill grows to fit; clamp at "999+".',
      'Viewer-role user — hide Work + Cost + Settings; PIPELINE collapses to read-only Queue (no Approve buttons).',
      'Sidebar at narrow viewport (~960–1100px wide app) — collapse to icon-only (40px) with hover tooltips; full labels return at ≥1200px.',
      'User opens a deep-linked URL like /trail/sanne/queue → sidebar opens with Queue active, breadcrumb still reads Trails.',
      'Mobile (≤720px) — sidebar becomes a slide-in drawer triggered from the hamburger; main pane takes full width.',
      'Cost view is gated behind owner/admin role — hide the entry entirely for editor/viewer (don\'t render a disabled item that begs the question).',
      'A trail with 1k+ neurons — the Neurons count pill keeps mono formatting ("1.2k" rather than 1234) to stay 4 chars or less.',
    ],
  });
}

function Group({ title, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="menu-section" style={{ padding: '4px 8px 2px', fontSize: 9, letterSpacing: '.1em' }}>{title}</div>
      {children}
    </div>
  );
}

function Item({ icon, label, count, active, attention, dim }) {
  const IconComp = window.Icons[icon] || window.Icons.FileText;
  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '5px 8px', borderRadius: 5,
      background: active ? 'var(--color-accent-soft)' : 'transparent',
      color: active ? 'var(--color-fg)' : 'var(--color-fg-muted)',
      fontSize: 12,
      fontWeight: active ? 500 : 400,
    }}>
      {active && (
        <span style={{
          position: 'absolute', left: -6, top: 6, bottom: 6,
          width: 2, borderRadius: 1,
          background: 'var(--color-accent)',
        }} />
      )}
      <IconComp size={12} style={{ color: active ? 'var(--color-accent)' : 'var(--color-fg-subtle)' }} />
      <span style={{ flex: 1 }}>{label}</span>
      {count != null && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          padding: '1px 5px', borderRadius: 999,
          background: attention ? 'var(--color-accent-soft)' : 'var(--color-bg-sunk)',
          color: attention ? 'var(--color-fg)' : 'var(--color-fg-muted)',
          minWidth: 14, textAlign: 'center', fontWeight: 500,
        }}>{count}</span>
      )}
    </div>
  );
}

window.InnerTrailFrame = InnerTrailFrame;
