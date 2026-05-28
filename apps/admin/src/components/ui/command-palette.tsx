import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { listKnowledgeBases, switchTenant, type AuthMe } from '../../api';
import type { KnowledgeBase } from '@trail/shared';
import { Icons, type IconName } from './icons';
import { t } from '../../lib/i18n';

/**
 * F186 — Cmd+K command palette. Ported from
 * docs/design/trail_app/src/command-palette.jsx 1:1.
 *
 * Groups (per F186 plan-doc Q5.2 — current-tenant only + tenant-switch
 * as separate group):
 *   - Recent neurons (placeholder for now; F186 Phase D fills via /me)
 *   - Trails (listKnowledgeBases())
 *   - Actions (new-trail / chat / upload / settings — routes to closest
 *     existing flow, or "Coming Soon" toast if no flow exists per Q5.1)
 *   - Switch to tenant (every tenant *other than* current)
 *
 * Keyboard: ↑↓ to navigate, Enter to execute, Esc to close. Mouse-hover
 * also highlights. ⌘K toggles open/closed from anywhere.
 */
export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  me: AuthMe | null;
}

interface Item {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  meta?: string;
  /** What clicking/Enter does. */
  action: () => void;
}

interface Group {
  title: string;
  items: Item[];
}

export function CommandPalette({ open, onClose, me }: CommandPaletteProps) {
  const { route } = useLocation();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset on open + focus input
  useEffect(() => {
    if (open) {
      setQ('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Lazy-fetch the KB list when palette opens (every time, since it can
  // drift between opens).
  useEffect(() => {
    if (!open) return;
    listKnowledgeBases().then(setKbs).catch(() => setKbs([]));
  }, [open]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function showComingSoon() {
    setToast(t('palette.comingSoon'));
    setTimeout(() => setToast(null), 1800);
  }

  const groups = useMemo<Group[]>(() => {
    const s = q.toLowerCase().trim();
    const otherTenants = (me?.tenants ?? []).filter((tn) => !tn.active);

    const actions: Item[] = [
      {
        id: 'a-new-trail',
        label: t('palette.actionNewTrail'),
        icon: 'Plus',
        action: () => {
          route('/');
          // F186 Q5.1 — if no dedicated /new-trail route, land on Home where
          // "New trail" CTA opens the existing NewTrailModal.
        },
      },
      {
        id: 'a-new-neuron',
        label: q ? `${t('palette.actionNewNeuron')} "${q}"` : t('palette.actionNewNeuron'),
        icon: 'FileText',
        action: () => {
          showComingSoon();
        },
      },
      {
        id: 'a-chat',
        label: t('palette.actionOpenChat'),
        icon: 'MessageSquare',
        action: () => {
          // Land on the most recent KB's chat if there's one to choose;
          // otherwise Home so user can pick.
          if (kbs.length === 1) {
            route(`/kb/${kbs[0]!.slug}/chat`);
          } else {
            route('/');
            showComingSoon();
          }
        },
      },
      {
        id: 'a-upload',
        label: t('palette.actionUpload'),
        icon: 'Upload',
        action: () => {
          if (kbs.length === 1) {
            route(`/kb/${kbs[0]!.slug}/sources`);
          } else {
            route('/');
            showComingSoon();
          }
        },
      },
      {
        id: 'a-settings',
        label: t('palette.actionSettings'),
        icon: 'Settings',
        action: () => route('/settings'),
      },
    ];

    const filt = <T extends { label: string; hint?: string }>(arr: T[]): T[] =>
      !s ? arr : arr.filter((x) => x.label.toLowerCase().includes(s) || (x.hint?.toLowerCase().includes(s) ?? false));

    const g: Group[] = [];

    // Trails
    if (kbs.length) {
      g.push({
        title: t('palette.groupTrails'),
        items: filt(
          kbs.map<Item>((kb) => ({
            id: 't-' + kb.slug,
            label: kb.name,
            hint: kb.slug,
            icon: 'Network',
            action: () => route(`/kb/${kb.slug}/neurons`),
          })),
        ),
      });
    }

    g.push({ title: t('palette.groupActions'), items: filt(actions) });

    // Switch tenant
    if (otherTenants.length) {
      g.push({
        title: t('palette.groupTenants'),
        items: filt(
          otherTenants.map<Item>((tn) => ({
            id: 'sw-' + tn.slug,
            label: tn.name,
            hint: tn.slug,
            icon: 'Building',
            meta: tn.plan ?? undefined,
            action: async () => {
              try {
                await switchTenant(tn.slug);
                window.location.href = '/';
              } catch (err) {
                console.error('[palette] tenant switch failed', err);
              }
            },
          })),
        ),
      });
    }

    return g.filter((grp) => grp.items.length > 0);
  }, [q, me, kbs, route]);

  const flat = useMemo<Item[]>(() => groups.flatMap((g) => g.items), [groups]);

  // Reset selection when query changes
  useEffect(() => {
    setSelected(0);
  }, [q]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(flat.length - 1, s + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(0, s - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = flat[selected];
        if (!item) return;
        item.action();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flat, selected, onClose]);

  if (!open) return null;

  // Running index for highlight bar
  let runningIdx = -1;

  return (
    <div
      class="anim-fade"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(26,23,21,.36)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <div
        class="menu anim-palette"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 620,
          boxShadow: 'var(--shadow-xl)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'min(560px, 70vh)',
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 16px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <Icons.Search size={16} style={{ color: 'var(--color-fg-subtle)' }} />
          <input
            ref={inputRef}
            value={q}
            onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
            placeholder={t('palette.placeholder')}
            style={{
              flex: 1,
              border: 0,
              outline: 'none',
              background: 'transparent',
              color: 'var(--color-fg)',
              font: 'inherit',
              fontSize: 14,
            }}
          />
          <button type="button" onClick={onClose} class="kbd" style={{ cursor: 'pointer' }}>
            esc
          </button>
        </div>

        {/* Result groups */}
        <div class="scroll-y" style={{ flex: 1, padding: '6px 0' }}>
          {flat.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-fg-subtle)', fontSize: 13 }}>
              {t('palette.empty')}
            </div>
          ) : null}
          {groups.map((grp) => (
            <div key={grp.title}>
              <div class="menu-section">{grp.title}</div>
              {grp.items.map((it) => {
                runningIdx++;
                const isSel = runningIdx === selected;
                const myIdx = runningIdx;
                const IconComp = Icons[it.icon];
                return (
                  <button
                    type="button"
                    key={it.id}
                    class="menu-item"
                    data-highlighted={isSel ? 'true' : undefined}
                    onMouseEnter={() => setSelected(myIdx)}
                    onClick={() => {
                      it.action();
                      onClose();
                    }}
                    style={{
                      padding: '8px 16px',
                      borderLeft: isSel ? '2px solid var(--color-accent)' : '2px solid transparent',
                      paddingLeft: 14,
                    }}
                  >
                    <IconComp size={14} style={{ color: 'var(--color-fg-subtle)' }} />
                    <span style={{ flex: 1, textAlign: 'left', fontSize: 13 }}>{it.label}</span>
                    {it.meta ? <span class={'plan-badge ' + it.meta}>{it.meta}</span> : null}
                    {it.hint ? (
                      <span
                        class="mono"
                        style={{ fontSize: 10.5, color: 'var(--color-fg-subtle)' }}
                      >
                        {it.hint}
                      </span>
                    ) : null}
                    {isSel ? <Icons.CornerDownLeft size={12} style={{ color: 'var(--color-fg-subtle)' }} /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hints */}
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-bg-sunk)',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontSize: 11,
            color: 'var(--color-fg-muted)',
          }}
        >
          <HintRow keys={['↑', '↓']}>{t('palette.navigate')}</HintRow>
          <HintRow keys={['↵']}>{t('palette.select')}</HintRow>
          <HintRow keys={['esc']}>{t('palette.close')}</HintRow>
          {me?.tenant ? (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icons.Sparkles size={12} style={{ color: 'var(--color-accent)' }} />
              <span class="mono" style={{ fontSize: 10.5 }}>{me.tenant.name}</span>
            </div>
          ) : null}
        </div>

        {toast ? (
          <div
            class="anim-fade"
            style={{
              position: 'absolute',
              bottom: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '8px 14px',
              borderRadius: 999,
              background: 'var(--color-fg)',
              color: 'var(--color-bg)',
              fontSize: 12,
              boxShadow: 'var(--shadow-md)',
              pointerEvents: 'none',
            }}
          >
            {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HintRow({ keys, children }: { keys: string[]; children: JSX.Element | string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {keys.map((k, i) => (
        <span key={i} class="kbd">
          {k}
        </span>
      ))}
      <span>{children}</span>
    </span>
  );
}
