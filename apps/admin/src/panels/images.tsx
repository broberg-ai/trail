/**
 * F163 — Image gallery panel.
 *
 * Curator-facing browse + search over /knowledge-bases/:kbId/images.
 * Grid view (auto-fill 180px columns), debounced search input,
 * cursor-paginated infinite-scroll/load-more, click-to-modal with
 * full-size + metadata + Open-in-source link.
 *
 * No new backend code — F164 Phase 1 added cursor-pagination + docId
 * filter to the existing F161 endpoint, which is all this consumer
 * needs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import {
  listImages,
  listImageSources,
  bulkDeleteImages,
  bulkRateImages,
  submitJob,
  type ImageHit,
  type ImageSource,
  type FlagFilter,
  ApiError,
} from '../api';
import { showJob } from '../lib/jobs-store';
import { t, useLocale } from '../lib/i18n';
import { CenteredLoader } from '../components/centered-loader';
import { Modal, ModalButton } from '../components/modal';
import { lockBodyScroll } from '../lib/scroll-lock';

const LIMIT = 36;
const SEARCH_DEBOUNCE_MS = 250;
const VIEW_STORAGE_KEY = 'trail.images.view';

type StatusValue = '' | FlagFilter | 'missing-description';

function statusToApi(v: StatusValue): { flag?: FlagFilter; missingDescription?: boolean } {
  if (v === '') return {};
  if (v === 'missing-description') return { missingDescription: true };
  return { flag: v };
}

function readView(): 'cards' | 'list' {
  if (typeof localStorage === 'undefined') return 'cards';
  const v = localStorage.getItem(VIEW_STORAGE_KEY);
  return v === 'list' ? 'list' : 'cards';
}

export function ImagesPanel() {
  const route = useRoute();
  const kbId = route.params.kbId ?? '';
  useLocale();

  const [hits, setHits] = useState<ImageHit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [docFilter, setDocFilter] = useState<string>(''); // empty = all
  // F163.2 — flag-status filter: undefined = all, else any|auto|user|none.
  // F163.2 / F163.2.x — single status-filter dropdown spans both flag-
  // status (any|auto|user|none) and "missing description". v1 keeps
  // them mutually exclusive — pick one or none. Translation to API
  // params happens at the call-site.
  const [statusFilter, setStatusFilter] = useState<StatusValue>('');
  const [sourceList, setSourceList] = useState<ImageSource[] | null>(null);
  const [openHit, setOpenHit] = useState<ImageHit | null>(null);
  // F163.1 Phase 2 — selection + view-mode state.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'cards' | 'list'>(() => readView());
  // F163.1 Phase 3 — bulk-action state.
  const [bulkBusy, setBulkBusy] = useState<null | 'flag' | 'delete'>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // F163.2.x — per-image rescan-in-flight tracker.
  const [rescanBusy, setRescanBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    }
  }, [view]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // Debounce the search query so we don't fire a request on every key.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Load source-list once for the filter dropdown. Uses the dedicated
  // /images/sources endpoint so we only show docs that ACTUALLY have
  // images — text-only sources are excluded (would always return 0 hits).
  useEffect(() => {
    if (!kbId) return;
    listImageSources(kbId)
      .then((r) => setSourceList(r.sources))
      .catch(() => setSourceList([]));
  }, [kbId]);

  // Reset and fetch the first page whenever query/filter changes.
  // Selection clears too — we don't want a stale selection from page A
  // to "carry over" when the user changes filter to page B.
  useEffect(() => {
    if (!kbId) return;
    let cancelled = false;
    setLoading(true);
    setHits([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
    setSelected(new Set());
    listImages(kbId, {
      q: debouncedQuery || undefined,
      docId: docFilter || undefined,
      ...statusToApi(statusFilter),
      limit: LIMIT,
    })
      .then((r) => {
        if (cancelled) return;
        setHits(r.hits);
        setCursor(r.nextCursor);
        setHasMore(r.nextCursor !== null);
      })
      .catch((err: ApiError) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kbId, debouncedQuery, docFilter, statusFilter]);

  const loadMore = useCallback(async () => {
    if (!kbId || !cursor || loading) return;
    setLoading(true);
    try {
      const r = await listImages(kbId, {
        q: debouncedQuery || undefined,
        docId: docFilter || undefined,
        ...statusToApi(statusFilter),
        limit: LIMIT,
        cursor,
      });
      setHits((prev) => [...prev, ...r.hits]);
      setCursor(r.nextCursor);
      setHasMore(r.nextCursor !== null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [kbId, cursor, loading, debouncedQuery, docFilter, statusFilter]);

  const docFilterLabel = useMemo(() => {
    if (!docFilter || !sourceList) return t('images.filterAllSources');
    const d = sourceList.find((s) => s.id === docFilter);
    return d?.title ?? d?.filename ?? docFilter;
  }, [docFilter, sourceList]);

  // F163.2.x — per-image Vision rescan. Submits a vision-rerun job
  // scoped to a single image-id. Hands the curator off to the F164
  // progress modal so they can watch the result land. Useful for the
  // "Mangler beskrivelse" filter — one click per row instead of
  // re-running the whole doc.
  const onRescanImage = useCallback(async (imageId: string) => {
    if (!kbId || rescanBusy.has(imageId)) return;
    setRescanBusy((prev) => new Set(prev).add(imageId));
    try {
      const r = await submitJob({
        kind: 'vision-rerun',
        payload: { imageIds: [imageId] },
      });
      showJob(r.id);
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRescanBusy((prev) => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });
    }
  }, [kbId, rescanBusy]);

  // Bulk-flag: thumbs-down via F164 Phase 5 endpoint. Reversible, so
  // no confirm modal. Optimistic — clear selection immediately, show
  // toast on success/failure.
  const onBulkFlag = useCallback(async () => {
    if (!kbId || bulkBusy || selected.size === 0) return;
    const ids = Array.from(selected);
    setBulkBusy('flag');
    try {
      const r = await bulkRateImages(kbId, ids, 'down');
      setToast(t('images.bulkFlagDone', { n: r.rated }));
      setSelected(new Set());
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBulkBusy(null);
    }
  }, [kbId, bulkBusy, selected]);

  // Bulk-delete: HARD-delete via F163.1 Phase 1 endpoint. Always behind
  // confirm modal — irreversible. On success: toast + remove from
  // current hits-array (instead of refetching, which would jolt the
  // user back to top of page).
  const onBulkDelete = useCallback(async () => {
    if (!kbId || bulkBusy || selected.size === 0) return;
    const ids = Array.from(selected);
    setBulkBusy('delete');
    try {
      const r = await bulkDeleteImages(kbId, ids);
      const idSet = new Set(ids);
      setHits((prev) => prev.filter((h) => !idSet.has(h.id)));
      setSelected(new Set());
      setDeleteConfirm(false);
      const warn = r.storageWarnings.length > 0 ? ` (${r.storageWarnings.length} blob warnings)` : '';
      setToast(t('images.bulkDeleteDone', { n: r.deleted }) + warn);
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBulkBusy(null);
    }
  }, [kbId, bulkBusy, selected]);

  const isEmpty = !loading && hits.length === 0 && !error;

  // Selection helpers — kept stable via useCallback so child rows don't
  // re-render on unrelated state changes.
  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAllOnPage = useCallback(() => {
    setSelected(new Set(hits.map((h) => h.id)));
  }, [hits]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const allSelected = hits.length > 0 && selected.size === hits.length;

  return (
    <div class="page-shell">
      <header class="mb-6">
        <h1 class="text-2xl font-semibold tracking-tight mb-1">{t('images.title')}</h1>
        <p class="text-[color:var(--color-fg-muted)] text-sm">
          {hits.length > 0 ? (
            t(hits.length === 1 ? 'images.summary' : 'images.summaryPlural', {
              n: hits.length + (hasMore ? '+' : ''),
            })
          ) : loading ? (
            <span class="loading-delayed inline-block">{t('common.loading')}</span>
          ) : (
            t('images.summaryEmpty')
          )}
        </p>
      </header>

      <section class="mb-4 flex flex-col md:flex-row gap-3 md:items-center">
        <input
          type="search"
          placeholder={t('images.searchPlaceholder')}
          value={query}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          class="flex-1 px-3 py-2 text-sm rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] focus:border-[color:var(--color-accent)] focus:outline-none"
        />
        {sourceList && sourceList.length > 0 ? (
          <SourceFilter
            label={docFilterLabel}
            sources={sourceList}
            value={docFilter}
            onChange={setDocFilter}
          />
        ) : null}
        <StatusFilter value={statusFilter} onChange={setStatusFilter} />
        <ViewToggle value={view} onChange={setView} />
      </section>

      {selected.size > 0 ? (
        <SelectionBar
          count={selected.size}
          allSelected={allSelected}
          onSelectAll={selectAllOnPage}
          onClear={clearSelection}
          onFlag={onBulkFlag}
          onDelete={() => setDeleteConfirm(true)}
          busy={bulkBusy}
        />
      ) : null}

      {toast ? (
        <div class="mb-3 px-3 py-2 rounded-md border border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/5 text-[color:var(--color-accent)] text-xs font-mono">
          {toast}
        </div>
      ) : null}

      {error ? (
        <div class="border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/5 rounded-md p-4 text-sm mb-4">
          {error}
        </div>
      ) : null}

      {isEmpty ? (
        <div class="text-center py-16 text-[color:var(--color-fg-subtle)]">
          {debouncedQuery
            ? t('images.emptySearch', { q: debouncedQuery })
            : t('images.empty')}
        </div>
      ) : null}

      {hits.length === 0 && loading ? <CenteredLoader /> : null}

      {hits.length > 0 && view === 'cards' ? (
        <div
          class="grid gap-3"
          style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));"
        >
          {hits.map((hit) => (
            <ImageTile
              key={hit.id}
              hit={hit}
              isSelected={selected.has(hit.id)}
              onToggleSelect={() => toggleSelected(hit.id)}
              onOpen={() => setOpenHit(hit)}
            />
          ))}
        </div>
      ) : null}

      {hits.length > 0 && view === 'list' ? (
        <ImageList
          hits={hits}
          selected={selected}
          onToggleSelect={toggleSelected}
          onOpen={(hit) => setOpenHit(hit)}
          onRescan={onRescanImage}
          rescanBusy={rescanBusy}
        />
      ) : null}

      {hasMore ? (
        <div class="mt-6 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            class="px-4 py-2 text-sm font-mono rounded-md border border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-card)] disabled:opacity-50 active:scale-95 transition"
          >
            {loading ? '…' : t('images.loadMore')}
          </button>
        </div>
      ) : null}

      {openHit ? (
        <ImageDetail
          hit={openHit}
          kbId={kbId}
          source={sourceList?.find((s) => s.id === openHit.documentId) ?? null}
          onClose={() => setOpenHit(null)}
        />
      ) : null}

      <Modal
        open={deleteConfirm}
        title={t('images.bulkDeleteConfirm', { n: selected.size })}
        onClose={() => (!bulkBusy ? setDeleteConfirm(false) : undefined)}
        footer={
          <>
            <ModalButton onClick={() => setDeleteConfirm(false)} disabled={bulkBusy !== null}>
              {t('common.cancel')}
            </ModalButton>
            <ModalButton
              variant="danger"
              onClick={onBulkDelete}
              disabled={bulkBusy !== null}
            >
              {bulkBusy === 'delete' ? '…' : t('images.bulkDeleteAction')}
            </ModalButton>
          </>
        }
      >
        <p class="text-sm text-[color:var(--color-fg-muted)] leading-relaxed">
          {t('images.bulkDeleteWarning', { n: selected.size })}
        </p>
      </Modal>
    </div>
  );
}

function ImageTile({
  hit,
  isSelected,
  onToggleSelect,
  onOpen,
}: {
  hit: ImageHit;
  isSelected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const noDescription = !hit.alt || hit.alt.length === 0;
  // Outer button = open Lightbox. Checkbox stops propagation so click
  // toggles selection without also opening the modal.
  return (
    <button
      type="button"
      onClick={onOpen}
      class={
        'group flex flex-col text-left rounded-md overflow-hidden border transition ' +
        (isSelected
          ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/5 ring-1 ring-[color:var(--color-accent)]'
          : 'border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] hover:border-[color:var(--color-border-strong)] active:scale-[0.99]')
      }
    >
      <div class="relative aspect-square bg-[color:var(--color-bg)] overflow-hidden">
        <img
          src={hit.url}
          alt={hit.alt}
          loading="lazy"
          class="w-full h-full object-cover transition group-hover:scale-105"
        />
        <div class="absolute top-1.5 right-1.5 flex items-center gap-1">
          <FlagBadges
            autoFlag={hit.autoFlagSignal}
            autoFlagReason={hit.autoFlagReason}
            userFlagged={hit.userFlagged}
          />
          {hit.page != null ? (
            <span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/60 text-white">
              {t('images.pageBadge', { n: hit.page })}
            </span>
          ) : null}
        </div>
        <span
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          class="absolute top-1.5 left-1.5 inline-flex items-center justify-center w-6 h-6 rounded bg-black/60 hover:bg-black/80 transition cursor-pointer"
          role="checkbox"
          aria-checked={isSelected}
          aria-label={t('images.selectImage')}
        >
          {isSelected ? (
            <span class="text-white text-sm font-bold leading-none">✓</span>
          ) : (
            <span class="block w-3 h-3 border-2 border-white/70 rounded-sm" />
          )}
        </span>
      </div>
      <div class="p-2">
        {noDescription ? (
          <div class="text-[11px] font-mono text-[color:var(--color-fg-subtle)] italic line-clamp-2">
            {t('images.noDescription')}
          </div>
        ) : (
          <div class="text-[12px] leading-snug line-clamp-2 text-[color:var(--color-fg-muted)]">
            {hit.alt}
          </div>
        )}
      </div>
    </button>
  );
}

function ImageList({
  hits,
  selected,
  onToggleSelect,
  onOpen,
  onRescan,
  rescanBusy,
}: {
  hits: ImageHit[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpen: (hit: ImageHit) => void;
  onRescan: (imageId: string) => void;
  rescanBusy: Set<string>;
}) {
  return (
    <div class="overflow-x-auto rounded-md border border-[color:var(--color-border)]">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="text-left text-[10px] font-mono uppercase tracking-wider text-[color:var(--color-fg-subtle)] border-b border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]/40">
            <th class="px-3 py-2 font-normal w-10"></th>
            <th class="px-3 py-2 font-normal w-[100px]"></th>
            <th class="px-3 py-2 font-normal">{t('images.colDescription')}</th>
            <th class="px-3 py-2 font-normal w-[100px]">{t('images.colPage')}</th>
            <th class="px-3 py-2 font-normal w-[120px]">{t('images.colDimensions')}</th>
          </tr>
        </thead>
        <tbody>
          {hits.map((hit) => {
            const isSelected = selected.has(hit.id);
            return (
              <tr
                key={hit.id}
                onClick={() => onOpen(hit)}
                class={
                  'border-b border-[color:var(--color-border)] cursor-pointer transition ' +
                  (isSelected
                    ? 'bg-[color:var(--color-accent)]/10'
                    : 'hover:bg-[color:var(--color-bg-card)]/40')
                }
              >
                <td
                  class="px-3 py-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(hit.id);
                  }}
                >
                  <span
                    class="inline-flex items-center justify-center w-5 h-5 rounded border border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)] transition cursor-pointer"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={t('images.selectImage')}
                  >
                    {isSelected ? (
                      <span class="text-[color:var(--color-accent)] text-xs font-bold leading-none">✓</span>
                    ) : null}
                  </span>
                </td>
                <td class="px-3 py-2">
                  <img
                    src={hit.url}
                    alt={hit.alt}
                    loading="lazy"
                    class="w-20 h-20 object-cover rounded border border-[color:var(--color-border)]"
                  />
                </td>
                <td class="px-3 py-2 text-[12px] leading-snug text-[color:var(--color-fg-muted)]">
                  <div class="flex items-center gap-2">
                    <FlagBadges
                      autoFlag={hit.autoFlagSignal}
                      autoFlagReason={hit.autoFlagReason}
                      userFlagged={hit.userFlagged}
                      compact
                    />
                    <span class="flex-1 min-w-0">
                      {hit.alt || (
                        <span class="italic text-[color:var(--color-fg-subtle)]">
                          {t('images.noDescription')}
                        </span>
                      )}
                    </span>
                    {!hit.alt ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRescan(hit.id);
                        }}
                        disabled={rescanBusy.has(hit.id)}
                        class="flex-shrink-0 px-2 py-1 text-[11px] font-mono rounded border border-[color:var(--color-accent)]/40 text-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10 disabled:opacity-50 transition"
                        title={t('images.rescanHint')}
                      >
                        {rescanBusy.has(hit.id) ? '…' : t('images.rescan')}
                      </button>
                    ) : null}
                  </div>
                </td>
                <td class="px-3 py-2 font-mono text-xs text-[color:var(--color-fg-subtle)]">
                  {hit.page != null ? t('images.pageBadge', { n: hit.page }) : '—'}
                </td>
                <td class="px-3 py-2 font-mono text-xs text-[color:var(--color-fg-subtle)]">
                  {hit.width}×{hit.height}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: 'cards' | 'list';
  onChange: (v: 'cards' | 'list') => void;
}) {
  return (
    <div
      class="inline-flex items-center rounded-md border border-[color:var(--color-border)] overflow-hidden"
      role="group"
      aria-label={t('images.viewToggle')}
    >
      <button
        type="button"
        onClick={() => onChange('cards')}
        class={
          'px-3 py-1.5 text-xs font-mono transition ' +
          (value === 'cards'
            ? 'bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]'
            : 'text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] hover:bg-[color:var(--color-bg-card)]')
        }
        aria-pressed={value === 'cards'}
        title={t('images.viewCards')}
      >
        {t('images.viewCards')}
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        class={
          'px-3 py-1.5 text-xs font-mono transition ' +
          (value === 'list'
            ? 'bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]'
            : 'text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] hover:bg-[color:var(--color-bg-card)]')
        }
        aria-pressed={value === 'list'}
        title={t('images.viewList')}
      >
        {t('images.viewList')}
      </button>
    </div>
  );
}

function SelectionBar({
  count,
  allSelected,
  onSelectAll,
  onClear,
  onFlag,
  onDelete,
  busy,
}: {
  count: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onFlag: () => void;
  onDelete: () => void;
  busy: null | 'flag' | 'delete';
}) {
  return (
    <div class="sticky top-2 z-10 mb-3 px-3 py-2 rounded-md border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/5 backdrop-blur-sm flex flex-wrap items-center gap-3 text-xs font-mono">
      <span class="text-[color:var(--color-fg)] font-medium">
        {t('images.selectedCount', { n: count })}
      </span>
      {!allSelected ? (
        <button
          type="button"
          onClick={onSelectAll}
          class="text-[color:var(--color-accent)] hover:text-[color:var(--color-fg)] transition"
        >
          {t('images.selectAll')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        disabled={busy !== null}
        class="text-[color:var(--color-fg-subtle)] hover:text-[color:var(--color-fg)] disabled:opacity-50 transition"
      >
        {t('images.clearSelection')}
      </button>
      <div class="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={onFlag}
          disabled={busy !== null}
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-card)] disabled:opacity-50 transition"
          title={t('images.bulkFlagHint')}
        >
          <span>👎</span>
          <span>{busy === 'flag' ? '…' : t('images.bulkFlag', { n: count })}</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy !== null}
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-[color:var(--color-danger)]/40 text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 disabled:opacity-50 transition"
          title={t('images.bulkDeleteHint')}
        >
          <span>🗑</span>
          <span>{busy === 'delete' ? '…' : t('images.bulkDelete', { n: count })}</span>
        </button>
      </div>
    </div>
  );
}

function SourceFilter({
  label,
  sources,
  value,
  onChange,
}: {
  label: string;
  sources: ImageSource[];
  value: string;
  onChange: (v: string) => void;
}) {
  // Trail-styled popover dropdown. Replaces native <select> which
  // surfaces the macOS combobox chrome — broken for the Bauhaus palette.
  // Click-outside + Escape close, arrow keys nav, focus-on-open.
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

  return (
    <div class="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="relative flex items-center gap-2 pl-3 pr-8 py-2 text-sm rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] focus:outline-none active:scale-[0.99] transition cursor-pointer w-[240px] text-left"
        aria-label={t('images.filterBySource')}
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
          class="absolute left-0 top-full mt-1 z-20 w-[320px] max-h-[60vh] overflow-y-auto rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-card)] shadow-2xl"
          role="listbox"
          aria-label={t('images.filterBySource')}
        >
          <DropdownItem
            active={value === ''}
            onClick={() => select('')}
            label={t('images.filterAllSources')}
          />
          <div class="border-t border-[color:var(--color-border)] my-1" />
          {sources.map((s) => (
            <DropdownItem
              key={s.id}
              active={value === s.id}
              onClick={() => select(s.id)}
              label={s.title ?? s.filename}
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
      title={label}
      class={
        'w-full text-left px-3 py-2 text-sm transition flex items-center gap-2 ' +
        (active
          ? 'bg-[color:var(--color-accent)]/10 text-[color:var(--color-fg)]'
          : 'text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-bg)]/60 hover:text-[color:var(--color-fg)]')
      }
    >
      <span
        class={
          'inline-block w-3 flex-shrink-0 text-[color:var(--color-accent)] ' + (active ? 'opacity-100' : 'opacity-0')
        }
      >
        ✓
      </span>
      <span class="truncate flex-1 min-w-0">{label}</span>
    </button>
  );
}

function ImageDetail({
  hit,
  kbId,
  source,
  onClose,
}: {
  hit: ImageHit;
  kbId: string;
  source: ImageSource | null;
  onClose: () => void;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true } as never);
  }, []);

  useEffect(() => lockBodyScroll(), []);

  // Push a history entry on open so browser-back closes the Lightbox
  // first, instead of jumping back to the previous page (e.g. /sources
  // if the user reached /images via the trail-nav). On unmount, if the
  // user closed via UI (X / ESC / backdrop), we consume our pushed
  // entry by calling history.back() — net zero entries leftover.
  // If the close was triggered by browser-back (popstate), we skip the
  // back-call to avoid a double-back loop.
  useEffect(() => {
    let closedByPop = false;
    history.pushState({ trailLightbox: true }, '');
    const onPop = () => {
      closedByPop = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!closedByPop) {
        // Only consume our pushed entry if popstate didn't already.
        try {
          history.back();
        } catch {
          // ignore — some embed contexts disallow programmatic back
        }
      }
    };
  }, []);

  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(hit.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const sourceLabel = source?.title ?? source?.filename ?? hit.documentId.slice(0, 8) + '…';
  const openSourceHref = `/kb/${kbId}/sources?expanded=${encodeURIComponent(hit.documentId)}`;

  return (
    <div
      class="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm cursor-zoom-out"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={hit.alt || hit.filename}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        class="absolute top-4 right-4 inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white transition cursor-pointer"
        aria-label={t('images.closeEsc')}
        title={t('images.closeEsc')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 6L18 18M18 6L6 18" />
        </svg>
      </button>

      <img
        src={hit.url}
        alt={hit.alt}
        onClick={(e) => e.stopPropagation()}
        class="max-w-[90vw] max-h-[70vh] object-contain rounded-md cursor-default shadow-2xl"
      />

      <div
        class="mt-4 max-w-[80vw] w-full px-4 text-white/90 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {hit.alt ? (
          <p class="text-sm leading-relaxed text-center">{hit.alt}</p>
        ) : (
          <p class="text-sm italic text-white/60 text-center">{t('images.noDescription')}</p>
        )}

        <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-mono text-white/60">
          <span>{sourceLabel}</span>
          {hit.page != null ? <span>· {t('images.pageBadge', { n: hit.page })}</span> : null}
          <span>· {hit.width}×{hit.height}</span>
          {hit.visionModel ? <span>· {hit.visionModel}</span> : null}
        </div>

        <div class="flex flex-wrap items-center justify-center gap-3 pt-2">
          <a
            href={openSourceHref}
            class="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm bg-white/10 hover:bg-white/20 text-white transition"
          >
            {t('images.openSource')}
          </a>
          <button
            type="button"
            onClick={onCopy}
            class="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm bg-white/10 hover:bg-white/20 text-white transition"
          >
            {copied ? t('images.copied') : t('images.copyUrl')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * F163.2 — flag-status filter dropdown. 5 modes:
 *   - '' (all)
 *   - 'any' (auto OR curator)
 *   - 'auto' (auto only)
 *   - 'user' (curator only)
 *   - 'none' (neither)
 *
 * Mirrors SourceFilter's popover-listbox pattern for visual consistency.
 */
