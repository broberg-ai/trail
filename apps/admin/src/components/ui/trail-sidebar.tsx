import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Icons, type IconName } from './icons';
import { useKb } from '../../lib/kb-cache';
import { listQueue, getSourceActivity } from '../../api';
import { useKbEvents, onStreamOpen, onFocusRefresh, debounce } from '../../lib/event-stream';
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
      labelKey: 'sidebar.groupInput',
      items: [
        { id: 'sources', path: `/kb/${kbId}/sources`, labelKey: 'sidebar.sources', icon: 'Upload' },
        { id: 'images', path: `/kb/${kbId}/images`, labelKey: 'sidebar.images', icon: 'FileText' },
      ],
    },
    {
      labelKey: 'sidebar.groupCanon',
      items: [
        { id: 'neurons', path: `/kb/${kbId}/neurons`, labelKey: 'sidebar.neurons', icon: 'FileText' },
        { id: 'glossary', path: `/glossary`, labelKey: 'sidebar.glossary', icon: 'FileText' },
        { id: 'graph', path: `/kb/${kbId}/graph`, labelKey: 'sidebar.graph', icon: 'Network' },
        { id: 'memory-health', path: `/kb/${kbId}/memory-health`, labelKey: 'sidebar.memoryHealth', icon: 'Activity' },
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
  /** True when the current URL is `/kb/<kbId>/...`; false when we're
   *  on a global route (`/glossary`, `/jobs`, /settings, etc.) and the
   *  kbId is a fallback from localStorage. Used to suppress the
   *  KB-active-state dot in the header. */
  urlHasKbId?: boolean;
}

const NARROW_QUERY = '(max-width: 700px)';

function isNarrowNow(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia(NARROW_QUERY).matches;
  } catch { return false; }
}

