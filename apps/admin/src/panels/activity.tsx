/**
 * F97 Phase 4 — Activity Log panel.
 *
 * Top-level admin page (/activity) — paginated audit timeline of every
 * meaningful action on the current tenant. Filters by kind, KB, and
 * timeframe. Click a row to expand its metadata JSON.
 *
 * v1: polling-only (refresh button + 30s tick). SSE live-prepend can
 * land later via the existing GET /api/v1/stream — kept out of v1 to
 * ship the first useful surface fast.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { listActivity, type ActivityRow } from '../api';
import { useLocale, t } from '../lib/i18n';
import { CenteredLoader } from '../components/centered-loader';

type TimeframeId = 'all' | 'today' | '7d' | '30d';

const TIMEFRAMES: ReadonlyArray<{ id: TimeframeId; label: string; sinceFn: () => string | undefined }> = [
  { id: 'all', label: 'All', sinceFn: () => undefined },
  { id: 'today', label: 'Today', sinceFn: () => isoNDaysAgo(0) },
  { id: '7d', label: 'Last 7 days', sinceFn: () => isoNDaysAgo(7) },
  { id: '30d', label: 'Last 30 days', sinceFn: () => isoNDaysAgo(30) },
];

function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const KIND_GROUPS: ReadonlyArray<{ label: string; kinds: string[] }> = [
  { label: 'Auth', kinds: ['auth.login', 'auth.logout'] },
  { label: 'Trail', kinds: ['kb.created', 'kb.updated', 'kb.archived'] },
  { label: 'Source', kinds: ['source.uploaded', 'source.archived', 'source.restored'] },
  { label: 'Ingest', kinds: ['ingest.started', 'ingest.completed', 'ingest.failed', 'ingest.retried'] },
  { label: 'Queue', kinds: ['candidate.created', 'candidate.approved', 'candidate.rejected', 'candidate.reopened', 'candidate.acknowledged'] },
  { label: 'Neuron', kinds: ['neuron.edited', 'neuron.archived', 'neuron.restored'] },
  { label: 'Lint', kinds: ['lint.scheduled', 'lint.completed'] },
  { label: 'Connector', kinds: ['connector.recommendation_generated'] },
];

const POLL_INTERVAL_MS = 30_000;

const PAGE_SIZE = 50;

export function ActivityPanel() {
  useLocale();
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeId>('7d');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Fresh fetch — used when filters change AND for the polling tick.
  // Replaces the entire list with the first page (any rows past page 1
  // were appended via "Load more" — the polling tick deliberately
  // collapses back to page 1 because what the curator wants from a
  // refresh is "what's new at the top", not "preserve my deep scroll
  // through old history").
  const fetchFirstPage = async () => {
    try {
      const since = TIMEFRAMES.find((t) => t.id === timeframe)?.sinceFn();
      const r = await listActivity({
        since,
        kind: kindFilter || undefined,
        limit: PAGE_SIZE,
      });
      setRows(r.items);
      setNextCursor(r.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const since = TIMEFRAMES.find((t) => t.id === timeframe)?.sinceFn();
      const r = await listActivity({
        since,
        kind: kindFilter || undefined,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      setRows((prev) => (prev ? [...prev, ...r.items] : r.items));
      setNextCursor(r.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void fetchFirstPage();
  }, [timeframe, kindFilter]);

  useEffect(() => {
    const id = setInterval(() => void fetchFirstPage(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [timeframe, kindFilter]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (!groupFilter) return rows;
    const grp = KIND_GROUPS.find((g) => g.label === groupFilter);
    if (!grp) return rows;
    return rows.filter((r) => grp.kinds.includes(r.kind));
  }, [rows, groupFilter]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (error) {
    return (
      <div class="p-6 text-[color:var(--color-danger)] font-mono text-sm">
        Error: {error}
      </div>
    );
  }
  if (!filtered) return <CenteredLoader />;

  return (
    <div class="page-shell">
      <div class="mb-4 flex items-baseline justify-between">
        <h1 style="font-family: var(--font-serif); font-weight: 400; font-size: 32px; letter-spacing: -0.015em; line-height: 1.15; margin: 0;">{t('activityPanel.title')}</h1>
        <button
          type="button"
          class="text-[11px] font-mono text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
          onClick={() => void fetchFirstPage()}
        >
          {t('activityPanel.refresh')}
        </button>
      </div>

      {/* Filter row */}
      <div class="mb-4 flex flex-wrap gap-2 items-center text-[12px]">
        <div class="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTimeframe(tf.id)}
              class={`px-2 py-1 rounded font-mono uppercase tracking-wider text-[10px] ${
                timeframe === tf.id
                  ? 'bg-[color:var(--color-accent)] text-white'
                  : 'bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-[color:var(--color-fg-muted)]'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <GroupFilter value={groupFilter} onChange={setGroupFilter} />
        <input
          type="text"
          placeholder="Filter by kind (e.g. ingest.completed)"
          value={kindFilter}
          onInput={(e) => setKindFilter((e.target as HTMLInputElement).value)}
          class="bg-[color:var(--color-bg)] border border-[color:var(--color-border)] rounded px-2 py-1 text-[12px] w-72"
        />
        <span class="ml-auto text-[11px] font-mono text-[color:var(--color-fg-subtle)]">
          {filtered.length} row{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Timeline */}
      {filtered.length === 0 ? (
        <div class="text-[color:var(--color-fg-muted)] italic text-sm py-8 text-center">
          No activity in this window.
        </div>
      ) : (
        <ul class="divide-y divide-[color:var(--color-border)] text-[13px]">
          {filtered.map((row) => {
            const isOpen = expanded.has(row.id);
            return (
              <li key={row.id} class="py-2">
                <button
                  type="button"
                  class="w-full text-left flex items-baseline gap-3 hover:bg-[color:var(--color-bg-elevated)] -mx-2 px-2 py-1 rounded"
                  onClick={() => toggle(row.id)}
                >
                  <span class="text-[11px] font-mono text-[color:var(--color-fg-subtle)] tabular-nums whitespace-nowrap">
                    {formatTime(row.createdAt)}
                  </span>
                  <KindBadge kind={row.kind} />
                  <span class="flex-1 truncate">{row.summary}</span>
                  <span class="text-[10px] font-mono text-[color:var(--color-fg-subtle)] uppercase">
                    {row.actorKind}
                  </span>
                </button>
                {isOpen && row.metadata && (
                  <pre class="mt-1 ml-12 text-[11px] font-mono text-[color:var(--color-fg-muted)] bg-[color:var(--color-bg-elevated)] rounded p-2 overflow-x-auto">
                    {JSON.stringify(row.metadata, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Load more vs end-of-list. Two distinct states so the user
          knows whether the list is paginated-but-truncated or
          actually exhausted. Without the end-marker, a user who
          scrolls down and finds no Load more button can mistake
          completion for a broken panel. */}
      {filtered.length > 0 && (
        <div class="mt-4 flex justify-center">
          {nextCursor ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
              class="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-elevated)] disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loadingMore ? 'Loading…' : `Load more (next ${PAGE_SIZE})`}
            </button>
          ) : (
            <span class="text-[11px] font-mono uppercase tracking-wider text-[color:var(--color-fg-subtle)]">
              · end of activity log ·
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function GroupFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // Trail-styled popover dropdown — same pattern as panels/images.tsx
  // SourceFilter. Replaces native <select> which surfaces the macOS
  // combobox chrome (broken with Bauhaus palette + dark mode).
  // Click-outside + Escape close.
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const label = value || 'All groups';

  return (
    <div class="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="relative flex items-center gap-2 pl-3 pr-8 py-1 text-[12px] rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] focus:outline-none transition cursor-pointer w-[140px] text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span class="truncate flex-1 min-w-0">{label}</span>
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[color:var(--color-fg-muted)]">
          ▾
        </span>
      </button>
      {open ? (
        <div
          class="absolute left-0 top-full mt-1 z-20 w-[180px] rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-card)] shadow-2xl"
          role="listbox"
        >
          <DropdownItem active={value === ''} onClick={() => select('')} label={t('activityPanel.allGroups')} />
          <div class="border-t border-[color:var(--color-border)] my-1" />
          {KIND_GROUPS.map((g) => (
            <DropdownItem
              key={g.label}
              active={value === g.label}
              onClick={() => select(g.label)}
              label={g.label}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DropdownItem({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      class={
        'w-full text-left px-3 py-2 text-[12px] transition flex items-center gap-2 ' +
        (active
          ? 'bg-[color:var(--color-accent)]/10 text-[color:var(--color-fg)]'
          : 'text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-bg)]/60 hover:text-[color:var(--color-fg)]')
      }
    >
      <span
        class={
          'inline-block w-3 flex-shrink-0 text-[color:var(--color-accent)] ' +
          (active ? 'opacity-100' : 'opacity-0')
        }
      >
        ✓
      </span>
      <span class="truncate flex-1 min-w-0">{label}</span>
    </button>
  );
}

function KindBadge({ kind }: { kind: string }) {
  // Color by group prefix for a quick visual tier — no exhaustive
  // switch; falls back to neutral so unknown future kinds render fine.
  const prefix = kind.split('.')[0] ?? '';
  const tone =
    prefix === 'auth' ? 'bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)]'
    : prefix === 'ingest' ? 'bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]'
    : prefix === 'lint' ? 'bg-[color:var(--color-warning,#f59e0b)]/15 text-[color:var(--color-warning,#f59e0b)]'
    : prefix === 'candidate' || prefix === 'neuron' ? 'bg-[color:var(--color-info,#3b82f6)]/15 text-[color:var(--color-info,#3b82f6)]'
    : 'bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-[color:var(--color-fg-muted)]';
  return (
    <span class={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider whitespace-nowrap ${tone}`}>
      {kind}
    </span>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso.includes('T') || iso.includes(' ') ? iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z') : iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
