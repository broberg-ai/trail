// =====================================================================
// Trail — Spec frames part 5: Manage Tenants + User Settings
// =====================================================================

// -----------------------------------------------------------------------------
// 09 — MANAGE TENANTS
// -----------------------------------------------------------------------------
function ManageTenantsFrame({ theme = 'light' }) {
  return window.SpecFrame({
    theme,
    designWidth: 920,
    designHeight: 620,
    height: 640,
    design: (
      <div data-theme={theme} style={{
        position: 'relative', height: '100%',
        background: 'var(--color-bg)', overflow: 'hidden',
      }}>
        <div className="constellation" style={{ opacity: .3 }} />

        {/* Chrome stub */}
        <div style={{
          padding: '10px 24px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 12,
          position: 'relative',
        }}>
          <window.TrailLogoSvg size={22} />
          <span className="wordmark" style={{ fontSize: 16 }}>trail</span>
          <span className="wordmark-sub" style={{ fontSize: 11 }}>admin</span>
        </div>

        <div style={{ padding: '32px 36px', maxWidth: 800, margin: '0 auto', position: 'relative' }}>
          {/* Header */}
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-fg-subtle)', marginBottom: 6 }}>
            Settings / Tenants
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 24 }}>
            <div>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 26, letterSpacing: '-0.015em' }}>
                Tenants
              </h1>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-fg-muted)', maxWidth: 480, lineHeight: 1.5 }}>
                A tenant is an isolated context — its own trails, sources, credits and members.
              </p>
            </div>
            <button className="btn btn-primary" style={{ padding: '7px 12px' }}>
              <window.Icons.Plus size={11} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase' }}>New tenant</span>
            </button>
          </div>

          {/* Stat strip */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            background: 'var(--color-bg-card)',
            overflow: 'hidden',
            marginBottom: 22,
          }}>
            {[
              ['Total tenants', '6'],
              ['You own',       '1', true],
              ['Active 30d',    '3', true],
              ['Pending',       '2', true, true],
            ].map(([l, v, div, hl], i) => (
              <div key={i} style={{
                padding: '12px 14px',
                borderLeft: div ? '1px solid var(--color-border)' : 'none',
              }}>
                <div className="mono" style={{ fontSize: 8.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-fg-subtle)' }}>{l}</div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, marginTop: 2, color: hl ? 'var(--color-accent)' : 'var(--color-fg)' }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 0, borderBottom: '1px solid var(--color-border)' }}>
            {[
              ['All', 6, true],
              ['You manage', 3],
              ['Invitations', 2, false, true],
            ].map(([l, n, active, att], i) => (
              <div key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '8px 12px',
                fontSize: 12,
                color: active ? 'var(--color-fg)' : 'var(--color-fg-muted)',
                fontWeight: active ? 500 : 400,
                borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
                marginBottom: -1,
              }}>
                {l}
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9,
                  padding: '1px 5px', borderRadius: 999,
                  background: att ? 'var(--color-accent-soft)' : 'var(--color-bg-sunk)',
                  color: att ? 'var(--color-fg)' : 'var(--color-fg-muted)',
                  border: '1px solid var(--color-border)',
                }}>{n}</span>
              </div>
            ))}
          </div>

          {/* Table */}
          <div style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderTopWidth: 0,
            borderRadius: '0 0 8px 8px',
            marginTop: 0,
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 70px 80px 80px 30px',
              padding: '8px 14px',
              background: 'var(--color-bg-sunk)',
              borderBottom: '1px solid var(--color-border)',
              fontFamily: 'var(--font-mono)', fontSize: 8.5,
              letterSpacing: '.08em', textTransform: 'uppercase',
              color: 'var(--color-fg-subtle)', gap: 10,
            }}>
              <div>Tenant</div><div>Plan</div><div>Role</div><div style={{ textAlign: 'right' }}>Last active</div><div></div>
            </div>

            {[
              { name: 'Sanne Andersen',          slug: 'sanne-andersen',   plan: 'starter', role: 'owner',  active: '2h ago',  current: true },
              { name: 'Broberg.ai',              slug: 'broberg-ai',       plan: 'pro',     role: 'admin',  active: '1d ago' },
              { name: 'WebHouse',                slug: 'webhouse',         plan: 'pro',     role: 'admin',  active: '3d ago' },
              { name: 'Aalborg Zoneterapeutskole', slug: 'aalborg-zone',   plan: 'pro',     role: 'editor', active: '2w ago' },
              { name: 'Senti',                   slug: 'senti',            plan: 'hobby',   role: 'editor', active: '6w ago' },
            ].map((tn, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr 70px 80px 80px 30px',
                padding: '10px 14px',
                gap: 10, alignItems: 'center',
                borderBottom: i === 4 ? 'none' : '1px solid var(--color-border)',
                fontSize: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: 4,
                    background: tn.current ? 'var(--color-accent)' : 'var(--color-bg-sunk)',
                    color: tn.current ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
                  }}>
                    {tn.name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase().slice(0,2)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 500, fontSize: 12 }}>{tn.name}</span>
                      {tn.current && <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 8.5,
                        padding: '1px 5px', borderRadius: 2,
                        background: 'var(--color-accent-soft)',
                        letterSpacing: '.04em', textTransform: 'uppercase',
                      }}>current</span>}
                    </div>
                    <div className="mono" style={{ fontSize: 9.5, color: 'var(--color-fg-subtle)', marginTop: 1 }}>{tn.slug}</div>
                  </div>
                </div>
                <div><span className={"plan-badge " + tn.plan} style={{ fontSize: 9 }}>{tn.plan}</span></div>
                <div style={{ fontSize: 11.5, color: 'var(--color-fg-muted)', textTransform: 'capitalize' }}>{tn.role}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--color-fg-subtle)', textAlign: 'right' }}>{tn.active}</div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
                    {[0,1,2].map(j => <span key={j} style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'var(--color-fg-faint)' }} />)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <window.Anno n={1} top={70} left={60} />
        <window.Anno n={2} top={155} left={400} />
        <window.Anno n={3} top={236} left={800} />
        <window.Anno n={4} top={320} left={290} />
        <window.Anno n={5} top={430} left={140} />
      </div>
    ),
    rationale: "The Manage Tenants page promotes the most-asked-for action (switching context) into a first-class settings surface — not a buried admin lever. The stat strip up top lets the user see their footprint at a glance (how many they own, where activity is happening, what\u2019s waiting on them). Tabs split All / You manage / Invitations because those are the three actual jobs-to-be-done on this page. Each row carries plan + role + last-active because those are the actual disambiguators when you have 6+ tenants with similar names. The per-row kebab menu hides destructive actions (Leave tenant) one click deep — never on the main click target.",
    tokens: [
      ['1 · Breadcrumb',  'mono 10.5 uppercase · var(--color-fg-subtle)'],
      ['2 · Stat value',  'serif 24px · accent color when actionable (>0 pending)'],
      ['3 · Tab badges',  'attention: var(--color-accent-soft) · neutral: var(--color-bg-sunk)'],
      ['4 · Table head',  'mono 10 uppercase · bg var(--color-bg-sunk)'],
      ['5 · Current row', 'avatar bg var(--color-accent) · "current" pill var(--color-accent-soft)'],
      ['  row hover',     'bg var(--color-hover)'],
      ['  kebab',         '3-dot · opens RowMenu (200px) w/ Switch / Members / Plan / Settings / Leave'],
    ],
    microcopy: [
      ['title',     'Tenants', 'en'],
      ['',          'Tenants', 'da'],
      ['cta',       'New tenant', 'en'],
      ['',          'Ny tenant', 'da'],
      ['subtitle',  'A tenant is an isolated context — its own trails, sources, credits and members.', 'en'],
      ['stats',     'Total tenants · You own · Active 30d · Pending', 'en'],
      ['tabs',      'All · You manage · Invitations', 'en'],
      ['',          'Alle · Du administrerer · Invitationer', 'da'],
      ['leave',     'Leave tenant (red)', 'en'],
      ['',          'Forlad tenant (rød)', 'da'],
    ],
    edgeCases: [
      'User is the sole owner of a tenant — Leave tenant is disabled with tooltip "Promote another owner first or archive the tenant".',
      'User clicks Decline on an invitation — slide-out animation, then absent on reload; no toast for a low-stakes action.',
      'Pending invitations >5 — the Pending stat turns peach to draw the eye; tab label gets a count badge.',
      'Last-active "Just now" wins over a fresh timestamp — the column is for relative recency, not precision.',
      'Tenant name is 60+ chars — truncate at first column width with ellipsis; full name in title attr.',
      'A tenant the user owns is also their current — show both pills ("current" + "owner") in the cell.',
      'Brand-new user with zero tenants — Manage Tenants page redirects to the no-tenants empty state instead of an empty table.',
    ],
  });
}

