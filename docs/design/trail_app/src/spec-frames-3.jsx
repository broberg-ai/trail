// =====================================================================
// Trail — Spec frames part 3: empty states + mobile
// =====================================================================

// -----------------------------------------------------------------------------
// 06 — EMPTY STATES (three states side by side in one frame)
// -----------------------------------------------------------------------------
function EmptyStatesFrame({ theme = 'light' }) {
  return window.SpecFrame({
    theme,
    designWidth: 980,
    designHeight: 460,
    height: 480,
    design: (
      <div data-theme={theme} style={{
        position: 'relative', height: '100%',
        background: 'var(--color-bg)',
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: 0,
      }}>
        <EmptyCol
          tag="A · NO TRAILS"
          tagNote="New tenant, no KBs created yet"
          icon={<window.Icons.Network size={26} />}
          title="No trails yet"
          body="A trail is one knowledge-base inside this tenant. Upload sources, and Trail compiles them into linked neurons you can chat with."
          cta={<><window.Icons.Plus size={14} /><span>Create your first trail</span></>}
        />
        <EmptyCol
          tag="B · NO NEURONS"
          tagNote="Trail exists but no sources ingested"
          icon={<window.Icons.FileText size={26} />}
          title="Empty trail"
          body="Drop in a PDF, paste an article, or import a source. Trail will compile it into linked neurons."
          cta={<><window.Icons.Upload size={14} /><span>Add a source</span></>}
        />
        <EmptyCol
          tag="C · NO TENANTS"
          tagNote="Just signed in, no org access"
          icon={<window.Icons.Building size={26} />}
          title="You don't have access to any tenants yet"
          body="Ask a teammate to invite you, or create your own tenant to get started."
          cta={<><window.Icons.Plus size={14} /><span>Create a tenant</span></>}
          secondary="Request invitation"
        />
      </div>
    ),
    rationale: "Three empty states, one consistent skeleton: a peach circle holding an icon that mirrors the noun being absent (Network = trail-graph, FileText = neuron, Building = tenant), a serif title in editorial restraint, plain-language body that names what the thing IS (not just what to do), and a peach primary CTA. The 'no tenants' state is the one with the most off-ramps — most users land here from a botched invitation, so it carries a secondary 'Request invitation' button.",
    tokens: [
      ['icon container',  '56px circle · bg var(--color-accent-soft)'],
      ['icon color',      'var(--color-accent)'],
      ['title',           'var(--font-serif) 400 · 22px · -0.01em'],
      ['body',            'var(--color-fg-muted) · 13.5px · max 440px'],
      ['primary CTA',     'btn-primary · 9/16 padding'],
      ['secondary',       'btn-ghost · same height · no border'],
      ['border-inline',   '1px dashed var(--color-border-strong) (no-neurons) — \'invitation to fill\''],
    ],
    microcopy: [
      ['A · title',  'No trails yet', 'en'],
      ['',           'Ingen trails endnu', 'da'],
      ['A · body',   'A trail is one knowledge-base inside this tenant.', 'en'],
      ['A · cta',    'Create your first trail', 'en'],
      ['',           'Opret din første trail', 'da'],
      ['B · title',  'Empty trail', 'en'],
      ['',           'Tom trail', 'da'],
      ['B · body',   'Drop in a PDF, paste an article, or import a source.', 'en'],
      ['B · cta',    'Add a source', 'en'],
      ['',           'Tilføj kilde', 'da'],
      ['C · title',  "You don't have access to any tenants yet", 'en'],
      ['',           'Du har ingen tenant-adgang endnu', 'da'],
      ['C · body',   'Ask a teammate to invite you, or create your own tenant.', 'en'],
      ['C · cta',    'Create a tenant', 'en'],
      ['C · alt',    'Request invitation', 'en'],
      ['',           'Bed om invitation', 'da'],
    ],
    edgeCases: [
      'A user with viewer role on a no-trails tenant — hide "Create your first trail"; show "Ask an admin to add a trail" instead.',
      'B (no neurons) — show last failed ingest if present; users land here often after a botched upload.',
      'C (no tenants) but user has pending invitations — surface them above the empty state as an Inbox.',
      'C (no tenants) and the user\'s email is on a domain that owns a tenant — surface "Join {tenant.name}" auto-suggestion.',
      'A user clicks the CTA while offline — primary turns into a disabled state with retry messaging in <16px height.',
    ],
  });
}

