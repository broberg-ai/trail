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
  listSources,
  type ImageHit,
  ApiError,
} from '../api';
import type { Document } from '@trail/shared';
import { t, useLocale } from '../lib/i18n';
import { CenteredLoader } from '../components/centered-loader';
import { lockBodyScroll } from '../lib/scroll-lock';

const LIMIT = 36;
const SEARCH_DEBOUNCE_MS = 250;

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
  const [sourceList, setSourceList] = useState<Document[] | null>(null);
  const [openHit, setOpenHit] = useState<ImageHit | null>(null);

  // Debounce the search query so we don't fire a request on every key.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Load source-list once for the filter dropdown.
  useEffect(() => {
    if (!kbId) return;
    listSources(kbId, 'all')
      .then((list) =>
        setSourceList(
          list
            .filter((d) => d.kind === 'source' && !d.archived)
            .sort((a, b) => a.filename.localeCompare(b.filename)),
        ),
      )
      .catch(() => setSourceList([]));
  }, [kbId]);

  // Reset and fetch the first page whenever query/filter changes.
  useEffect(() => {
    if (!kbId) return;
    let cancelled = false;
    setLoading(true);
    setHits([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
    listImages(kbId, {
      q: debouncedQuery || undefined,
      docId: docFilter || undefined,
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
  }, [kbId, debouncedQuery, docFilter]);

  const loadMore = useCallback(async () => {
    if (!kbId || !cursor || loading) return;
    setLoading(true);
    try {
      const r = await listImages(kbId, {
        q: debouncedQuery || undefined,
        docId: docFilter || undefined,
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
  }, [kbId, cursor, loading, debouncedQuery, docFilter]);

  const docFilterLabel = useMemo(() => {
    if (!docFilter || !sourceList) return t('images.filterAllSources');
    const d = sourceList.find((s) => s.id === docFilter);
    return d?.title ?? d?.filename ?? docFilter;
  }, [docFilter, sourceList]);

  const isEmpty = !loading && hits.length === 0 && !error;

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
      </section>

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

      {hits.length > 0 ? (
        <div
          class="grid gap-3"
          style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));"
        >
          {hits.map((hit) => (
            <ImageTile key={hit.id} hit={hit} onOpen={() => setOpenHit(hit)} />
          ))}
        </div>
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
    </div>
  );
}

function ImageTile({ hit, onOpen }: { hit: ImageHit; onOpen: () => void }) {
  const noDescription = !hit.alt || hit.alt.length === 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      class="group flex flex-col text-left bg-[color:var(--color-bg-card)] rounded-md overflow-hidden border border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)] active:scale-[0.99] transition"
    >
      <div class="relative aspect-square bg-[color:var(--color-bg)] overflow-hidden">
        <img
          src={hit.url}
          alt={hit.alt}
          loading="lazy"
          class="w-full h-full object-cover transition group-hover:scale-105"
        />
        {hit.page != null ? (
          <span class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/60 text-white">
            {t('images.pageBadge', { n: hit.page })}
          </span>
        ) : null}
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

function SourceFilter({
  label,
  sources,
  value,
  onChange,
}: {
  label: string;
  sources: Document[];
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
        class="inline-flex items-center gap-2 px-3 py-2 pr-8 text-sm rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] focus:outline-none active:scale-[0.99] transition cursor-pointer min-w-[200px] text-left"
        aria-label={t('images.filterBySource')}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span class="truncate flex-1">{label}</span>
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[color:var(--color-fg-muted)]">
          ▾
        </span>
      </button>
      {open ? (
        <div
          class="absolute left-0 top-full mt-1 z-20 min-w-[280px] max-h-[60vh] overflow-y-auto rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-card)] shadow-2xl"
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
      class={
        'w-full text-left px-3 py-2 text-sm transition flex items-center gap-2 ' +
        (active
          ? 'bg-[color:var(--color-accent)]/10 text-[color:var(--color-fg)]'
          : 'text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-bg)]/60 hover:text-[color:var(--color-fg)]')
      }
    >
      <span
        class={
          'inline-block w-3 text-[color:var(--color-accent)] ' + (active ? 'opacity-100' : 'opacity-0')
        }
      >
        ✓
      </span>
      <span class="truncate flex-1">{label}</span>
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
  source: Document | null;
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
        class="absolute top-4 right-4 inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white text-3xl font-bold leading-none transition cursor-pointer"
        aria-label={t('images.closeEsc')}
        title={t('images.closeEsc')}
      >
        ×
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