export function TrailSidebar({ kbId, urlHasKbId = true }: TrailSidebarProps) {
  const { path, route } = useLocation();
  const kb = useKb(kbId);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    // F248.2 — på en telefon starter sidebaren som ikon-skinne (60px): den
    // fulde 240px-kolonne åd over halvdelen af en 393px-skærm (ejerens
    // telefonskud 5/9). Et gemt valg vinder stadig — men kun på store
    // skærme; på mobil er skinnen udgangspunktet uanset hvad desktop gemte.
    try {
      if (isNarrowNow()) return true;
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch { return false; }
  });

  // F248.4 — på en telefon åbner menuen som OVERLAY hen over arbejdsfladen
  // (ejerens skud 5/9: den udfoldede kolonne skubbede alt indhold mod højre).
  // `narrow` følger viewporten reaktivt, så en rotation/resize skifter mode.
  const [narrow, setNarrow] = useState<boolean>(isNarrowNow);
  useEffect(() => {
    try {
      const mq = matchMedia(NARROW_QUERY);
      const onChange = () => setNarrow(mq.matches);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    } catch { return undefined; }
  }, []);
  const overlayMode = narrow && !collapsed;

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* no storage */ }
  }, [collapsed]);
  // F248.5 — mens overlayet er åbent må arbejdsfladen BAG det ikke kunne rulle
  // (ejerens skud 5/9: topbjælken kunne rulles ud af skærmen med menuen oppe).
  // Låsen sidder på både html og body, fordi iOS ruller documentElement.
  useEffect(() => {
    if (!overlayMode) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [overlayMode]);

  // F186-followup — pending-queue count badge on the Kø item. Refetched on
  // navigation so it stays honest after the curator resolves items. `count`
  // is the TOTAL matching the filter (independent of limit), so limit:1 keeps
  // the payload tiny.
  const [queueCount, setQueueCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    listQueue({ knowledgeBaseId: kbId, status: 'pending', limit: 1 })
      .then((r) => { if (!cancelled) setQueueCount(r.count); })
      .catch(() => { if (!cancelled) setQueueCount(null); });
    return () => { cancelled = true; };
  }, [kbId, path]);

  // F248.6 — «flashing activity»-prikken ved Kilder (ejerens ønske 5/9).
  // Tallet kommer fra ét letvægts-endpoint (to COUNT'er) og holdes LIVE på
  // de fire hændelser der faktisk ændrer det. Debounced: en bulk-upload fyrer
  // mange hændelser på millisekunder, og kun den sidste tælling gælder.
  // Prikken tæller BEGGE slags uafsluttet arbejde: det der kører lige nu
  // (active) OG det der er droppet og parkeret til kompilering (awaiting).
  // Kun `active` ville betyde at man dropper en fil på telefonen og ikke ser
  // noget som helst, før en dispatch tilfældigvis fyrer — og dét er præcis
  // det øjeblik man kigger efter en kvittering.
  const [sourceActivity, setSourceActivity] = useState(0);
  const refreshActivity = useRef(() => {});
  refreshActivity.current = () => {
    getSourceActivity(kbId)
      .then((a) => setSourceActivity(a.active + a.awaiting))
      .catch(() => { /* et fejlet opslag må ikke tænde en falsk prik */ });
  };
  const bumpActivity = useMemo(
    () => debounce(() => refreshActivity.current(), 400),
    [],
  );
  useEffect(() => { refreshActivity.current(); }, [kbId]);
  useKbEvents(kbId, (e) => {
    if (
      e.type === 'ingest_started' ||
      e.type === 'ingest_completed' ||
      e.type === 'ingest_failed' ||
      e.type === 'source_compiled'
    ) {
      bumpActivity();
    }
  });
  useEffect(() => onStreamOpen(() => refreshActivity.current()), [kbId]);
  useEffect(() => onFocusRefresh(() => refreshActivity.current()), [kbId]);

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

  // F248.4 — navigation fra overlayet lukker det: man valgte et sted at
  // være, og arbejdsfladen er derinde bag menuen.
  const go = (p: string) => {
    route(p);
    if (narrow) setCollapsed(true);
  };

  return (
    <>
    {overlayMode ? (
      <>
        {/* Bagtæppe: klik lukker. Menuen ligger OVER indholdet — intet skubbes. */}
        <div
          data-testid="sidebar-backdrop"
          onClick={() => setCollapsed(true)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 55,
            background: 'rgba(0, 0, 0, 0.35)',
          }}
        />
        {/* Pladsholder med skinnens bredde, så indholdet bag overlayet står
            præcis hvor det stod — aside'en forlader flowet som fixed. */}
        <div style={{ flex: '0 0 60px' }} />
      </>
    ) : null}
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
        ...(overlayMode
          ? {
              position: 'fixed',
              top: 0,
              bottom: 0,
              left: 0,
              height: '100dvh',
              zIndex: 60,
              boxShadow: 'var(--shadow-xl)',
            }
          : {}),
      }}
    >
      {/* Header — trail identity + back-to-Home + collapse toggle */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
        {!collapsed ? (
          <>
            <button
              type="button"
              onClick={() => go('/')}
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
                    background: urlHasKbId ? 'var(--color-success)' : 'var(--color-fg-subtle)',
                  }}
                />
                <span>{kbId}</span>
              </span>
              <button
                type="button"
                class="icon-btn"
                data-testid="sidebar-collapse"
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
            data-testid="sidebar-expand"
            onClick={() => setCollapsed(false)}
            title={t('sidebar.expand')}
            aria-label={t('sidebar.expand')}
            style={{ width: 32, height: 32 }}
          >
            <Icons.ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* Groups — minHeight:0 so the flex child can actually shrink and
          scroll-y kicks in. Without it the nav's natural content height
          pushes the footer off-screen (Christian flagged this with the
          11-item KB list). */}
      <nav class="scroll-y" style={{ flex: 1, padding: '8px 8px 0', minHeight: 0 }}>
        {groups.map((grp) => (
          <div key={grp.labelKey} style={{ marginBottom: 14 }}>
            {!collapsed ? (
              <div class="menu-section" style={{ padding: '6px 8px 4px' }}>
                {t(grp.labelKey)}
              </div>
            ) : null}
            {grp.items.map((it) => (
              <Item
                key={it.id}
                item={it}
                active={isActive(it.path)}
                collapsed={collapsed}
                onClick={() => go(it.path)}
                count={it.id === 'queue' ? queueCount : null}
                pulse={it.id === 'sources' && sourceActivity > 0}
              />
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
            onClick={() => go(it.path)}
            dim
          />
        ))}
      </div>
    </aside>
    </>
  );
}

function Item({
  item,
  active,
  collapsed,
  onClick,
  dim,
  count,
  pulse,
}: {
  item: SidebarItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  dim?: boolean;
  /** Optional badge count (e.g. pending queue items). Null/0 → no badge. */
  count?: number | null;
  /** F248.6 — noget arbejder lige nu på denne flade (pulserende prik). */
  pulse?: boolean;
}) {
  const IconComp = Icons[item.icon];
  const label = t(item.labelKey);
  const showCount = count != null && count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      class={'sidebar-item' + (active ? ' is-active' : '') + (dim ? ' is-dim' : '')}
      title={collapsed && showCount ? `${label} (${count})` : collapsed ? label : undefined}
      aria-label={
        pulse
          ? `${label} — ${t('sidebar.activity')}`
          : showCount
            ? `${label} (${count})`
            : label
      }
    >
      {active ? <span class="sidebar-item__bar" /> : null}
      <IconComp size={14} class="sidebar-item__icon" />
      {/* F248.6 — prikken sidder på IKONET, ikke ved etiketten, så den også
          er synlig i den kollapsede ikon-skinne hvor der ingen tekst er. */}
      {pulse ? <span class="sidebar-item__pulse" data-testid="sidebar-activity-sources" aria-hidden="true" /> : null}
      {!collapsed ? <span class="sidebar-item__label">{label}</span> : null}
      {!collapsed && showCount ? (
        <span class="sidebar-item__count is-attention">{count > 99 ? '99+' : count}</span>
      ) : null}
    </button>
  );
}