function EmptyCol({ tag, tagNote, icon, title, body, cta, secondary }) {
  return (
    <div style={{
      position: 'relative',
      padding: '34px 28px 28px',
      borderRight: '1px dashed var(--color-border)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      textAlign: 'center', gap: 12,
    }}>
      <div style={{
        position: 'absolute', top: 12, left: 12, right: 12,
        display: 'flex', alignItems: 'baseline', gap: 8,
        fontFamily: 'var(--font-mono)', fontSize: 10,
        letterSpacing: '.08em', color: 'var(--color-fg-subtle)',
      }}>
        <span style={{ color: 'var(--color-accent)' }}>{tag}</span>
        <span style={{ flex: 1, borderTop: '1px solid var(--color-border)', marginTop: 6 }} />
      </div>
      <div style={{ height: 16 }} />
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: 'var(--color-accent-soft)',
        color: 'var(--color-accent)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        marginTop: 8,
      }}>{icon}</div>
      <h2 style={{
        margin: '6px 0 0', fontFamily: 'var(--font-serif)', fontWeight: 400,
        fontSize: 18, letterSpacing: '-0.01em', lineHeight: 1.3,
      }}>{title}</h2>
      <p style={{
        margin: 0, fontSize: 12, color: 'var(--color-fg-muted)',
        lineHeight: 1.55, maxWidth: 240,
      }}>{body}</p>
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button className="btn btn-primary" style={{ padding: '8px 14px', fontSize: 12.5 }}>
          {cta}
        </button>
        {secondary && (
          <button className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 12.5, justifyContent: 'center' }}>
            {secondary}
          </button>
        )}
      </div>
      <div style={{
        marginTop: 'auto', paddingTop: 10,
        fontFamily: 'var(--font-mono)', fontSize: 9.5,
        color: 'var(--color-fg-subtle)',
      }}>{tagNote}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 07 — MOBILE (login + chrome + sheet)
// -----------------------------------------------------------------------------
function MobileFrame({ theme = 'light' }) {
  return window.SpecFrame({
    theme,
    designWidth: 880,
    designHeight: 760,
    height: 780,
    design: (
      <div data-theme={theme} style={{
        position: 'relative', height: '100%',
        background: 'var(--color-bg-sunk)',
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: 24, padding: '28px 24px',
      }}>
        <MobilePhone label="A · LOGIN" theme={theme}>
          <MobileLoginContent />
        </MobilePhone>
        <MobilePhone label="B · HOME (signed in)" theme={theme}>
          <MobileHomeContent />
        </MobilePhone>
        <MobilePhone label="C · USER SHEET" theme={theme}>
          <MobileHomeContent dim />
          <MobileSheetVisual />
        </MobilePhone>
      </div>
    ),
    rationale: "Mobile collapses the chrome aggressively: only logo, tenant pill, and a hamburger fit on the bar. Everything else (search, prefs, sign-out) lives in a bottom-sheet — bottom sheets are the only mobile primitive that beats dropdowns at thumb-reach. Login uses the same card layout as desktop with no shrinkage — the card just becomes full-width inside its margin. Bottom sheets slide up over a 40% black scrim, the panel itself is var(--color-bg-card) so dark mode stays warm-brown.",
    tokens: [
      ['phone width',     '390px viewport · 360px content (16px gutter)'],
      ['bar height',      '52px (vs 60 desktop)'],
      ['hamburger',       '32 × 32 icon-btn'],
      ['sheet bg',        'var(--color-bg-card)'],
      ['sheet scrim',     'rgba(26,23,21,.4)'],
      ['sheet radius',    '16px top-only'],
      ['sheet anim',      'sheetIn 240ms · translateY(100%) → 0'],
    ],
    microcopy: [
      ['hamburger label', 'Menu (aria)', 'en'],
      ['sheet title',     'Account (user\'s name)', 'note'],
      ['close',           'X icon · top-right of sheet', 'note'],
    ],
    edgeCases: [
      'Notch / safe-area — sheet adds env(safe-area-inset-bottom) padding, login card adds env(safe-area-inset-top).',
      'Tiny phone (320px iPhone SE) — wordmark drops, only logo + tenant pill remain.',
      'Hardware keyboard on iPad — Cmd-K still works; palette opens as a centered modal instead of bottom sheet at ≥720px.',
      'Sheet open + user rotates to landscape — sheet collapses, palette opens as a centered overlay.',
      'iOS Safari bottom toolbar — sheet sits ABOVE it via fixed bottom + safe-area padding; tested on iOS 17+.',
    ],
  });
}

function MobilePhone({ label, theme, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9.5,
        color: 'var(--color-accent)', letterSpacing: '.08em',
        alignSelf: 'flex-start',
      }}>{label}</div>
      <div style={{
        position: 'relative',
        width: 246, height: 510,
        border: '6px solid var(--color-fg)',
        borderRadius: 34,
        overflow: 'hidden',
        background: 'var(--color-bg)',
        boxShadow: '0 8px 28px rgba(0,0,0,.10)',
      }}>
        {children}
      </div>
    </div>
  );
}

