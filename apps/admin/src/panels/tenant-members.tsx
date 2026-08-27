import { useEffect, useState } from 'preact/hooks';
import {
  fetchTenantMembers,
  updateMemberRole,
  removeMember,
  createInvitation,
  type TenantMembers,
  type TenantMember,
} from '../api';
import { Dropdown } from '../components/dropdown';
import { Icons } from '../components/ui/icons';
import { PanelHeader } from '../components/ui/panel-header';
import { getLocale } from '../lib/i18n';

/**
 * F210.3 — Members of a tenant.
 *
 * The surface behind the "Members" item in the per-tenant … menu, which until
 * now fired a Coming-soon toast naming F186 — a dead end, since F186 stubbed
 * it deliberately and pointed at F187, and F187 shipped invitations that
 * always landed in the INVITER's own account.
 *
 * The design decision this screen encodes: the tenant's name is in the
 * heading AND in the invite box, because the failure it replaces was an
 * invitation quietly going somewhere other than where the curator was
 * looking. Ambiguity about "who am I inviting to" is the bug.
 */

const ROLE_LABELS: Record<string, { da: string; en: string; hintDa: string; hintEn: string }> = {
  owner: { da: 'Ejer', en: 'Owner', hintDa: 'Fuld adgang', hintEn: 'Full access' },
  admin: { da: 'Admin', en: 'Admin', hintDa: 'Kan invitere', hintEn: 'Can invite' },
  member: { da: 'Medlem', en: 'Member', hintDa: 'Læse og skrive', hintEn: 'Read and write' },
};

