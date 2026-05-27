// =====================================================================
// Trail — Manage Tenants page (settings/tenants)
//   Reached from: Tenant switcher → "Manage tenants…" footer
// =====================================================================

const { useState: useState_MT } = React;

function ManageTenants({ user, tenants, currentSlug, onSwitch, locale, t }) {
  const isDa = locale === 'da';
  const [tab, setTab] = useState_MT('all'); // all | owner | invitations
  const [openMenu, setOpenMenu] = useState_MT(null);

  // Mock pending invitations
  const invitations = [
    { tenant: 'nordwave-ai', name: 'Nordwave AI',  role: 'editor', invitedBy: 'erik@nordwave.ai', plan: 'pro',     when: isDa ? 'For 2 dage siden' : '2 days ago' },
    { tenant: 'mads-private', name: 'Mads (private)', role: 'viewer', invitedBy: 'mads@personal.dk', plan: 'hobby', when: isDa ? 'For 1 uge siden' : '1 week ago' },
  ];

  // Augment tenants with last-active mock
  const lastActives = ['2h ago', '1d ago', '3d ago', '2w ago', '6w ago', '4mo ago'];
  const augmented = tenants.map((tn, i) => ({
    ...tn,
    lastActive: lastActives[i] || '6mo ago',
    isCurrent: tn.slug === currentSlug,
  }));

  const filtered = tab === 'all' ? augmented
    : tab === 'owner' ? augmented.filter(tn => tn.role === 'owner' || tn.role === 'admin')
    : [];

  return (
    <div style={{ position: 'relative', maxWidth: 920, margin: '0 auto', padding: '48px 32px 60px' }}>
      <div className="constellation" style={{ opacity: .35 }} />

      {/* Header */}
      <div style={{ position: 'relative', marginBottom: 32 }}>
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-fg-subtle)', marginBottom: 8 }}>
          {isDa ? 'Indstillinger' : 'Settings'} / {isDa ? 'Tenants' : 'Tenants'}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 32, letterSpacing: '-0.015em' }}>
              {isDa ? 'Tenants' : 'Tenants'}
            </h1>
            <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--color-fg-muted)', maxWidth: 560, lineHeight: 1.55 }}>
              {isDa
                ? 'En tenant er en isoleret kontekst — egne trails, kilder, credits og medlemmer. Du kan have flere, og skifte hurtigt mellem dem fra pillen i topbjælken.'
                : 'A tenant is an isolated context — its own trails, sources, credits and members. You can belong to several and switch between them from the pill in the top bar.'}
            </p>
          </div>
          <button className="btn btn-primary" style={{ padding: '9px 14px', flex: '0 0 auto' }}>
            <window.Icons.Plus size={13} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.04em', textTransform: 'uppercase' }}>
              {isDa ? 'Ny tenant' : 'New tenant'}
            </span>
          </button>
        </div>
      </div>

      {/* Stat strip */}
      <div style={{
        position: 'relative',
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 0, marginBottom: 32,
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg-card)',
        overflow: 'hidden',
      }}>
        <Stat label={isDa ? 'Tenants i alt' : 'Total tenants'} value={tenants.length} />
        <Stat label={isDa ? 'Du ejer' : 'You own'} value={tenants.filter(t => t.role === 'owner').length} divider />
        <Stat label={isDa ? 'Aktive seneste 30 dage' : 'Active last 30d'} value={3} divider />
        <Stat label={isDa ? 'Afventer' : 'Pending'} value={invitations.length} highlight divider />
      </div>

      {/* Tabs */}
      <div style={{
        position: 'relative',
        display: 'flex', gap: 0, marginBottom: 12,
        borderBottom: '1px solid var(--color-border)',
      }}>
        <Tab id="all"          active={tab === 'all'} onClick={() => setTab('all')}>
          {isDa ? 'Alle' : 'All'} <Num>{augmented.length}</Num>
        </Tab>
        <Tab id="owner"        active={tab === 'owner'} onClick={() => setTab('owner')}>
          {isDa ? 'Du administrerer' : 'You manage'} <Num>{augmented.filter(tn => tn.role === 'owner' || tn.role === 'admin').length}</Num>
        </Tab>
        <Tab id="invitations"  active={tab === 'invitations'} onClick={() => setTab('invitations')}>
          {isDa ? 'Invitationer' : 'Invitations'} <Num attention>{invitations.length}</Num>
        </Tab>
      </div>

      {/* Body */}
      <div style={{ position: 'relative' }}>
        {tab === 'invitations' ? (
          <InvitationsList items={invitations} isDa={isDa} />
        ) : (
          <TenantsList
            items={filtered}
            isDa={isDa}
            onSwitch={onSwitch}
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
          />
        )}
      </div>

      {/* Danger zone (only if user owns at least one) */}
      {tab !== 'invitations' && (
        <div style={{ position: 'relative', marginTop: 40, paddingTop: 24, borderTop: '1px dashed var(--color-border-strong)' }}>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-fg-subtle)' }}>
            {isDa ? 'Forlade en tenant' : 'Leave a tenant'}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--color-fg-muted)', maxWidth: 540, lineHeight: 1.55 }}>
            {isDa
              ? 'Brug menuen på den enkelte tenant. Hvis du er sidste ejer, skal en anden forfremmes først — eller tenant\u2019en arkiveres permanent.'
              : 'Use the per-row menu. If you\u2019re the last owner, promote someone else first — or archive the tenant permanently.'}
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, divider, highlight }) {
  return (
    <div style={{
      padding: '16px 20px',
      borderLeft: divider ? '1px solid var(--color-border)' : 'none',
    }}>
      <div className="mono" style={{
        fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase',
        color: 'var(--color-fg-subtle)',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 400,
        marginTop: 4, lineHeight: 1.1,
        color: highlight && value > 0 ? 'var(--color-accent)' : 'var(--color-fg)',
      }}>{value}</div>
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '10px 14px',
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        color: active ? 'var(--color-fg)' : 'var(--color-fg-muted)',
        borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
        marginBottom: -1,
        transition: 'color var(--dur) var(--ease)',
      }}>
      {children}
    </button>
  );
}

