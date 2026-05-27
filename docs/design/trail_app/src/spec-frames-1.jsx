// =====================================================================
// Trail — Spec frames (annotated, static).
// Each frame is a self-contained design + spec panel built for the
// design-canvas review layout.
// =====================================================================

// Convenience: ensures CSS vars cascade for any wrapper.
const themed = (theme) => ({ 'data-theme': theme });

// -----------------------------------------------------------------------------
// 01 — LOGIN
// -----------------------------------------------------------------------------
function LoginFrame({ theme = 'light' }) {
  const isDark = theme === 'dark';
  return window.SpecFrame({
    theme,
    designWidth: 480,
    designHeight: 580,
    design: (
      <div data-theme={theme} style={{
        position: 'relative', width: '100%', height: '100%',
        background: 'var(--color-bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div className="constellation" />
        <div className="card" style={{
          position: 'relative', width: 360,
          padding: '36px 32px 24px',
          boxShadow: 'var(--shadow-md)',
        }}>
          {/* 1: Logo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <window.TrailLogoSvg size={40} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="wordmark" style={{ fontSize: 24 }}>trail</span>
              <span className="wordmark-sub" style={{ fontSize: 13 }}>admin</span>
            </div>
          </div>
          {/* 2: Headline + tagline */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 20, letterSpacing: '-0.01em' }}>
              Sign in to Trail
            </h1>
            <p style={{ margin: '6px 0 0', color: 'var(--color-fg-muted)', fontSize: 12.5, lineHeight: 1.5 }}>
              Curate your knowledge. Chat against your brain.
            </p>
          </div>
          {/* 3: CTA */}
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '11px 14px', gap: 10 }}>
            <window.Icons.Google size={15} />
            <span>Continue with Google</span>
          </button>
          {/* 4: Trust line */}
          <div style={{ marginTop: 12, textAlign: 'center', fontSize: 11, color: 'var(--color-fg-subtle)' }}>
            OAuth · zero passwords stored
          </div>
          {/* 5: Footer */}
          <div style={{
            marginTop: 24, paddingTop: 14,
            borderTop: '1px solid var(--color-border)',
            display: 'flex', justifyContent: 'center', gap: 16,
            fontSize: 11, color: 'var(--color-fg-muted)',
          }}>
            <span>Terms</span><span>Privacy</span><span>Docs</span>
          </div>
        </div>

        {/* Annotation pills */}
        <window.Anno n={1} top={88} left={250} />
        <window.Anno n={2} top={132} left={310} />
        <window.Anno n={3} top={178} left={370} />
        <window.Anno n={4} top={278} left={400} />
        <window.Anno n={5} top={342} left={400} />
        <window.Anno n={6} top={448} left={400} />
      </div>
    ),
    rationale: "The login screen is the first chrome a user sees — it has to do the brand's work for it. The three-circle mark gets a hero moment; the mono wordmark anchors identity; a serif title (Fraunces) gives editorial restraint where a sans-serif would feel generic-SaaS. The peach CTA is the page's only chromatic moment — everything else stays neutral, so the action reads as inevitable.",
    tokens: [
      ['1 · Logo',          'src/favicon.svg · 40 px'],
      ['2 · Wordmark',      'var(--font-mono) 600 · -0.02em'],
      ['3 · Headline',      'var(--font-serif) 400 · 20px'],
      ['  body',            'var(--font-sans) · var(--color-fg-muted)'],
      ['4 · CTA',           'var(--color-accent) · 11/14 padding'],
      ['5 · Trust line',    'var(--color-fg-subtle) · 11px'],
      ['6 · Card',          'var(--color-bg-card) · radius 12px · shadow-md'],
      ['  page bg',         'var(--color-bg) · constellation @ 55% opacity'],
      ['  border',          'var(--color-border)'],
    ],
    microcopy: [
      ['title',          'Sign in to Trail', 'en'],
      ['',               'Log ind på Trail', 'da'],
      ['subtitle',       'Curate your knowledge. Chat against your brain.', 'en'],
      ['',               'Kurater din viden. Chat med din hjerne.', 'da'],
      ['cta',            'Continue with Google', 'en'],
      ['',               'Fortsæt med Google', 'da'],
      ['cta · loading',  'Redirecting to Google…', 'en'],
      ['cta · splash',   'Signing you in…', 'en'],
      ['trust',          'OAuth · zero passwords stored', 'en'],
      ['error',          'Google denied the sign-in. Try again or contact support.', 'en'],
    ],
    edgeCases: [
      'OAuth returns no email — fall back to Google profile name; flag profile as "needs-email" and gate first action.',
      'User\'s email matches no tenant invitation — land them on the "no tenants" empty state, not a dead loop.',
      'Third-party cookies blocked — detect on splash; degrade to a same-tab redirect explanation.',
      'Offline / DNS failure — error pill shows persistent retry + status-page link, not a toast.',
      'Slow OAuth round-trip (>4s) — splash adds a "still working…" line at 4s so the page never feels dead.',
    ],
  });
}

