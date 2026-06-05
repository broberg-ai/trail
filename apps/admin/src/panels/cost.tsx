import { useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { useKb } from '../lib/kb-cache';
import { t, useLocale } from '../lib/i18n';
import { formatLocaleDate, formatShortLocaleDate } from '../lib/dates';
import {
  getCostSummary,
  costCsvUrl,
  getCostSources,
  getCredits,
  getFxRate,
  ApiError,
  type CostSummary,
  type CostSourcesPage,
  type CostSourceSort,
  type CostSortOrder,
  type CreditsResponse,
  type FxRate,
  getUpmetricsCost,
  type UpmetricsCostSummary,
} from '../api';
import { formatCostForLocale } from '../lib/currency';
import { CenteredLoader } from '../components/centered-loader';

/**
 * F151 — Cost tab. Shows running total, daily CSS-only bar-chart,
 * top-line metrics, and a paginated + sortable source list.
 *
 * The summary (totals, chart, window metrics) loads from
 * GET /cost once per window-change; the source list is a separate
 * paginated query so curators with 500-source KBs don't pay the
 * cost of shipping everything up-front.
 */

const WINDOWS: Array<{ value: number; label: string }> = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 365, label: '1y' },
];

const PAGE_SIZE = 25;

function displayTitle(title: string | null, filename: string): string {
  // Strip trailing `.md` / `.pdf` / etc. extensions when we're falling
  // back to the filename — per Christian 2026-04-24: extension is noise
  // in a source-list for non-technical curators.
  if (title && title.trim().length > 0) return title;
  return filename.replace(/\.[a-z0-9]+$/i, '');
}

// Date formatting is centralised in lib/dates.ts so every panel
// honours the Trail-locale (set via the header switcher) rather
// than navigator.language.