// -----------------------------------------------------------------------------
// 10 — USER SETTINGS
// -----------------------------------------------------------------------------
function UserSettingsFrame({ theme = 'light' }) {
  return window.SpecFrame({
    theme,
    designWidth: 760,
    designHeight: 640,
    height: 660,
    design: (
      <div data-theme={theme} style={{
        position: 'relative', height: '100%',
        background: 'var(--color-bg)', overflow: 'hidden',
      }}>
        <div className="constellation" style={{ opacity: .3 }} />

        <div style={{
          padding: '10px 24px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <window.TrailLogoSvg size={22} />
          <span className="wordmark" style={{ fontSize: 16 }}>trail</span>
          <span className="wordmark-sub" style={{ fontSize: 11 }}>admin</span>
        </div>

        <div style={{ padding: '28px 36px', maxWidth: 640, position: 'relative' }}>
          {/* Header */}
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-fg-subtle)', marginBottom: 6 }}>Settings</div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 26, letterSpacing: '-0.015em' }}>
            Your account
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-fg-muted)', lineHeight: 1.5 }}>
            Personal preferences that follow you across tenants. Tenant-specific settings live under Manage tenants.
          </p>

          {/* Sticky tab nav */}
          <div style={{
            marginTop: 20, marginBottom: 0,
            borderBottom: '1px solid var(--color-border)',
            display: 'flex', gap: 0,
          }}>
            {[
              { label: 'Profile', active: true },
              { label: 'Preferences' },
              { label: 'Notifications' },
              { label: 'Sessions' },
              { label: 'Developer' },
              { label: 'Danger' },
            ].map((s, i) => (
              <span key={i} style={{
                padding: '8px 10px',
                fontSize: 11.5,
                color: s.active ? 'var(--color-fg)' : 'var(--color-fg-muted)',
                fontWeight: s.active ? 500 : 400,
                borderBottom: s.active ? '2px solid var(--color-accent)' : '2px solid transparent',
                marginBottom: -1,
              }}>{s.label}</span>
            ))}
          </div>

          {/* Profile section */}
          <h2 style={{ margin: '28px 0 4px', fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 18 }}>Profile</h2>
          <p style={{ margin: '0 0 16px', fontSize: 11.5, color: 'var(--color-fg-muted)' }}>How you appear to other members in shared tenants</p>

          <SpecField label="Avatar" hint="Generated from your initials.">
            <span className="avatar lg">SA</span>
          </SpecField>
          <SpecField label="Display name">
            <input className="input" defaultValue="Sanne Andersen" style={{ maxWidth: 280, padding: '7px 10px', fontSize: 12 }} />
          </SpecField>
          <SpecField label="Email" hint="From Google. To change, sign in with a different account.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="mono" style={{ fontSize: 12 }}>mail@sanneandersen.dk</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9,
                padding: '1px 6px', borderRadius: 999,
                background: 'rgba(21,128,61,.10)',
                color: 'var(--color-success)',
                border: '1px solid rgba(21,128,61,.20)',
              }}>verified</span>
            </div>
          </SpecField>

          <h2 style={{ margin: '32px 0 4px', fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 18 }}>Preferences</h2>
          <SpecField label="Theme">
            <div className="segmented">
              <button>Light</button>
              <button aria-pressed="true">Dark</button>
            </div>
          </SpecField>
          <SpecField label="Language" hint="Of the admin UI. Neuron content follows the per-trail setting.">
            <div className="segmented">
              <button>EN</button>
              <button aria-pressed="true">DA</button>
            </div>
          </SpecField>
        </div>

        <window.Anno n={1} top={70} left={420} />
        <window.Anno n={2} top={172} left={580} />
        <window.Anno n={3} top={250} left={580} />
        <window.Anno n={4} top={340} left={580} />
        <window.Anno n={5} top={520} left={580} />
      </div>
    ),
    rationale: "Settings is USER-level only. The subtitle does the disambiguation work — 'tenant-specific settings live under Manage tenants' — so users with multiple tenants don't go hunting here for tenant credentials. Sections are stacked in priority order (Profile first because most-edited, Danger last because most-feared); a sticky tab nav lets power users skip ahead without scrolling. Form fields use a 180px label gutter + 1fr value column so labels align across sections — the standard 'settings form' pattern users learned from Stripe/Linear.",
    tokens: [
      ['1 · Breadcrumb',   'mono uppercase · var(--color-fg-subtle)'],
      ['2 · Sticky nav',   'tabs · 2px peach underline on active'],
      ['3 · Section head', 'serif 18-22px · subtitle muted 12.5px'],
      ['4 · Field row',    'grid 180px 1fr · 16px y-pad · border-bottom between'],
      ['  field hint',     '11.5px var(--color-fg-subtle) · max 320px'],
      ['5 · Verified pill','bg rgba(21,128,61,.10) · color var(--color-success)'],
      ['  toggle',         '36×20 pill · accent when on'],
    ],
    microcopy: [
      ['title',          'Your account', 'en'],
      ['',               'Din konto', 'da'],
      ['subtitle',       'Personal preferences that follow you across tenants.', 'en'],
      ['',               'Personlige præferencer der følger dig på tværs af tenants.', 'da'],
      ['sections',       'Profile · Preferences · Notifications · Sessions · Developer · Danger', 'en'],
      ['',               'Profil · Præferencer · Notifikationer · Sessions · Udvikler · Farezone', 'da'],
      ['email verified', 'verified (green pill)', 'en'],
      ['delete cta',     'Delete account… (with ellipsis — confirms it opens a modal)', 'note'],
    ],
    edgeCases: [
      'OAuth returned a user without a profile name — display name defaults to the email\'s local-part; field is required to submit anything else.',
      'User edits display name but never saves — confirmation prompt on navigation away, not on every blur.',
      'User has the Settings page open in two tabs — last-write-wins per field, but versions are checked on save and the loser gets a "stale, reload?" banner.',
      'User triggers Delete account but they own a tenant — block with a redirect: "Transfer or archive {tenant.name} first."',
      'Sessions list grows >20 — group by device type (Mac · iPhone · iPad · Linux) and collapse older than 30d.',
      'API keys: user has never created one — show an inline empty state ("No personal keys yet. Generate one below.") instead of an empty table.',
      'Theme/locale set here is a soft preference — per-device override stored in localStorage so the user\'s laptop can be light and their phone dark.',
    ],
  });
}

function SpecField({ label, hint, children }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 1fr',
      gap: 18, padding: '12px 0',
      borderBottom: '1px solid var(--color-border)',
      alignItems: 'flex-start',
    }}>
      <div style={{ paddingTop: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)', marginTop: 3, lineHeight: 1.45 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

window.ManageTenantsFrame = ManageTenantsFrame;
window.UserSettingsFrame = UserSettingsFrame;