// -----------------------------------------------------------------------------
// 02 — TOP-BAR before/after
// -----------------------------------------------------------------------------
function TopBarBeforeFrame({ theme = 'light' }) {
  return window.SpecFrame({
    theme,
    designWidth: 980,
    designHeight: 200,
    height: 220,
    design: (
      <div data-theme={theme} style={{ background: 'var(--color-bg)', padding: '24px 0 0', height: '100%' }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.08em',
          color: 'var(--color-fg-subtle)', padding: '0 24px 12px',
        }}>BEFORE — flat, no grouping</div>
        <div style={{
          padding: '12px 24px', borderTop: '1px solid var(--color-border)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <a style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-fg)' }}>
            <window.TrailLogoSvg size={28} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="wordmark">trail</span>
              <span className="wordmark-sub">admin</span>
            </div>
          </a>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>Ordforklaring</span>
          <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>Jobs</span>
          <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>Aktivitet</span>
          <span style={{ fontSize: 13, color: 'var(--color-fg)' }}>Sanne Andersen</span>
          <div className="segmented">
            <button>EN</button><button aria-pressed="true">DA</button>
          </div>
          <button className="icon-btn"><window.Icons.VolumeOff size={14} /></button>
          <button className="icon-btn"><window.Icons.Moon size={14} /></button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <Problem n="1" text="No tenant switcher — users with access to multiple tenants are stuck on the first" />
          <Problem n="2" text="Logo + KB switcher + toggles + name all live as siblings; no visual grouping" />
          <Problem n="3" text="No command palette / search affordance — Cmd+K is hidden" />
          <Problem n="4" text="Theme/locale/audio toggles are app-global UI but they're user preferences" />
        </div>
      </div>
    ),
    rationale: "The current top-bar works but reads flat — every control has the same weight, so the eye has to scan everything every time. The redesign clusters by ownership: identity (logo + wordmark) and location (tenant + KB) on the left, the user's controls collapsed into the avatar menu on the right, search lifted into a visible Cmd-K trigger in the middle.",
    tokens: [],
    microcopy: [],
    edgeCases: [],
  });
}

function Problem({ n, text }) {
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      padding: '6px 10px',
      background: 'var(--color-bg-card)',
      border: '1px solid var(--color-border)',
      borderRadius: 6, fontSize: 11.5,
      color: 'var(--color-fg-muted)',
      flex: '1 1 220px',
    }}>
      <span style={{
        flex: '0 0 auto',
        width: 16, height: 16, borderRadius: '50%',
        background: 'var(--color-accent-soft)',
        color: 'var(--color-accent)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
      }}>{n}</span>
      <span>{text}</span>
    </div>
  );
}

