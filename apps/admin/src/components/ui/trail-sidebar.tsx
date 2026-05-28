import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Icons, type IconName } from './icons';
import { useKb } from '../../lib/kb-cache';
import { t } from '../../lib/i18n';

/**
 * F186 — Inner-trail sidebar. 240px wide, 4 groups + footer. Replaces the
 * horizontal 11-tab strip from TrailNav. Per F186 plan-doc, all 21 panels
 * are slotted into Use / Canon / Pipeline / Input + footer (Cost +
 * Settings); some panels (neuron-editor, wiki-reader, kbs, not-found,
 * play, quality-compare) have no sidebar entry by design.
 *
 * Collapse state persists to localStorage (per F186 open-question default).
 */
const COLLAPSE_KEY = 'trail.admin.sidebar.collapsed';

interface SidebarItem {
  id: string;
  path: string;
  labelKey: string;
  icon: IconName;
}

interface SidebarGroup {
  labelKey: string;
  items: SidebarItem[];
}

function buildGroups(kbId: string): SidebarGroup[] {
  return [
    {
      labelKey: 'sidebar.groupUse',
      items: [
        { id: 'chat', path: `/kb/${kbId}/chat`, labelKey: 'sidebar.chat', icon: 'MessageSquare' },
        { id: 'search', path: `/kb/${kbId}/search`, labelKey: 'sidebar.search', icon: 'Search' },
      ],
    },
    {
      labelKey: 'sidebar.groupCanon',
      items: [
        { id: 'neurons', path: `/kb/${kbId}/neurons`, labelKey: 'sidebar.neurons', icon: 'FileText' },
        { id: 'glossary', path: `/glossary`, labelKey: 'sidebar.glossary', icon: 'FileText' },
        { id: 'graph', path: `/kb/${kbId}/graph`, labelKey: 'sidebar.graph', icon: 'Network' },
      ],
    },
    {
      labelKey: 'sidebar.groupPipeline',
      items: [
        { id: 'queue', path: `/kb/${kbId}/queue`, labelKey: 'sidebar.queue', icon: 'Inbox' },
        { id: 'work', path: `/kb/${kbId}/work`, labelKey: 'sidebar.work', icon: 'Cpu' },
        { id: 'jobs', path: `/jobs`, labelKey: 'sidebar.jobs', icon: 'Cpu' },
        { id: 'activity', path: `/activity`, labelKey: 'sidebar.activity', icon: 'Cpu' },
        { id: 'links', path: `/kb/${kbId}/link-check`, labelKey: 'sidebar.links', icon: 'ArrowUpRight' },
      ],
    },
    {
      labelKey: 'sidebar.groupInput',
      items: [
        { id: 'sources', path: `/kb/${kbId}/sources`, labelKey: 'sidebar.sources', icon: 'Upload' },
        { id: 'images', path: `/kb/${kbId}/images`, labelKey: 'sidebar.images', icon: 'FileText' },
      ],
    },
  ];
}

function footerItems(kbId: string): SidebarItem[] {
  return [
    { id: 'cost', path: `/kb/${kbId}/cost`, labelKey: 'sidebar.cost', icon: 'CreditCard' },
    { id: 'settings', path: `/kb/${kbId}/settings`, labelKey: 'sidebar.settings', icon: 'Settings' },
  ];
}

export interface TrailSidebarProps {
  kbId: string;
}

export function TrailSidebar({ kbId }: TrailSidebarProps) {
  const { path, route } = useLocation();
  const kb = useKb(kbId);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* no storage */ }
  }, [collapsed]);

  const groups = buildGroups(kbId);
  const footer = footerItems(kbId);
  const width = collapsed ? 60 : 240;

  const isActive = (p: string): boolean => {
    if (p === path) return true;
    // Treat /kb/:id/neurons/<slug> as the neurons-tab active state too.
    if (p.endsWith('/neurons') && path.startsWith(p + '/')) return true;
    if (p === '/glossary' && path === '/glossary') return true;
    if (p === '/jobs' && path === '/jobs') return true;
    if (p === '/activity' && path === '/activity') return true;
    return false;
  };

  return (
    <aside
      style={{
        width,
        flex: `0 0 ${width}px`,
        borderRight: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width var(--dur) var(--ease), flex-basis var(--dur) var(--ease)',
      }}
    >
      {/* Header — trail identity + back-to-Home + collapse toggle */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
        {!collapsed ? (
          <>
            <button
              type="button"
              onClick={() => route('/')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: 'var(--color-fg-muted)',
                padding: '2px 4px 2px 0',
                borderRadius: 4,
                marginBottom: 8,
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
              }}
            >
              <Icons.Chevron size={11} style={{ transform: 'rotate(90deg)' }} />
              <span>{t('sidebar.back')}</span>
            </button>
            <div
              style={{
                fontFamily: 'var(--font-serif)',
                fontWeight: 400,
                fontSize: 17,
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
              }}
            >
              {kb?.name ?? kbId}
            </div>
            <div
              class="mono"
              style={{
                fontSize: 10.5,
                color: 'var(--color-fg-subtle)',
                marginTop: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: 'var(--color-success)',
                  }}
                />
                <span>{kbId}</span>
              </span>
              <button
                type="button"
                class="icon-btn"
                onClick={() => setCollapsed(true)}
                title={t('sidebar.collapse')}
                aria-label={t('sidebar.collapse')}
                style={{ width: 22, height: 22 }}
              >
                <Icons.ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} />
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            class="icon-btn"
            onClick={() => setCollapsed(false)}
            title={t('sidebar.expand')}
            aria-label={t('sidebar.expand')}
            style={{ width: 32, height: 32 }}
          >
            <Icons.ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* Groups */}
      <nav class="scroll-y" style={{ flex: 1, padding: '8px 8px 0' }}>
        {groups.map((grp) => (
          <div key={grp.labelKey} style={{ marginBottom: 14 }}>
            {!collapsed ? (
              <div class="menu-section" style={{ padding: '6px 8px 4px' }}>
                {t(grp.labelKey)}
              </div>
            ) : null}
            {grp.items.map((it) => (
              <Item key={it.id} item={it} active={isActive(it.path)} collapsed={collapsed} onClick={() => route(it.path)} />
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: 8, borderTop: '1px solid var(--color-border)' }}>
        {footer.map((it) => (
          <Item
            key={it.id}
            item={it}
            active={isActive(it.path)}
            collapsed={collapsed}
            onClick={() => route(it.path)}
            dim
          />
        ))}
      </div>
    </aside>
  );
}

function Item({
  item,
  active,
  collapsed,
  onClick,
  dim,
}: {
  item: SidebarItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  dim?: boolean;
}) {
  const IconComp = Icons[item.icon];
  const label = t(item.labelKey);
  return (
    <button
      type="button"
      onClick={onClick}
      class={'sidebar-item' + (active ? ' is-active' : '') + (dim ? ' is-dim' : '')}
      title={collapsed ? label : undefined}
      aria-label={label}
    >
      {active ? <span class="sidebar-item__bar" /> : null}
      <IconComp size={14} class="sidebar-item__icon" />
      {!collapsed ? <span class="sidebar-item__label">{label}</span> : null}
    </button>
  );
}
