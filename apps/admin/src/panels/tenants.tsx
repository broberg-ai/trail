import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  fetchAuthMe,
  switchTenant,
  listInvitations,
  createInvitation,
  createTenant,
  revokeInvitation,
  type AuthMe,
  type AuthTenant,
  type Invitation,
  type InvitationRole,
} from '../api';
import { useLocale, getLocale, t } from '../lib/i18n';
import { Icons } from '../components/ui/icons';
import { CenteredLoader } from '../components/centered-loader';

/**
 * F186 — Manage Tenants. Ported 1:1 from
 * docs/design/trail_app/src/manage-tenants.jsx.
 *
 * Stat-strip (Total/Owned/Active 30d/Pending), three tabs (All / You
 * manage / Invitations), per-row action menu. Per F186 Q9.x:
 *
 *   - Invitations-tab and Members/Plan-billing/Leave actions surface a
 *     "Coming Soon" toast (real flow lives in F187 + future plan-doc).
 *   - "Switch to" action is wired (uses switchTenant from api.ts).
 *   - "Active 30d" stat reads activity_log via the existing engine
 *     endpoints if present, otherwise renders "—" so the design doesn't
 *     break on missing data.
 */
export function ManageTenantsPanel() {
  useLocale();
  const [me, setMe] = useState<AuthMe | null>(null);
  const [tab, setTab] = useState<'all' | 'owner' | 'invitations'>('all');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  // F210.1 — create a tenant for a customer.
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function loadInvitations() {
    listInvitations()
      .then((r) => setInvitations(r.invitations))
      .catch(() => setInvitations([]));
  }

  useEffect(() => {
    fetchAuthMe().then(setMe).catch(() => setMe(null));
    loadInvitations();
  }, []);

  if (!me) {
    return (
      <div style={{ padding: 60 }}>
        <CenteredLoader label="Loading…" />
      </div>
    );
  }

  const isDa = getLocale() === 'da';
  const tenants = me.tenants;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }
  function showComingSoon() {
    showToast(t('comingSoonToast'));
  }

  /** Mirror of the server's slugify — shown BEFORE submit because the slug
   *  names the customer's data directory on the engine and cannot be renamed
   *  afterwards. Preview only; the server derives the real one. */
  function previewSlug(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async function submitNewTenant() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createTenant({ name });
      setNewOpen(false);
      setNewName('');
      showToast(isDa ? `Oprettet: ${created.name}` : `Created: ${created.name}`);
      // Re-read from the server rather than pushing the new tenant into local
      // state: the switcher must show what the server actually stored.
      const fresh = await fetchAuthMe();
      setMe(fresh);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCreateError(
        /409|taken/i.test(msg)
          ? (isDa
              ? `Navnet er optaget — "${previewSlug(name)}" findes allerede.`
              : `That name is taken — "${previewSlug(name)}" already exists.`)
          : msg,
      );
    } finally {
      setCreating(false);
    }
  }

  const pendingCount = invitations.filter((i) => i.status === 'pending').length;

  const filtered = tab === 'all' ? tenants : tab === 'owner' ? tenants : [];

  return (
    <div class="page-shell" data-testid="tenants-root" style={{ position: 'relative', maxWidth: 920, marginLeft: 0 }}>
      <div class="constellation" style={{ opacity: 0.35 }} />

      {/* Header */}
      <header style={{ position: 'relative', marginBottom: 32 }}>
        <div
          class="mono"
          style={{
            fontSize: 10.5,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-fg-subtle)',
            marginBottom: 8,
          }}
        >
          {t('manageTenants.crumb')}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 32, letterSpacing: '-0.015em' }}>
              {t('manageTenants.heading')}
            </h1>
            <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--color-fg-muted)', maxWidth: 560, lineHeight: 1.55 }}>
              {t('manageTenants.subtitle')}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="tenants-new-button"
            style={{ flex: '0 0 auto' }}
            onClick={() => { setNewOpen((v) => !v); setCreateError(null); }}
          >
            <Icons.Plus size={13} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {t('manageTenants.newTenant')}
            </span>
          </button>
        </div>

        {/* F210.1 — create-tenant form. Inline rather than a modal: it is two
            fields and the page behind it is the list the new row lands in. */}
        {newOpen ? (
          <div
            data-testid="tenants-new-form"
            style={{
              marginTop: 20,
              padding: '18px 20px',
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 16, marginBottom: 2 }}>
              {isDa ? 'Ny konto' : 'New tenant'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-fg-muted)', marginBottom: 16 }}>
              {isDa
                ? 'Til en kunde. Du bliver ejer af den med det samme.'
                : 'For a customer. You become its owner immediately.'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <input
                  class="input"
                  data-testid="tenants-new-name-input"
                  type="text"
                  autocomplete="off"
                  placeholder={isDa ? 'F.eks. FD Aalborg' : 'e.g. FD Aalborg'}
                  value={newName}
                  onInput={(e) => { setNewName((e.target as HTMLInputElement).value); setCreateError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submitNewTenant(); }}
                />
                {newName.trim() ? (
                  <div
                    class="mono"
                    data-testid="tenants-new-slug-preview"
                    style={{ marginTop: 6, fontSize: 11.5, color: 'var(--color-fg-subtle)' }}
                  >
                    {isDa ? 'Kort navn: ' : 'Slug: '}
                    {previewSlug(newName) || (isDa ? '(ugyldigt)' : '(invalid)')}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                class="btn btn-primary"
                data-testid="tenants-new-submit"
                disabled={!previewSlug(newName) || creating}
                style={{ flex: '0 0 auto', opacity: !previewSlug(newName) || creating ? 0.55 : 1 }}
                onClick={() => void submitNewTenant()}
              >
                <span>{creating ? (isDa ? 'Opretter…' : 'Creating…') : (isDa ? 'Opret' : 'Create')}</span>
              </button>
            </div>
            {createError ? (
              <div
                data-testid="tenants-new-error"
                style={{ marginTop: 12, fontSize: 12.5, color: 'var(--color-danger)' }}
              >
                {createError}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Stat strip */}
      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 0,
          marginBottom: 32,
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-bg-card)',
          overflow: 'hidden',
        }}
      >
        <Stat label={t('manageTenants.statTotal')} value={tenants.length} />
        <Stat label={t('manageTenants.statOwned')} value={tenants.length} divider />
        <Stat label={t('manageTenants.statActive30d')} value="—" divider />
        <Stat label={t('manageTenants.statPending')} value={pendingCount} highlight divider />
      </div>

      {/* Tabs */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          gap: 0,
          marginBottom: 12,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Tab active={tab === 'all'} onClick={() => setTab('all')}>
          {t('manageTenants.tabAll')} <Num>{tenants.length}</Num>
        </Tab>
        <Tab active={tab === 'owner'} onClick={() => setTab('owner')}>
          {t('manageTenants.tabYouManage')} <Num>{tenants.length}</Num>
        </Tab>
        <Tab active={tab === 'invitations'} onClick={() => setTab('invitations')}>
          {t('manageTenants.tabInvitations')} <Num attention>{pendingCount}</Num>
        </Tab>
      </div>

      {/* Body */}
      <div style={{ position: 'relative' }}>
        {tab === 'invitations' ? (
          <InvitationsTab
            invitations={invitations}
            onChanged={loadInvitations}
            onToast={showToast}
          />
        ) : (
          <TenantsList
            items={filtered}
            isDa={isDa}
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
            onComingSoon={showComingSoon}
          />
        )}
      </div>

      {/* Danger zone */}
      {tab !== 'invitations' ? (
        <div
          style={{
            position: 'relative',
            marginTop: 40,
            paddingTop: 24,
            borderTop: '1px dashed var(--color-border-strong)',
          }}
        >
          <div
            class="mono"
            style={{
              fontSize: 10.5,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-fg-subtle)',
            }}
          >
            {isDa ? 'Forlade en tenant' : 'Leave a tenant'}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--color-fg-muted)', maxWidth: 540, lineHeight: 1.55 }}>
            {isDa
              ? 'Brug menuen på den enkelte tenant. Hvis du er sidste ejer, skal en anden forfremmes først — eller tenant’en arkiveres permanent. (F187 — Coming soon.)'
              : 'Use the per-row menu. If you’re the last owner, promote someone else first — or archive the tenant permanently. (F187 — Coming soon.)'}
          </p>
        </div>
      ) : null}

      {toast ? (
        <div
          class="anim-fade"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 16px',
            borderRadius: 999,
            background: 'var(--color-fg)',
            color: 'var(--color-bg)',
            fontSize: 13,
            boxShadow: 'var(--shadow-lg)',
            zIndex: 100,
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

function Stat({ label, value, divider, highlight }: { label: string; value: number | string; divider?: boolean; highlight?: boolean }) {
  return (
    <div style={{ padding: '16px 20px', borderLeft: divider ? '1px solid var(--color-border)' : 'none' }}>
      <div
        class="mono"
        style={{
          fontSize: 9.5,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-fg-subtle)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 24,
          fontWeight: 400,
          marginTop: 4,
          lineHeight: 1.1,
          color: highlight && typeof value === 'number' && value > 0 ? 'var(--color-accent)' : 'var(--color-fg)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: JSX.Element | string | (JSX.Element | string)[] }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '10px 14px',
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        color: active ? 'var(--color-fg)' : 'var(--color-fg-muted)',
        borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
        marginBottom: -1,
        background: 'transparent',
        border: 'none',
        borderRadius: 0,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Num({ children, attention }: { children: JSX.Element | string | number; attention?: boolean }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        padding: '1px 6px',
        borderRadius: 999,
        background: attention ? 'var(--color-accent-soft)' : 'var(--color-bg-sunk)',
        color: attention ? 'var(--color-fg)' : 'var(--color-fg-muted)',
        fontWeight: 500,
        border: '1px solid var(--color-border)',
      }}
    >
      {children}
    </span>
  );
}

// F187.4 — localise the per-tenant role for display.
function roleLabel(role: string, isDa: boolean): string {
  const map: Record<string, [string, string]> = {
    owner: ['Ejer', 'Owner'],
    admin: ['Admin', 'Admin'],
    member: ['Medlem', 'Member'],
  };
  const pair = map[role];
  if (pair) return isDa ? pair[0] : pair[1];
  return role; // unknown role → show raw (capitalize handled by CSS)
}

function TenantsList({
  items,
  isDa,
  openMenu,
  setOpenMenu,
  onComingSoon,
}: {
  items: AuthTenant[];
  isDa: boolean;
  openMenu: string | null;
  setOpenMenu: (slug: string | null) => void;
  onComingSoon: () => void;
}) {
  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        // Clip rounded corners normally, but let an open row-menu escape
        // the box instead of being clipped behind the list below it.
        overflow: openMenu ? 'visible' : 'hidden',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 90px 110px 120px 40px',
          padding: '10px 18px',
          background: 'var(--color-bg-sunk)',
          borderBottom: '1px solid var(--color-border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-fg-subtle)',
          gap: 16,
        }}
      >
        <div>{isDa ? 'Tenant' : 'Tenant'}</div>
        <div>{isDa ? 'Plan' : 'Plan'}</div>
        <div>{isDa ? 'Din rolle' : 'Your role'}</div>
        <div style={{ textAlign: 'right' }}>{isDa ? 'Senest aktiv' : 'Last active'}</div>
        <div />
      </div>

      {items.map((tn) => (
        <TenantRow
          key={tn.slug}
          tenant={tn}
          isDa={isDa}
          menuOpen={openMenu === tn.slug}
          onMenuToggle={() => setOpenMenu(openMenu === tn.slug ? null : tn.slug)}
          onMenuClose={() => setOpenMenu(null)}
          onComingSoon={onComingSoon}
        />
      ))}
    </div>
  );
}

function TenantRow({
  tenant,
  isDa,
  menuOpen,
  onMenuToggle,
  onMenuClose,
  onComingSoon,
}: {
  tenant: AuthTenant;
  isDa: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onComingSoon: () => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 90px 110px 120px 40px',
        padding: '14px 18px',
        gap: 16,
        alignItems: 'center',
        borderBottom: '1px solid var(--color-border)',
        position: 'relative',
        // Lift the open row so its dropdown stacks above sibling rows below.
        zIndex: menuOpen ? 30 : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: tenant.active ? 'var(--color-accent)' : 'var(--color-bg-sunk)',
            color: tenant.active ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 600,
            flex: '0 0 auto',
          }}
        >
          {tenant.name.split(' ').slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase().slice(0, 2)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={async () => {
                if (tenant.active) return;
                try {
                  await switchTenant(tenant.slug);
                  window.location.href = '/';
                } catch { /* ignore */ }
              }}
              style={{ fontSize: 14, fontWeight: 500, padding: 0, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-fg)' }}
            >
              {tenant.name}
            </button>
            {tenant.active ? (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9.5,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'var(--color-accent-soft)',
                  color: 'var(--color-fg)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {isDa ? 'aktiv' : 'current'}
              </span>
            ) : null}
          </div>
          <div class="mono" style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)', marginTop: 2 }}>
            {tenant.slug}
          </div>
        </div>
      </div>

      <div>{tenant.plan ? <span class={'plan-badge ' + tenant.plan}>{tenant.plan}</span> : <span class="mono" style={{ fontSize: 11, color: 'var(--color-fg-subtle)' }}>—</span>}</div>

      <div style={{ fontSize: 13, color: 'var(--color-fg-muted)', textTransform: 'capitalize' }}>
        {roleLabel(tenant.role, isDa)}
      </div>

      <div class="mono" style={{ fontSize: 11, color: 'var(--color-fg-subtle)', textAlign: 'right' }}>
        —
      </div>

      <div style={{ position: 'relative', textAlign: 'right' }}>
        <button type="button" class="icon-btn" onClick={onMenuToggle} aria-label="Row menu">
          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor' }} />
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor' }} />
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor' }} />
          </span>
        </button>
        {menuOpen ? (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={onMenuClose} />
            <div
              class="menu anim-menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                width: 200,
                zIndex: 50,
                textAlign: 'left',
              }}
            >
              {!tenant.active ? (
                <button
                  type="button"
                  class="menu-item"
                  onClick={async () => {
                    onMenuClose();
                    try {
                      await switchTenant(tenant.slug);
                      window.location.href = '/';
                    } catch { /* ignore */ }
                  }}
                >
                  <Icons.ArrowRight size={13} style={{ color: 'var(--color-fg-subtle)' }} />
                  <span>{isDa ? 'Skift til denne' : 'Switch to this'}</span>
                </button>
              ) : null}
              <button type="button" class="menu-item" onClick={() => { onMenuClose(); onComingSoon(); }}>
                <Icons.User size={13} style={{ color: 'var(--color-fg-subtle)' }} />
                <span>{isDa ? 'Medlemmer' : 'Members'}</span>
              </button>
              <button type="button" class="menu-item" onClick={() => { onMenuClose(); onComingSoon(); }}>
                <Icons.CreditCard size={13} style={{ color: 'var(--color-fg-subtle)' }} />
                <span>{isDa ? 'Plan & billing' : 'Plan & billing'}</span>
              </button>
              <button
                type="button"
                class="menu-item"
                onClick={() => { onMenuClose(); window.location.href = `/kb/${tenant.slug}/settings`; }}
              >
                <Icons.Settings size={13} style={{ color: 'var(--color-fg-subtle)' }} />
                <span>{isDa ? 'Indstillinger' : 'Settings'}</span>
              </button>
              <div class="menu-sep" />
              <button type="button" class="menu-item is-danger" onClick={() => { onMenuClose(); onComingSoon(); }}>
                <Icons.LogOut size={13} />
                <span>{isDa ? 'Forlad tenant' : 'Leave tenant'}</span>
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

function InvitationsTab({
  invitations,
  onChanged,
  onToast,
}: {
  invitations: Invitation[];
  onChanged: () => void;
  onToast: (msg: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitationRole>('member');
  const [sending, setSending] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const emailValid = EMAIL_RE.test(email.trim());

  async function send() {
    const value = email.trim().toLowerCase();
    if (!emailValid || sending) return;
    setSending(true);
    try {
      const res = await createInvitation({ email: value, role });
      onToast(t(res.action === 'reinvited' ? 'manageTenants.invite.resent' : 'manageTenants.invite.sent', { email: value }));
      setEmail('');
      onChanged();
    } catch {
      onToast(t('manageTenants.invite.error'));
    } finally {
      setSending(false);
    }
  }

  async function revoke(id: string) {
    if (revokingId) return;
    setRevokingId(id);
    try {
      await revokeInvitation(id);
      onToast(t('manageTenants.invite.revoked'));
      onChanged();
    } catch {
      onToast(t('manageTenants.invite.revokeError'));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Invite form */}
      <div
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: 20,
        }}
      >
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 16, marginBottom: 2 }}>
          {t('manageTenants.invite.formTitle')}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-fg-muted)', marginBottom: 16 }}>
          {t('manageTenants.invite.formHint')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <input
              class="input"
              type="email"
              inputMode="email"
              autocomplete="off"
              placeholder={t('manageTenants.invite.emailPlaceholder')}
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            />
          </div>
          <RolePicker value={role} onChange={setRole} />
          <button
            type="button"
            class="btn btn-primary"
            disabled={!emailValid || sending}
            style={{ flex: '0 0 auto', opacity: !emailValid || sending ? 0.55 : 1 }}
            onClick={send}
          >
            <Icons.Plus size={13} />
            <span>{sending ? t('manageTenants.invite.sending') : t('manageTenants.invite.send')}</span>
          </button>
        </div>
      </div>

      {/* List */}
      {invitations.length === 0 ? (
        <div
          style={{
            padding: '52px 24px',
            textAlign: 'center',
            background: 'var(--color-bg-card)',
            border: '1px dashed var(--color-border-strong)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <Icons.Inbox size={28} style={{ color: 'var(--color-fg-subtle)', marginBottom: 12 }} />
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, marginBottom: 6 }}>
            {t('manageTenants.invite.emptyTitle')}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--color-fg-muted)', maxWidth: 360, margin: '0 auto', lineHeight: 1.5 }}>
            {t('manageTenants.invite.emptyBody')}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 90px 130px 110px 90px',
              padding: '10px 18px',
              background: 'var(--color-bg-sunk)',
              borderBottom: '1px solid var(--color-border)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-fg-subtle)',
              gap: 16,
            }}
          >
            <div>{t('manageTenants.invite.colEmail')}</div>
            <div>{t('manageTenants.invite.colRole')}</div>
            <div>{t('manageTenants.invite.colInvitedBy')}</div>
            <div>{t('manageTenants.invite.colStatus')}</div>
            <div style={{ textAlign: 'right' }} />
          </div>
          {invitations.map((inv) => (
            <div
              key={inv.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 90px 130px 110px 90px',
                padding: '13px 18px',
                gap: 16,
                alignItems: 'center',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <div style={{ minWidth: 0, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {inv.email}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-fg-muted)', textTransform: 'capitalize' }}>
                {inv.role}
              </div>
              <div class="mono" style={{ fontSize: 11.5, color: 'var(--color-fg-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {inv.invitedBy ?? '—'}
              </div>
              <div>
                <StatusBadge status={inv.status} />
              </div>
              <div style={{ textAlign: 'right' }}>
                {inv.status === 'pending' ? (
                  <button
                    type="button"
                    class="btn btn-ghost btn-danger"
                    disabled={revokingId === inv.id}
                    style={{ fontSize: 11.5, padding: '4px 10px' }}
                    onClick={() => revoke(inv.id)}
                  >
                    {revokingId === inv.id ? t('manageTenants.invite.revoking') : t('manageTenants.invite.revoke')}
                  </button>
                ) : (
                  <span class="mono" style={{ fontSize: 11, color: 'var(--color-fg-subtle)' }}>—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RolePicker({ value, onChange }: { value: InvitationRole; onChange: (r: InvitationRole) => void }) {
  const opts: { id: InvitationRole; label: string }[] = [
    { id: 'member', label: t('manageTenants.invite.roleMember') },
    { id: 'admin', label: t('manageTenants.invite.roleAdmin') },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t('manageTenants.invite.roleLabel')}
      style={{
        display: 'inline-flex',
        flex: '0 0 auto',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        background: 'var(--color-bg-sunk)',
      }}
    >
      {opts.map((o, i) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            style={{
              padding: '8px 14px',
              fontSize: 12.5,
              fontWeight: active ? 600 : 400,
              border: 'none',
              borderLeft: i > 0 ? '1px solid var(--color-border)' : 'none',
              background: active ? 'var(--color-bg-card)' : 'transparent',
              color: active ? 'var(--color-fg)' : 'var(--color-fg-muted)',
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: Invitation['status'] }) {
  const map: Record<Invitation['status'], { bg: string; fg: string; key: string }> = {
    pending: { bg: 'var(--color-accent-soft)', fg: 'var(--color-fg)', key: 'manageTenants.invite.statusPending' },
    accepted: { bg: 'rgba(21,128,61,0.14)', fg: 'var(--color-success)', key: 'manageTenants.invite.statusAccepted' },
    revoked: { bg: 'var(--color-bg-sunk)', fg: 'var(--color-fg-subtle)', key: 'manageTenants.invite.statusRevoked' },
    expired: { bg: 'var(--color-bg-sunk)', fg: 'var(--color-fg-subtle)', key: 'manageTenants.invite.statusExpired' },
  };
  const s = map[status];
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9.5,
        padding: '2px 8px',
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        border: '1px solid var(--color-border)',
      }}
    >
      {t(s.key)}
    </span>
  );
}