function TopBarAfterFrame({ theme = 'light' }) {
  return window.SpecFrame({
    theme,
    designWidth: 980,
    designHeight: 240,
    height: 240,
    design: (
      <div data-theme={theme} style={{ background: 'var(--color-bg)', height: '100%', padding: '24px 0 0' }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.08em',
          color: 'var(--color-fg-subtle)', padding: '0 24px 12px',
        }}>AFTER — clustered into three zones</div>
        <div style={{
          padding: '12px 24px', borderTop: '1px solid var(--color-border)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 12,
          position: 'relative',
        }}>
          {/* LEFT: identity + location */}
          <a style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-fg)' }}>
            <window.TrailLogoSvg size={28} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="wordmark">trail</span>
              <span className="wordmark-sub">admin</span>
            </div>
          </a>
          <span style={{ width: 1, height: 18, background: 'var(--color-border-strong)', opacity: .7, marginLeft: 4, marginRight: 4 }} />
          <FakeTenantPill />

          <div style={{ flex: 1 }} />

          {/* CENTER: Cmd-K */}
          <FakeCmdK />

          {/* RIGHT: user */}
          <FakeUserPill />

          {/* Zone overlays */}
          <ZoneFrame left={20} right={550} label="A · IDENTITY + LOCATION" />
          <ZoneFrame left={555} right={155} label="B · SEARCH" />
          <ZoneFrame left={760} right={20} label="C · USER" />
        </div>

        <div style={{ padding: '18px 24px', fontSize: 12, color: 'var(--color-fg-muted)', lineHeight: 1.55 }}>
          Three readable zones with explicit dividers. The tenant pill is the new pill next to the logo —
          it tells you <em>where you are</em>, and clicking it is how you change context.
          The Cmd-K trigger is finally visible.
        </div>
      </div>
    ),
    rationale: "Logo + wordmark = identity. Tenant pill (new) = location. They sit together on the left because that's the user's 'where am I' answer. Cmd-K becomes a real first-class element in the middle — Linear figured this out years ago; users learn the shortcut precisely because the button is there to teach them. The right cluster collapses theme/locale/audio into the user menu where they belong (they're per-user prefs, not app-global state).",
    tokens: [
      ['header bg',     'var(--color-bg)'],
      ['header border', 'var(--color-border)'],
      ['zone divider',  'var(--color-border-strong) · 1px × 18'],
      ['tenant pill',   'transparent → var(--color-hover) on hover'],
      ['cmd-k bg',      'var(--color-bg-sunk)'],
      ['avatar',        '24px · var(--color-accent)'],
    ],
    microcopy: [
      ['cmd-k placeholder', 'Search or jump to…', 'en'],
      ['',                  'Søg eller hop til…', 'da'],
      ['cmd-k shortcut',    '⌘K', 'both'],
    ],
    edgeCases: [
      'Narrow viewport (720–960px) — Cmd-K placeholder shortens to just the icon + "⌘K" pill.',
      'Tenant name >24 chars — truncate with ellipsis at 180px; full name on hover via title attribute.',
      'No mouse user — Cmd-K trigger is keyboard-reachable; tab order is logo → tenant → search → user.',
    ],
  });
}

// Inline fakes so the spec frame is one self-contained snapshot
function FakeTenantPill() {
  return (
    <button style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '5px 8px 5px 10px', borderRadius: 'var(--radius)',
      border: '1px solid var(--color-border)', background: 'transparent',
      color: 'var(--color-fg)', fontSize: 13, fontWeight: 500,
    }}>
      <span style={{
        width: 18, height: 18, borderRadius: 4,
        background: 'var(--color-accent-soft)', color: 'var(--color-accent)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}><window.Icons.Building size={11} stroke={2} /></span>
      <span>Sanne Andersen</span>
      <window.Icons.Chevron size={12} style={{ color: 'var(--color-fg-subtle)' }} />
    </button>
  );
}
function FakeCmdK() {
  return (
    <button style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      padding: '6px 10px 6px 12px', borderRadius: 'var(--radius)',
      border: '1px solid var(--color-border)',
      background: 'var(--color-bg-sunk)',
      color: 'var(--color-fg-muted)', width: 200,
      fontSize: 12.5,
    }}>
      <window.Icons.Search size={13} />
      <span style={{ flex: 1, textAlign: 'left' }}>Search or jump to…</span>
      <span className="kbd">⌘K</span>
    </button>
  );
}
function FakeUserPill() {
  return (
    <button style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '4px 10px 4px 4px', borderRadius: 999,
      border: '1px solid var(--color-border)',
    }}>
      <span className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>SA</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>Sanne</span>
      <window.Icons.Chevron size={11} style={{ color: 'var(--color-fg-subtle)' }} />
    </button>
  );
}
function ZoneFrame({ left, right, label }) {
  return (
    <div style={{
      position: 'absolute', top: 0, bottom: 0,
      left, right,
      border: '1.5px dashed rgba(232,168,124,.5)',
      borderRadius: 8,
      pointerEvents: 'none',
    }}>
      <div style={{
        position: 'absolute', top: -8, left: 6,
        background: 'var(--color-bg)', padding: '0 6px',
        fontFamily: 'var(--font-mono)', fontSize: 9,
        letterSpacing: '.08em', color: 'var(--color-accent)',
      }}>{label}</div>
    </div>
  );
}

window.LoginFrame = LoginFrame;
window.TopBarBeforeFrame = TopBarBeforeFrame;
window.TopBarAfterFrame = TopBarAfterFrame;
