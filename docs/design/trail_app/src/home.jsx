// =====================================================================
// Trail — Home + Empty states
// =====================================================================

function HomeView({ tenant, trails, emptyState, t, locale, onOpenTrail }) {
  // emptyState: 'none' | 'no-trails' | 'no-neurons' | 'no-tenants'

  if (emptyState === 'no-tenants') {
    return (
      <EmptyShell
        icon={<window.Icons.Building size={28} />}
        title={t.emptyTenantsTitle}
        body={t.emptyTenantsBody}
        ctaIcon={<window.Icons.Plus size={14} />}
        cta={t.emptyTenantsCTA}
        secondary={locale === 'da' ? 'Bed om invitation' : 'Request invitation'}
      />
    );
  }

  if (emptyState === 'no-trails' || trails.length === 0) {
    return (
      <div style={{ position: 'relative', padding: '60px 28px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div className="constellation" style={{ opacity: .5 }} />
        <PageHeader title={t.trails} subtitle={t.serverNeurons(tenant.neurons)} cta={t.newTrail} />
        <EmptyShell
          inline
          icon={<window.Icons.Network size={28} />}
          title={t.emptyTrailsTitle}
          body={t.emptyTrailsBody}
          ctaIcon={<window.Icons.Plus size={14} />}
          cta={t.emptyTrailsCTA}
        />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', padding: '60px 28px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <div className="constellation" style={{ opacity: .5 }} />
      <PageHeader title={t.trails} subtitle={t.serverNeurons(tenant.neurons)} cta={t.newTrail} />

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {trails.map(trail => (
          <a key={trail.slug} href="#" className="trail-row"
            onClick={(e) => { e.preventDefault(); onOpenTrail && onOpenTrail(trail.slug); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '18px 24px',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-card)',
              textDecoration: 'none', color: 'var(--color-fg)',
              transition: 'all var(--dur) var(--ease)',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{trail.name}</div>
              <div style={{ fontSize: 13, color: 'var(--color-fg-muted)', marginTop: 4 }}>{trail.desc}</div>
            </div>
            <span style={{
              padding: '3px 8px', borderRadius: 999,
              background: 'var(--color-accent-soft)', color: 'var(--color-fg)',
              fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 500,
            }}>{trail.neurons}</span>
            <span className="mono" style={{
              fontSize: 11, color: 'var(--color-fg-subtle)',
              minWidth: 120, textAlign: 'right',
            }}>{trail.slug}</span>
          </a>
        ))}
      </div>

      {emptyState === 'no-neurons' && (
        <div style={{ marginTop: 24 }}>
          <EmptyShell
            inline
            icon={<window.Icons.FileText size={24} />}
            title={t.emptyNeuronsTitle}
            body={t.emptyNeuronsBody}
            ctaIcon={<window.Icons.Upload size={14} />}
            cta={t.emptyNeuronsCTA}
          />
        </div>
      )}
    </div>
  );
}

function PageHeader({ title, subtitle, cta }) {
  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      gap: 24, marginBottom: 32,
    }}>
      <div>
        <h1 style={{
          margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400,
          fontSize: 32, letterSpacing: '-0.015em',
        }}>{title}</h1>
        <div className="mono" style={{
          marginTop: 6, fontSize: 12, color: 'var(--color-fg-muted)',
        }}>{subtitle}</div>
      </div>
      {cta && (
        <button className="btn">
          <window.Icons.Plus size={13} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.04em', textTransform: 'uppercase' }}>
            {cta}
          </span>
        </button>
      )}
    </div>
  );
}

function EmptyShell({ icon, title, body, cta, secondary, ctaIcon, inline }) {
  return (
    <div style={{
      position: 'relative',
      padding: inline ? '60px 24px 70px' : '80px 24px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      textAlign: 'center', gap: 16,
      border: inline ? '1px dashed var(--color-border-strong)' : 'none',
      borderRadius: inline ? 'var(--radius-lg)' : 0,
      background: inline ? 'var(--color-bg-card)' : 'transparent',
      maxWidth: inline ? 'none' : 480,
      margin: inline ? '0' : '60px auto',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-accent-soft)',
        color: 'var(--color-accent)',
      }}>{icon}</div>
      <h2 style={{
        margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400,
        fontSize: 22, letterSpacing: '-0.01em',
      }}>{title}</h2>
      <p style={{
        margin: 0, fontSize: 13.5, color: 'var(--color-fg-muted)',
        maxWidth: 440, lineHeight: 1.55,
      }}>{body}</p>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button className="btn btn-primary" style={{ padding: '9px 16px' }}>
          {ctaIcon}
          <span>{cta}</span>
        </button>
        {secondary && (
          <button className="btn btn-ghost" style={{ padding: '9px 14px' }}>
            <span>{secondary}</span>
          </button>
        )}
      </div>
    </div>
  );
}

window.HomeView = HomeView;