function Num({ children, attention }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10.5,
      padding: '1px 6px', borderRadius: 999,
      background: attention ? 'var(--color-accent-soft)' : 'var(--color-bg-sunk)',
      color: attention ? 'var(--color-fg)' : 'var(--color-fg-muted)',
      fontWeight: 500,
      border: '1px solid var(--color-border)',
    }}>{children}</span>
  );
}

function TenantsList({ items, isDa, onSwitch, openMenu, setOpenMenu }) {
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {/* Header row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 90px 110px 120px 40px',
        padding: '10px 18px',
        background: 'var(--color-bg-sunk)',
        borderBottom: '1px solid var(--color-border)',
        fontFamily: 'var(--font-mono)', fontSize: 10,
        letterSpacing: '.08em', textTransform: 'uppercase',
        color: 'var(--color-fg-subtle)',
        gap: 16,
      }}>
        <div>{isDa ? 'Tenant' : 'Tenant'}</div>
        <div>{isDa ? 'Plan' : 'Plan'}</div>
        <div>{isDa ? 'Din rolle' : 'Your role'}</div>
        <div style={{ textAlign: 'right' }}>{isDa ? 'Senest aktiv' : 'Last active'}</div>
        <div></div>
      </div>

      {items.map((tn) => (
        <TenantRow key={tn.slug} tenant={tn} isDa={isDa} onSwitch={onSwitch}
          menuOpen={openMenu === tn.slug}
          onMenuToggle={() => setOpenMenu(openMenu === tn.slug ? null : tn.slug)}
          onMenuClose={() => setOpenMenu(null)}
        />
      ))}
    </div>
  );
}

function TenantRow({ tenant, isDa, onSwitch, menuOpen, onMenuToggle, onMenuClose }) {
  const roleLabel = isDa
    ? { owner: 'ejer', admin: 'admin', editor: 'redaktør', viewer: 'læser' }[tenant.role]
    : tenant.role;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 90px 110px 120px 40px',
      padding: '14px 18px',
      gap: 16, alignItems: 'center',
      borderBottom: '1px solid var(--color-border)',
      transition: 'background var(--dur) var(--ease)',
      position: 'relative',
    }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span style={{
          width: 28, height: 28, borderRadius: 6,
          background: tenant.isCurrent ? 'var(--color-accent)' : 'var(--color-bg-sunk)',
          color: tenant.isCurrent ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
          flex: '0 0 auto',
        }}>
          {tenant.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase().slice(0, 2)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => !tenant.isCurrent && onSwitch && onSwitch(tenant.slug)}
              style={{ fontSize: 14, fontWeight: 500, padding: 0, textAlign: 'left' }}>
              {tenant.name}
            </button>
            {tenant.isCurrent && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5,
                padding: '1px 6px', borderRadius: 3,
                background: 'var(--color-accent-soft)',
                color: 'var(--color-fg)',
                letterSpacing: '.04em', textTransform: 'uppercase',
              }}>{isDa ? 'aktiv' : 'current'}</span>
            )}
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)', marginTop: 2 }}>
            {tenant.slug} · {tenant.trails} {isDa ? (tenant.trails === 1 ? 'trail' : 'trails') : (tenant.trails === 1 ? 'trail' : 'trails')} · {tenant.neurons} {isDa ? 'neuroner' : 'neurons'}
          </div>
        </div>
      </div>

      {/* Plan */}
      <div>
        <span className={"plan-badge " + tenant.plan}>{tenant.plan}</span>
      </div>

      {/* Role */}
      <div style={{ fontSize: 13, color: 'var(--color-fg-muted)', textTransform: 'capitalize' }}>
        {roleLabel}
      </div>

      {/* Last active */}
      <div className="mono" style={{ fontSize: 11, color: 'var(--color-fg-subtle)', textAlign: 'right' }}>
        {tenant.lastActive}
      </div>

      {/* Menu */}
      <div style={{ position: 'relative', textAlign: 'right' }}>
        <button onClick={onMenuToggle} className="icon-btn">
          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor' }} />
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor' }} />
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor' }} />
          </span>
        </button>
        {menuOpen && (
          <RowMenu tenant={tenant} isDa={isDa} onClose={onMenuClose} onSwitch={onSwitch} />
        )}
      </div>
    </div>
  );
}