export function TenantMembersPanel({ tenantId }: { tenantId: string }) {
  const isDa = getLocale() === 'da';
  const [data, setData] = useState<TenantMembers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TenantMember['role']>('member');
  const [inviting, setInviting] = useState(false);

  function say(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  async function load() {
    try {
      setData(await fetchTenantMembers(tenantId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void load(); }, [tenantId]);

  async function changeRole(m: TenantMember, role: string) {
    if (role === m.role) return;
    setBusy(m.userId);
    try {
      await updateMemberRole(tenantId, m.userId, role as TenantMember['role']);
      // Re-read from the server rather than patching local state: the whole
      // point of this screen is showing what the control plane actually holds.
      await load();
      say(isDa ? `Rolle ændret til ${label(role)}` : `Role changed to ${label(role)}`);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function drop(m: TenantMember) {
    setBusy(m.userId);
    try {
      await removeMember(tenantId, m.userId);
      await load();
      say(isDa ? `${m.email} fjernet` : `${m.email} removed`);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function invite(e: Event) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    try {
      await createInvitation({ email, role: inviteRole as never, tenantId });
      setInviteEmail('');
      await load();
      say(isDa ? `Invitation sendt til ${email}` : `Invitation sent to ${email}`);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    } finally {
      setInviting(false);
    }
  }

  function label(role: string): string {
    const r = ROLE_LABELS[role];
    return r ? (isDa ? r.da : r.en) : role;
  }
  const roleOptions = Object.entries(ROLE_LABELS).map(([value, r]) => ({
    value,
    label: isDa ? r.da : r.en,
    hint: isDa ? r.hintDa : r.hintEn,
  }));

  if (error) {
    return (
      <div class="p-10 text-center" data-testid="tenant-members-error">
        <p class="text-[color:var(--color-fg-muted)]">{error}</p>
      </div>
    );
  }
  if (!data) {
    return <div class="p-10 text-center text-[color:var(--color-fg-subtle)]">…</div>;
  }

  const summary =
    `${data.members.length} ${isDa ? 'medlemmer' : 'members'}` +
    (data.pending.length > 0
      ? ` · ${data.pending.length} ${isDa ? 'afventer' : 'pending'}`
      : '');

  return (
    // Same shell as every other panel: .page-shell is left-aligned on purpose
    // (see index.css — centred panels drifting right on wide viewports was
    // already reported once), maxWidth 920 + marginLeft 0 mirrors the sibling
    // Manage-tenants page so the two do not sit at different left edges.
    <div
      class="page-shell"
      data-testid="tenant-members-root"
      style={{ position: 'relative', maxWidth: 920, marginLeft: 0 }}
    >
      <div class="constellation" style={{ opacity: 0.35 }} />

      {/* Breadcrumb — you are inside ONE customer, and it says which. */}
      <div class="flex items-center gap-2 text-xs text-[color:var(--color-fg-subtle)] mb-3.5 flex-wrap relative">
        <a
          href="/tenants"
          data-testid="tenant-members-breadcrumb-back"
          class="text-[color:var(--color-fg-muted)] no-underline hover:underline"
        >
          {isDa ? 'Administrer tenants' : 'Manage tenants'}
        </a>
        <span class="text-[color:var(--color-fg-faint)]">›</span>
        <span class="text-[color:var(--color-fg)]">{data.tenant.name}</span>
        <span class="font-mono text-[10.5px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-[color:var(--color-border)] text-[color:var(--color-fg-muted)]">
          {data.tenant.slug}
        </span>
      </div>

      <PanelHeader
        title={isDa ? 'Medlemmer' : 'Members'}
        subtitle={<span data-testid="tenant-members-summary">{summary}</span>}
      />

      <div
        class="bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-xl overflow-hidden"
        data-testid="tenant-members-list"
      >
        {data.members.map((m) => (
          <div
            key={m.userId}
            class="flex items-center gap-3.5 px-4 py-3 border-b border-[color:var(--color-border)] last:border-b-0 hover:bg-[color:var(--color-hover)]"
            data-testid={`member-row-${m.email}`}
          >
            <div class="w-8 h-8 rounded-full bg-[color:var(--color-accent-soft)] grid place-items-center text-xs font-semibold shrink-0">
              {initials(m)}
            </div>
            <div class="min-w-0 flex-1">
              <div class="font-medium flex items-center gap-2 flex-wrap">
                {m.name ?? m.email.split('@')[0]}
                {m.isSelf ? (
                  <span class="font-mono text-[10.5px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[color:var(--color-bg-sunk)] border border-[color:var(--color-border)] text-[color:var(--color-fg-muted)]">
                    {isDa ? 'dig' : 'you'}
                  </span>
                ) : null}
              </div>
              <div class="font-mono text-[11.5px] text-[color:var(--color-fg-subtle)] truncate">{m.email}</div>
            </div>
            <div class="font-mono text-[11.5px] text-[color:var(--color-fg-subtle)] whitespace-nowrap hidden sm:block">
              {formatJoined(m.joinedAt, isDa)}
            </div>
            <Dropdown
              testid={`member-role-${m.email}`}
              value={m.role}
              onChange={(v) => void changeRole(m, v)}
              options={roleOptions}
              disabled={m.locked || busy === m.userId}
              hintInMenuOnly
              buttonClass="w-[118px]"
            />
            {m.locked ? (
              <span
                class="font-mono text-[11px] text-[color:var(--color-fg-subtle)] whitespace-nowrap"
                title={isDa ? 'Ejeridentitet — kan ikke ændres eller fjernes' : 'Owner identity — cannot be changed or removed'}
                data-testid={`member-locked-${m.email}`}
              >
                {isDa ? 'låst' : 'locked'}
              </span>
            ) : (
              <button
                type="button"
                class="p-1.5 rounded-md text-[color:var(--color-fg-subtle)] hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-hover)] active:bg-[color:var(--color-active)] disabled:opacity-40"
                title={isDa ? 'Fjern fra tenant' : 'Remove from tenant'}
                disabled={busy === m.userId}
                onClick={() => void drop(m)}
                data-testid={`member-remove-${m.email}`}
              >
                <Icons.X size={14} />
              </button>
            )}
          </div>
        ))}

        {/* A pending invitation is a ROW here, not a tab the curator has to
            remember to open — it is the same question ("who is in this?"). */}
        {data.pending.map((p) => (
          <div
            key={p.email}
            class="flex items-center gap-3.5 px-4 py-3 border-b border-[color:var(--color-border)] last:border-b-0 bg-[color:var(--color-bg-sunk)]"
            data-testid={`member-pending-${p.email}`}
          >
            <div class="w-8 h-8 rounded-full border border-dashed border-[color:var(--color-border-strong)] grid place-items-center text-xs text-[color:var(--color-fg-subtle)] shrink-0">
              ?
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-[color:var(--color-fg-muted)] flex items-center gap-2 flex-wrap">
                {isDa ? 'Invitation sendt' : 'Invitation sent'}
                <span class="font-mono text-[10.5px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-dashed border-[color:var(--color-border)] text-[color:var(--color-fg-subtle)]">
                  {isDa ? 'afventer' : 'pending'}
                </span>
              </div>
              <div class="font-mono text-[11.5px] text-[color:var(--color-fg-subtle)] truncate">{p.email}</div>
            </div>
            <div class="font-mono text-[11.5px] text-[color:var(--color-fg-subtle)] whitespace-nowrap">
              {label(p.role)}
            </div>
          </div>
        ))}
      </div>

      {/* Invite — the tenant's name is IN the box, so there is no way to be
          unsure which account this person is about to land in. */}
      <form
        class="mt-6 bg-[color:var(--color-bg-sunk)] border border-[color:var(--color-border)] rounded-xl p-4"
        onSubmit={(e) => void invite(e)}
        data-testid="tenant-members-invite-form"
      >
        <h2 class="font-[family-name:var(--font-serif)] text-base font-semibold m-0 mb-1">
          {isDa ? `Inviter til ${data.tenant.name}` : `Invite to ${data.tenant.name}`}
        </h2>
        <p class="m-0 mb-3 text-[13px] text-[color:var(--color-fg-muted)]">
          {isDa
            ? `Personen får et magisk link og lander i ${data.tenant.name}s konto — ikke i din.`
            : `They get a magic link and land in ${data.tenant.name}'s account — not yours.`}
        </p>
        <div class="flex gap-2.5 flex-wrap items-center">
          <input
            type="email"
            required
            value={inviteEmail}
            onInput={(e) => setInviteEmail((e.target as HTMLInputElement).value)}
            placeholder={isDa ? 'navn@firma.dk' : 'name@company.com'}
            aria-label={isDa ? 'E-mailadresse' : 'Email address'}
            class="flex-1 min-w-[220px] text-[13.5px] px-3 py-2 rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-card)] text-[color:var(--color-fg)] focus:outline-2 focus:outline-[color:var(--color-accent)]"
            data-testid="tenant-members-invite-email"
          />
          <Dropdown
            testid="tenant-members-invite-role"
            value={inviteRole}
            onChange={(v) => setInviteRole(v as TenantMember['role'])}
            options={roleOptions.filter((o) => o.value !== 'owner')}
            hintInMenuOnly
            buttonClass="w-[118px]"
          />
          <button
            type="submit"
            disabled={inviting || !inviteEmail.trim()}
            class="text-[13.5px] font-medium px-4 py-2 rounded-md bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] hover:brightness-95 active:brightness-90 active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="tenant-members-invite-submit"
          >
            {inviting ? (isDa ? 'Sender…' : 'Sending…') : isDa ? 'Send invitation' : 'Send invitation'}
          </button>
        </div>
        <p class="mt-3 text-[12.5px] text-[color:var(--color-fg-subtle)] flex gap-2 items-start m-0">
          <span aria-hidden="true">🔒</span>
          <span>
            {isDa
              ? 'Én konto, ét firma. En e-mail der allerede hører til et andet firma kan ikke inviteres.'
              : 'One account, one company. An email that already belongs to another company cannot be invited.'}
          </span>
        </p>
      </form>

      {toast ? (
        <div
          class="fixed left-1/2 -translate-x-1/2 bottom-6 bg-[color:var(--color-fg)] text-[color:var(--color-bg)] px-4 py-2.5 rounded-full text-[13px] shadow-lg z-50 max-w-[90vw] text-center"
          data-testid="tenant-members-toast"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function initials(m: TenantMember): string {
  const base = m.name?.trim() || m.email;
  const parts = base.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function formatJoined(iso: string, isDa: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(isDa ? 'da-DK' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}