export function CostPanel() {
  const route = useRoute();
  const kbId = route.params.kbId ?? '';
  const kb = useKb(kbId);
  const locale = useLocale();
  const [window, setWindow] = useState<number>(30);
  const [includeShadow, setIncludeShadow] = useState<boolean>(() => {
    // Default ON: shadow estimates cover the entire pre-F149 history,
    // and a fresh curator opening Cost on a Max-Plan KB would otherwise
    // see "0" with no signal that estimates exist. Explicit "0" in
    // localStorage means the user deliberately turned it off.
    try {
      return localStorage.getItem('trail.admin.cost.shadow') !== '0';
    } catch {
      return true;
    }
  });
  const [summary, setSummary] = useState<CostSummary | null>(null);
  // F190.5 — per-tenant discrete-LLM cost (chat/vision/helpers via ai-sdk →
  // upmetrics). Monthly, KB-scoped, server-side filtered to this tenant. null =
  // no upmetrics key / no data → overlay omitted.
  const [upm, setUpm] = useState<UpmetricsCostSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fxRate, setFxRate] = useState<FxRate | null>(null);

  // Source-list pagination + sort state
  const [sort, setSort] = useState<CostSourceSort>('cost');
  const [order, setOrder] = useState<CostSortOrder>('desc');
  const [offset, setOffset] = useState(0);
  const [sourcesPage, setSourcesPage] = useState<CostSourcesPage | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  // F156 Phase 0 — credits balance card. Tenant-scoped (not KB-scoped),
  // so loaded once per Cost-panel mount independent of window/kb. Silent
  // on failure: card hides if the endpoint isn't reachable yet.
  const [credits, setCredits] = useState<CreditsResponse | null>(null);
  useEffect(() => {
    getCredits()
      .then(setCredits)
      .catch(() => setCredits(null));
  }, [kbId]);

  // Fetch USD→DKK rate when locale is Danish. Silent on failure —
  // the formatter falls back to USD cents if fxRate stays null.
  useEffect(() => {
    if (locale !== 'da') {
      setFxRate(null);
      return;
    }
    getFxRate('USD', 'DKK')
      .then(setFxRate)
      .catch((err) => {
        console.warn('[cost-panel] FX rate fetch failed, showing USD:', err);
        setFxRate(null);
      });
  }, [locale]);

  const fmt = (cents: number) => formatCostForLocale(cents, locale, fxRate);

  // Summary fetch (totals + chart). Separate from source list because
  // they have different cache + invalidation characteristics.
  useEffect(() => {
    if (!kbId) return;
    setLoading(true);
    setError(null);
    getCostSummary(kbId, window, includeShadow)
      .then((s) => {
        setSummary(s);
        setLoading(false);
      })
      .catch((err: ApiError) => {
        setError(err.message);
        setLoading(false);
      });
  }, [kbId, window, includeShadow]);

  // F190.5 — discrete-LLM cost overlay (monthly, KB-scoped). Silent on failure.
  useEffect(() => {
    if (!kbId) return;
    getUpmetricsCost(kbId, 'month')
      .then((r) => setUpm(r.summary))
      .catch(() => setUpm(null));
  }, [kbId]);

  // Persist shadow-toggle across page reloads.
  useEffect(() => {
    try {
      localStorage.setItem('trail.admin.cost.shadow', includeShadow ? '1' : '0');
    } catch {
      /* no localStorage (SSR, sandboxed) — ignore */
    }
  }, [includeShadow]);

  // Source-list fetch. Refetches whenever window, sort, order, or
  // offset changes.
  useEffect(() => {
    if (!kbId) return;
    setSourcesLoading(true);
    getCostSources(kbId, { windowDays: window, sort, order, offset, limit: PAGE_SIZE })
      .then((p) => {
        setSourcesPage(p);
        setSourcesLoading(false);
      })
      .catch((err: ApiError) => {
        setError(err.message);
        setSourcesLoading(false);
      });
  }, [kbId, window, sort, order, offset]);

  // Reset offset when the user changes window OR sort — landing on
  // page 7 of a different sort is confusing.
  useEffect(() => {
    setOffset(0);
  }, [window, sort, order]);

  function toggleSort(key: CostSourceSort): void {
    if (sort === key) {
      setOrder(order === 'desc' ? 'asc' : 'desc');
    } else {
      setSort(key);
      setOrder(key === 'filename' || key === 'title' ? 'asc' : 'desc');
    }
  }

  function sortIndicator(key: CostSourceSort): string {
    if (sort !== key) return '';
    return order === 'desc' ? ' ↓' : ' ↑';
  }

  if (loading || !summary) {
    return <CenteredLoader />;
  }
  if (error) {
    return <div class="page-shell text-red-500">Error: {error}</div>;
  }

  // When shadow is active, use cents + estimatedCents for the chart
  // height; gives curator a visual of the full cost picture.
  const effectiveByDay = summary.byDay.map((d) => ({
    ...d,
    effectiveCents: d.cents + (includeShadow ? d.estimatedCents ?? 0 : 0),
  }));
  const maxDayCents = Math.max(...effectiveByDay.map((d) => d.effectiveCents), 1);
  const total = sourcesPage?.total ?? 0;
  const pageStart = offset + 1;
  const pageEnd = offset + (sourcesPage?.sources.length ?? 0);
  const hasPrev = offset > 0;
  const hasNext = sourcesPage !== null && pageEnd < total;

  return (
    <div class="page-shell space-y-6" data-testid="cost-root">
      {/* Header with window switcher + shadow-pill + CSV export */}
      <div class="flex items-center justify-between">
        <h1 style="font-family: var(--font-serif); font-weight: 400; font-size: 32px; letter-spacing: -0.015em; line-height: 1.15; margin: 0;">
          {t('nav.cost')}
        </h1>
        <div class="flex items-center gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              data-testid={`cost-window-${w.value}`}
              onClick={() => setWindow(w.value)}
              class={
                'px-2 py-1 text-xs font-mono rounded transition ' +
                (window === w.value
                  ? 'bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]'
                  : 'text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]')
              }
            >
              {w.label}
            </button>
          ))}
          <button
            data-testid="cost-shadow-toggle"
            onClick={() => setIncludeShadow(!includeShadow)}
            title={t('cost.shadow.hint')}
            aria-pressed={includeShadow}
            class={
              'ml-3 px-2 py-1 text-xs font-mono rounded transition ' +
              (includeShadow
                ? 'bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]'
                : 'text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]')
            }
          >
            {t('cost.shadow.pill')}
          </button>
          <a
            href={costCsvUrl(kbId, window)}
            download
            class="ml-3 text-xs font-mono text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] underline"
          >
            {t('cost.exportCsv')}
          </a>
        </div>
      </div>

      {/* F156 Phase 0 — Credits card. Tenant-scoped; renders only when
          the endpoint returned a row (Phase 0 has no UI for buying more
          — operator seeds via TRAIL_DEV_CREDITS env-var). */}
      {credits ? <CreditsCard credits={credits} /> : null}

      {/* Top-line metrics */}
      <div class="grid grid-cols-3 gap-4">
        <div class="p-3 rounded border border-[color:var(--color-border)]">
          <div class="text-xs text-[color:var(--color-fg-muted)]">{t('cost.total')}</div>
          <div class="text-2xl font-mono">{fmt(summary.totalCents)}</div>
          {includeShadow && summary.totalEstimatedCents > 0 ? (
            <div class="text-xs text-[color:var(--color-fg-muted)] mt-1 italic">
              {t('cost.shadow.plus', { amount: fmt(summary.totalEstimatedCents) })}
            </div>
          ) : !includeShadow && summary.totalEstimatedCents > 0 ? (
            <button
              onClick={() => setIncludeShadow(true)}
              class="text-xs text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] mt-1 italic underline underline-offset-2 decoration-dotted text-left"
            >
              {t('cost.shadow.available', { amount: fmt(summary.totalEstimatedCents) })}
            </button>
          ) : null}
          <div class="text-xs text-[color:var(--color-fg-muted)] mt-1">
            {summary.jobCount}{' '}
            {t(summary.jobCount === 1 ? 'cost.ingest_one' : 'cost.ingest_other')}
          </div>
        </div>
        <div class="p-3 rounded border border-[color:var(--color-border)]">
          <div class="text-xs text-[color:var(--color-fg-muted)]">{t('cost.perNeuronAvg')}</div>
          <div class="text-2xl font-mono">
            {summary.avgCentsPerNeuron === 0 ? '—' : fmt(summary.avgCentsPerNeuron)}
          </div>
          <div class="text-xs text-[color:var(--color-fg-muted)] mt-1">
            {summary.avgCentsPerNeuron === 0 ? t('cost.noCostData') : t('cost.estimate')}
          </div>
        </div>
        <div class="p-3 rounded border border-[color:var(--color-border)]">
          <div class="text-xs text-[color:var(--color-fg-muted)]">{t('cost.window')}</div>
          <div class="text-2xl font-mono">{summary.windowDays}d</div>
          <div class="text-xs text-[color:var(--color-fg-muted)] mt-1">
            {summary.byDay.length} {t('cost.daysWithData')}
          </div>
        </div>
      </div>

      {/* F190.5 — discrete-LLM cost (chat/vision/helpers via ai-sdk → upmetrics),
          scoped server-side to this tenant + KB. Separate from the ingest cost
          above (which lives in ingest_jobs.cost_cents). Omitted when no upmetrics
          key is set or no calls yet. */}
      {upm && upm.runCount > 0 ? (
        <div class="p-3 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)]">
          <div class="flex items-center justify-between mb-1">
            <div class="text-xs text-[color:var(--color-fg-muted)]">
              {locale === 'da' ? 'LLM-kald (chat / vision / hjælpere)' : 'LLM calls (chat / vision / helpers)'}
            </div>
            <div class="text-[10px] font-mono text-[color:var(--color-fg-subtle)]">
              via upmetrics · {locale === 'da' ? 'denne måned' : 'this month'}
            </div>
          </div>
          <div class="text-2xl font-mono">{fmt(upm.totalMicroUsd / 10_000)}</div>
          <div class="text-xs text-[color:var(--color-fg-muted)] mt-1">
            {upm.runCount} {locale === 'da' ? 'kald' : 'calls'}
            {upm.metered.freeRunCount > 0
              ? ` · ${upm.metered.freeRunCount} ${locale === 'da' ? 'uden cost-data' : 'no cost data'}`
              : ''}
            {upm.byCapability.length > 0
              ? ` · ${upm.byCapability.map((c) => c.key).slice(0, 3).join(', ')}`
              : ''}
          </div>
          <div class="text-[10px] text-[color:var(--color-fg-subtle)] mt-1 italic">
            {locale === 'da'
              ? 'Diskrete LLM-kald — adskilt fra ingest-cost ovenfor.'
              : 'Discrete LLM calls — separate from ingest cost above.'}
          </div>
        </div>
      ) : null}

      {/* Daily bar-chart */}
      <div>
        <h2 class="text-sm font-medium mb-2 text-[color:var(--color-fg-muted)]">
          {t('cost.dailyUsage')}
        </h2>
        {summary.byDay.length === 0 ? (
          <div class="p-4 text-sm text-[color:var(--color-fg-muted)] border border-dashed border-[color:var(--color-border)] rounded">
            {t('cost.noIngestsInWindow')}
          </div>
        ) : (
          <div class="flex items-end gap-px h-24 p-2 border border-[color:var(--color-border)] rounded bg-[color:var(--color-bg-subtle)]">
            {effectiveByDay.map((d) => {
              const estPart = includeShadow ? d.estimatedCents ?? 0 : 0;
              const heightPct =
                d.effectiveCents === 0 ? 2 : Math.max(2, (d.effectiveCents / maxDayCents) * 100);
              const jobLabel = t(d.jobs === 1 ? 'cost.job_one' : 'cost.job_other');
              // Locale-aware date in tooltip: ISO YYYY-MM-DD reads as
              // "year-month-day" to nerds but is wrong for everyone
              // outside ISO-8601-land. toLocaleDateString uses the
              // browser's lang-tag which the i18n switcher syncs.
              const dateLabel = formatLocaleDate(d.date, locale);
              const title =
                estPart > 0
                  ? `${dateLabel}: ${fmt(d.cents)} + ${fmt(estPart)} est. · ${d.jobs} ${jobLabel}`
                  : `${dateLabel}: ${fmt(d.cents)} · ${d.jobs} ${jobLabel}`;
              return (
                <div
                  key={d.date}
                  title={title}
                  class={
                    'flex-1 min-w-0 rounded-sm transition ' +
                    (d.cents > 0
                      ? 'bg-[color:var(--color-accent)]'
                      : estPart > 0
                        ? 'bg-[color:var(--color-accent)]/40'
                        : 'bg-[color:var(--color-border)]')
                  }
                  style={{ height: `${heightPct}%` }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Paginated + sortable source list */}
      <div>
        <div class="flex items-baseline justify-between mb-2">
          <h2 class="text-sm font-medium text-[color:var(--color-fg-muted)]">
            {t('cost.sources')}
            {sourcesPage && total > 0 ? (
              <span class="ml-2 font-normal">
                ({pageStart}–{pageEnd} {t('cost.pagination.of')} {total})
              </span>
            ) : null}
          </h2>
          <div class="flex items-center gap-1">
            <button
              disabled={!hasPrev || sourcesLoading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              class={
                'px-2 py-1 text-xs font-mono rounded transition ' +
                (hasPrev && !sourcesLoading
                  ? 'text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]'
                  : 'text-[color:var(--color-fg-subtle)] cursor-not-allowed')
              }
            >
              {t('cost.pagination.prev')}
            </button>
            <button
              disabled={!hasNext || sourcesLoading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              class={
                'px-2 py-1 text-xs font-mono rounded transition ' +
                (hasNext && !sourcesLoading
                  ? 'text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]'
                  : 'text-[color:var(--color-fg-subtle)] cursor-not-allowed')
              }
            >
              {t('cost.pagination.next')}
            </button>
          </div>
        </div>
        {sourcesPage === null || sourcesPage.sources.length === 0 ? (
          <div class="p-4 text-sm text-[color:var(--color-fg-muted)] border border-dashed border-[color:var(--color-border)] rounded">
            {t('cost.noSourcesInWindow')}
          </div>
        ) : (
          <table class="w-full text-sm">
            <thead class="text-xs text-[color:var(--color-fg-muted)] uppercase tracking-wide text-left">
              <tr class="border-b border-[color:var(--color-border)]">
                <th
                  class="py-2 pr-3 cursor-pointer select-none hover:text-[color:var(--color-fg)]"
                  onClick={() => toggleSort('title')}
                >
                  {t('cost.column.source')}{sortIndicator('title')}
                </th>
                <th
                  class="py-2 pr-3 text-right cursor-pointer select-none hover:text-[color:var(--color-fg)]"
                  onClick={() => toggleSort('cost')}
                >
                  {t('cost.column.cost')}{sortIndicator('cost')}
                </th>
                <th
                  class="py-2 pr-3 text-right cursor-pointer select-none hover:text-[color:var(--color-fg)]"
                  onClick={() => toggleSort('jobs')}
                >
                  {t('cost.column.ingests')}{sortIndicator('jobs')}
                </th>
                <th
                  class="py-2 text-right cursor-pointer select-none hover:text-[color:var(--color-fg)]"
                  onClick={() => toggleSort('recent')}
                >
                  {t('cost.column.lastIngested')}{sortIndicator('recent')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sourcesPage.sources.map((s) => (
                <tr
                  key={s.documentId}
                  class="border-b border-[color:var(--color-border)] hover:bg-[color:var(--color-bg-subtle)]"
                >
                  <td class="py-2 pr-3">
                    <a
                      href={`/kb/${kbId}/sources/${s.documentId}/compare`}
                      class="hover:underline"
                    >
                      {displayTitle(s.title, s.filename)}
                    </a>
                  </td>
                  <td class="py-2 pr-3 text-right font-mono">{fmt(s.cents)}</td>
                  <td class="py-2 pr-3 text-right font-mono text-[color:var(--color-fg-muted)]">
                    {s.jobCount}
                  </td>
                  <td class="py-2 text-right font-mono text-xs text-[color:var(--color-fg-muted)]">
                    {s.lastIngestedAt ? formatLocaleDate(s.lastIngestedAt.slice(0, 10), locale) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * F156 Phase 0 — credits balance card. Renders the tenant's running
 * balance + last 5 transactions + a friendly explanation of what
 * credits buy. No top-up button in v1; Stripe Checkout lands in
 * Phase 2 (F123).
 */
function CreditsCard({ credits }: { credits: CreditsResponse }) {
  const locale = useLocale();
  const balanceClass =
    credits.balance < 0
      ? 'text-red-400'
      : credits.balance < 100
        ? 'text-amber-400'
        : 'text-[color:var(--color-fg)]';
  const recent = credits.recent.slice(0, 5);
  return (
    <div class="p-4 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]/40">
      <div class="flex items-end justify-between gap-4">
        <div class="flex-1 min-w-0">
          <div class="text-xs font-mono uppercase tracking-wider text-[color:var(--color-fg-muted)] mb-1">
            {t('cost.credits.balance')}
          </div>
          <div class={`text-3xl font-mono ${balanceClass}`}>
            {credits.balance.toLocaleString()}
          </div>
          {credits.monthlyIncluded > 0 ? (
            <div class="text-[11px] font-mono text-[color:var(--color-fg-muted)] mt-1">
              {t('cost.credits.monthlyIncluded', {
                amount: credits.monthlyIncluded.toLocaleString(),
              })}
            </div>
          ) : null}
          <p class="text-[11px] text-[color:var(--color-fg-muted)] mt-2 max-w-xl leading-relaxed">
            {t('cost.credits.explanation')}
          </p>
        </div>
        {recent.length > 0 ? (
          <div class="text-right text-[11px] font-mono text-[color:var(--color-fg-muted)]">
            <div class="mb-1 uppercase tracking-wider">{t('cost.credits.recent')}</div>
            <ul class="space-y-0.5">
              {recent.map((tx) => (
                <li key={tx.id} class="flex items-center gap-2 justify-end">
                  <span class="text-[color:var(--color-fg-subtle)]">
                    {formatShortLocaleDate(tx.createdAt, locale)}
                  </span>
                  <span
                    class={
                      tx.amount < 0
                        ? 'text-red-400/80'
                        : 'text-[color:var(--color-accent)]'
                    }
                  >
                    {tx.amount > 0 ? '+' : ''}
                    {tx.amount}
                  </span>
                  <span class="text-[color:var(--color-fg-subtle)] uppercase">
                    {tx.feature ?? tx.kind}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