function MobileLoginContent() {
  return (
    <div style={{
      position: 'relative', height: '100%', background: 'var(--color-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div className="constellation" />
      <div className="card" style={{ position: 'relative', width: '100%', padding: '24px 18px 14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <window.TrailLogoSvg size={32} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span className="wordmark" style={{ fontSize: 18 }}>trail</span>
            <span className="wordmark-sub" style={{ fontSize: 11 }}>admin</span>
          </div>
        </div>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 15, letterSpacing: '-0.01em' }}>
            Sign in to Trail
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--color-fg-muted)', fontSize: 10, lineHeight: 1.45 }}>
            Curate your knowledge.<br/>Chat against your brain.
          </p>
        </div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '8px 10px', fontSize: 11, gap: 6 }}>
          <window.Icons.Google size={11} />
          <span>Continue with Google</span>
        </button>
        <div style={{ marginTop: 10, textAlign: 'center', fontSize: 8.5, color: 'var(--color-fg-subtle)' }}>
          OAuth · zero passwords stored
        </div>
        <div style={{
          marginTop: 12, paddingTop: 10,
          borderTop: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'center', gap: 10,
          fontSize: 9, color: 'var(--color-fg-muted)',
        }}>
          <span>Terms</span><span>Privacy</span><span>Docs</span>
        </div>
      </div>
    </div>
  );
}

function MobileHomeContent({ dim }) {
  return (
    <div style={{ position: 'relative', height: '100%', background: 'var(--color-bg)', filter: dim ? 'brightness(.72) saturate(.85)' : 'none' }}>
      {/* Mobile top bar */}
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <window.TrailLogoSvg size={20} />
        <button style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 6px 3px 7px', borderRadius: 6,
          border: '1px solid var(--color-border)',
          fontSize: 10, fontWeight: 500, color: 'var(--color-fg)',
          maxWidth: 100,
        }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--color-accent-soft)', color: 'var(--color-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <window.Icons.Building size={8} stroke={2} />
          </span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Sanne A.</span>
          <window.Icons.Chevron size={8} style={{ color: 'var(--color-fg-subtle)' }} />
        </button>
        <div style={{ flex: 1 }} />
        <span className="icon-btn" style={{ width: 22, height: 22 }}>
          <window.Icons.Search size={11} />
        </span>
        <span className="icon-btn" style={{ width: 22, height: 22 }}>
          <window.Icons.Menu size={11} />
        </span>
      </div>
      <div style={{ padding: '16px 12px' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 400 }}>Trails</h1>
        <div className="mono" style={{ fontSize: 9, color: 'var(--color-fg-muted)', marginTop: 4 }}>
          76 neurons on this trail-server
        </div>
        <div style={{
          marginTop: 14, padding: 10,
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 500 }}>Sanne Andersen</div>
          <div style={{ fontSize: 9.5, color: 'var(--color-fg-muted)', marginTop: 2 }}>Clinical zoneterapi material</div>
        </div>
      </div>
    </div>
  );
}

function MobileSheetVisual() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,23,21,.4)' }}>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'var(--color-bg-card)',
        borderTopLeftRadius: 14, borderTopRightRadius: 14,
        padding: '10px 12px 14px',
        boxShadow: '0 -8px 24px rgba(0,0,0,.15)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingBottom: 8, marginBottom: 8,
          borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="avatar" style={{ width: 22, height: 22, fontSize: 9 }}>SA</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500 }}>Sanne Andersen</div>
              <div className="mono" style={{ fontSize: 8, color: 'var(--color-fg-muted)' }}>mail@sanneandersen.dk</div>
            </div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--color-fg-subtle)' }}>×</span>
        </div>
        <div style={{ fontSize: 10, padding: '6px 0', color: 'var(--color-fg)' }}>Settings</div>
        <div className="menu-section" style={{ padding: 0, marginTop: 6, marginBottom: 4 }}>preferences</div>
        <SheetRow label="Theme" right={<MiniSeg labels={['Light','Dark']} on={1} />} />
        <SheetRow label="Language" right={<MiniSeg labels={['EN','DA']} on={1} />} />
        <SheetRow label="Audio" right={<MiniSeg labels={['Off','On']} on={0} />} />
        <div style={{
          marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)',
          fontSize: 10, color: 'var(--color-danger)',
        }}>Sign out</div>
      </div>
    </div>
  );
}

function SheetRow({ label, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', fontSize: 10, color: 'var(--color-fg-muted)' }}>
      <span>{label}</span>
      {right}
    </div>
  );
}

function MiniSeg({ labels, on }) {
  return (
    <div style={{
      display: 'inline-flex', padding: 1, borderRadius: 5,
      background: 'var(--color-bg-sunk)', border: '1px solid var(--color-border)',
    }}>
      {labels.map((l, i) => (
        <span key={i} style={{
          padding: '1px 5px', borderRadius: 4,
          fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 500,
          background: i === on ? 'var(--color-accent)' : 'transparent',
          color: i === on ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
        }}>{l}</span>
      ))}
    </div>
  );
}

window.EmptyStatesFrame = EmptyStatesFrame;
window.MobileFrame = MobileFrame;
