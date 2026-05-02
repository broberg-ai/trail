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
import { useEffect, useMemo, useState } from 'preact/hooks';
import { listActivity, type ActivityRow } from '../api';
import { useLocale } from '../lib/i18n';
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

export function ActivityPanel() {
  useLocale();
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeId>('7d');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchRows = async () => {
    try {
      const since = TIMEFRAMES.find((t) => t.id === timeframe)?.sinceFn();
      const r = await listActivity({
        since,
        kind: kindFilter || undefined,
        limit: 100,
      });
      setRows(r.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void fetchRows();
  }, [timeframe, kindFilter]);

  useEffect(() => {
    const id = setInterval(() => void fetchRows(), POLL_INTERVAL_MS);
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
    <div class="p-6 max-w-5xl mx-auto">
      <div class="mb-4 flex items-baseline justify-between">
        <h1 class="text-xl font-semibold">Activity</h1>
        <button
          type="button"
          class="text-[11px] font-mono text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
          onClick={() => void fetchRows()}
        >
          ↻ refresh
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
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter((e.target as HTMLSelectElement).value)}
          class="bg-[color:var(--color-bg)] border border-[color:var(--color-border)] rounded px-2 py-1 text-[12px]"
        >
          <option value="">All groups</option>
          {KIND_GROUPS.map((g) => (
            <option key={g.label} value={g.label}>{g.label}</option>
          ))}
        </select>
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
    </div>
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