function StatusFilter({
  value,
  onChange,
}: {
  value: StatusValue;
  onChange: (v: StatusValue) => void;
}) {
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

  const select = (v: StatusValue) => {
    onChange(v);
    setOpen(false);
  };

  const options: Array<{ value: StatusValue; key: string }> = [
    { value: '', key: 'images.statusAll' },
    { value: 'any', key: 'images.statusFlagged' },
    { value: 'auto', key: 'images.statusAutoFlagged' },
    { value: 'user', key: 'images.statusUserFlagged' },
    { value: 'none', key: 'images.statusNotFlagged' },
    { value: 'missing-description', key: 'images.statusMissingDescription' },
  ];
  const activeLabel = options.find((o) => o.value === value)?.key ?? 'images.statusAll';

  return (
    <div class="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="relative flex items-center gap-2 pl-3 pr-8 py-2 text-sm rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] focus:outline-none active:scale-[0.99] transition cursor-pointer w-[180px] text-left"
        aria-label={t('images.statusFilter')}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span class="truncate flex-1 min-w-0">{t(activeLabel as never)}</span>
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[color:var(--color-fg-muted)]">
          ▾
        </span>
      </button>
      {open ? (
        <div
          class="absolute left-0 top-full mt-1 z-20 w-[220px] rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-card)] shadow-2xl"
          role="listbox"
          aria-label={t('images.statusFilter')}
        >
          {options.map((opt) => (
            <DropdownItem
              key={opt.value || 'all'}
              active={value === opt.value}
              onClick={() => select(opt.value)}
              label={t(opt.key as never)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * F163.2 — flag badges. Renders ⚐ (auto) / ⚑ (curator) icons with
 * hover-tooltip on autoFlagReason. Compact mode for list-view (smaller,
 * inline before description); default for cards (overlay).
 */
function FlagBadges({
  autoFlag,
  autoFlagReason,
  userFlagged,
  compact,
}: {
  autoFlag: boolean;
  autoFlagReason: string | null;
  userFlagged: boolean;
  compact?: boolean;
}) {
  if (!autoFlag && !userFlagged) return null;
  const sizeCls = compact ? 'text-[12px]' : 'px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/60 text-white';
  return (
    <span class={compact ? 'inline-flex items-center gap-1 flex-shrink-0' : 'inline-flex items-center gap-1'}>
      {autoFlag ? (
        <span
          class={sizeCls + (compact ? ' text-[color:var(--color-warning,#f59e0b)]' : '')}
          title={
            autoFlagReason
              ? t('images.autoFlagTooltip', { reason: autoFlagReason })
              : t('images.autoFlagBadge')
          }
          aria-label={t('images.autoFlagBadge')}
        >
          ⚐
        </span>
      ) : null}
      {userFlagged ? (
        <span
          class={sizeCls + (compact ? ' text-[color:var(--color-danger)]' : '')}
          title={t('images.userFlagTooltip')}
          aria-label={t('images.userFlagBadge')}
        >
          ⚑
        </span>
      ) : null}
    </span>
  );
}