function RowMenu({ tenant, isDa, onClose, onSwitch }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={onClose} />
      <div className="menu anim-menu" style={{
        position: 'absolute', top: 'calc(100% + 4px)', right: 0,
        width: 200, zIndex: 50, textAlign: 'left',
      }}>
        {!tenant.isCurrent && (
          <button className="menu-item" onClick={() => { onSwitch?.(tenant.slug); onClose(); }}>
            <window.Icons.ArrowRight size={13} style={{ color: 'var(--color-fg-subtle)' }} />
            <span>{isDa ? 'Skift til denne' : 'Switch to this'}</span>
          </button>
        )}
        <button className="menu-item">
          <window.Icons.User size={13} style={{ color: 'var(--color-fg-subtle)' }} />
          <span>{isDa ? 'Medlemmer' : 'Members'}</span>
        </button>
        {(tenant.role === 'owner' || tenant.role === 'admin') && (
          <button className="menu-item">
            <window.Icons.CreditCard size={13} style={{ color: 'var(--color-fg-subtle)' }} />
            <span>{isDa ? 'Plan & billing' : 'Plan & billing'}</span>
          </button>
        )}
        <button className="menu-item">
          <window.Icons.Settings size={13} style={{ color: 'var(--color-fg-subtle)' }} />
          <span>{isDa ? 'Indstillinger' : 'Settings'}</span>
        </button>
        <div className="menu-sep" />
        <button className="menu-item is-danger">
          <window.Icons.LogOut size={13} />
          <span>{isDa ? 'Forlad tenant' : 'Leave tenant'}</span>
        </button>
      </div>
    </>
  );
}

function InvitationsList({ items, isDa }) {
  if (items.length === 0) {
    return (
      <div style={{
        padding: '60px 24px', textAlign: 'center',
        background: 'var(--color-bg-card)',
        border: '1px dashed var(--color-border-strong)',
        borderRadius: 'var(--radius-lg)',
      }}>
        <window.Icons.Inbox size={24} style={{ color: 'var(--color-fg-subtle)', marginBottom: 12 }} />
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, marginBottom: 4 }}>
          {isDa ? 'Ingen afventende invitationer' : 'No pending invitations'}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-fg-muted)' }}>
          {isDa ? 'Når nogen inviterer dig til en tenant, vises det her.' : 'Invitations to other tenants appear here.'}
        </div>
      </div>
    );
  }
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {items.map((inv, i) => (
        <div key={inv.tenant} style={{
          padding: '16px 18px',
          display: 'flex', alignItems: 'center', gap: 16,
          borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--color-border)',
        }}>
          <span style={{
            width: 32, height: 32, borderRadius: 6,
            background: 'var(--color-bg-sunk)',
            color: 'var(--color-fg-muted)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
            flex: '0 0 auto',
          }}>
            {inv.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{inv.name}</span>
              <span className={"plan-badge " + inv.plan}>{inv.plan}</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10,
                padding: '1px 6px', borderRadius: 3,
                background: 'var(--color-bg-sunk)',
                color: 'var(--color-fg-muted)',
                border: '1px solid var(--color-border)',
              }}>{inv.role}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-fg-muted)', marginTop: 4 }}>
              {isDa ? 'Inviteret af' : 'Invited by'} <span className="mono" style={{ fontSize: 11 }}>{inv.invitedBy}</span> · {inv.when}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
            <button className="btn" style={{ padding: '6px 12px', fontSize: 12.5 }}>
              {isDa ? 'Afvis' : 'Decline'}
            </button>
            <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12.5 }}>
              {isDa ? 'Accepter' : 'Accept'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

window.ManageTenants = ManageTenants;
