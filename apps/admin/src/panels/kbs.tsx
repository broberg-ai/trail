import { useCallback, useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import type { KnowledgeBase } from '@trail/shared';
import { listKnowledgeBases, ApiError } from '../api';
import { useEvents, onStreamOpen, onFocusRefresh, debounce } from '../lib/event-stream';
import { invalidateKbs } from '../lib/kb-cache';
import { t, useLocale, getLocale } from '../lib/i18n';
import { CenteredLoader } from '../components/centered-loader';
import { NewTrailModal } from '../components/new-trail-modal';
import { EmptyState } from '../components/ui/empty-state';
import { Icons } from '../components/ui/icons';


/**
 * F217 — how big is this Trail. The server sends BOTH what the database claims
 * and what is present on disk, because on production today they disagree: 501 MB
 * of image records point at files that are gone. Showing only the sum would put
 * phantom megabytes in front of the owner as fact, and he would plan storage —
 * or delete something — against them.
 *
 * So the number shown is what is REALLY there, and the gap gets its own line
 * rather than being folded in or hidden.
 */
interface KbSizeInfo {
  totalBytes: number;
  totalBytesClaimed: number;
  sourceBytes: number;
  imageBytesPresent: number;
  knowledgeBytes: number;
  sourceCount: number;
  imageCount: number;
  imageMissingCount: number;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function KnowledgeBasesPanel() {
  useLocale();
  const { route } = useLocation();
  const [kbs, setKbs] = useState<KnowledgeBase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const onCreated = useCallback(
    (kb: { slug: string }) => {
      // Bust the KB cache the nav reads from so the new Trail resolves
      // as soon as the target route mounts. The kb_created event the
      // server emits would do this too, but navigating immediately is
      // faster than waiting for the SSE round-trip.
      invalidateKbs();
      setModalOpen(false);
      route(`/kb/${kb.slug}/neurons`);
    },
    [route],
  );

  const reload = useCallback(() => {
    listKnowledgeBases()
      .then(setKbs)
      .catch((err: ApiError) => setError(err.message));
  }, []);
  // Event-driven refetch must be debounced so bulk actions (reject 22 at
  // once) coalesce into a single fetch. Without this the browser queues
  // 22 fetches and out-of-order HTTP responses can overwrite the correct
  // final state with stale data.
  const reloadDebounced = useCallback(debounce(reload, 100), [reload]);

  useEffect(() => {
    reload();
  }, [reload]);

  // A new Trail created by any route (admin UI, bearer API, future CLI)
  // surfaces here live without a reload. Also bust the module-level KB
  // cache so the next useKb(newId) call in TrailNav can resolve it.
  //
  // Candidate events trigger a refetch too so the per-Trail pending badges
  // update live — the server's LIST_SQL recomputes pendingCandidateCount
  // per row, and re-issuing the same query is cheap.
  useEvents((e) => {
    if (e.type === 'kb_created') {
      invalidateKbs();
      reloadDebounced();
    } else if (
      e.type === 'candidate_created' ||
      e.type === 'candidate_approved' ||
      e.type === 'candidate_resolved'
    ) {
      reloadDebounced();
    }
  });
  useEffect(() => onStreamOpen(reload), [reload]);
  useEffect(() => onFocusRefresh(reload), [reload]);

  if (error) {
    return (
      <div class="page-shell">
        <h1 class="text-2xl font-semibold mb-2">{t('common.error')}</h1>
        <p class="text-[color:var(--color-fg-muted)]">{error}</p>
      </div>
    );
  }

  if (!kbs) {
    // Root (/) is pre-session — the user's locale preference hasn't
    // been validated yet, so hardcode "Loading…" in English rather
    // than trusting the localStorage value at this point.
    return (
      <div class="page-shell">
        <CenteredLoader label="Loading…" />
      </div>
    );
  }

  if (!kbs.length) {
    return (
      <div style={{ position: 'relative', padding: '60px 28px 40px', maxWidth: 1200, margin: '0 auto' }} data-testid="trails-root">
        <div class="constellation" style={{ opacity: 0.5 }} />
        <PageHeader
          title={t('kbs.title')}
          subtitle={t('kbs.totalNeurons', { n: '0' })}
          ctaLabel={t('kbs.newTrail.button')}
          onCta={() => setModalOpen(true)}
        />
        <EmptyState
          inline
          icon={<Icons.Network size={28} />}
          title={t('empty.noTrailsTitle')}
          body={t('empty.noTrailsBody')}
          ctaIcon={<Icons.Plus size={14} />}
          ctaLabel={t('empty.noTrailsCTA')}
          onCta={() => setModalOpen(true)}
        />
        <NewTrailModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={onCreated} />
      </div>
    );
  }

  // Total Neurons across every Trail on this server. Each KB already
  // ships a `wikiPageCount` in the list response, so no extra round-trip —
  // we just sum. Archived KBs are excluded by the server; archived
  // Neurons are excluded from the per-KB count by the same query.
  const totalNeurons = kbs.reduce((n, kb) => {
    const count = (kb as KnowledgeBase & { wikiPageCount?: number }).wikiPageCount;
    return n + (typeof count === 'number' ? count : 0);
  }, 0);
  const locale = useLocale();
  const formattedTotal = totalNeurons.toLocaleString(locale === 'da' ? 'da-DK' : 'en-US');

  return (
    <div style={{ position: 'relative', padding: '60px 28px 40px', maxWidth: 1200, margin: '0 auto' }} data-testid="trails-root">
      <div class="constellation" style={{ opacity: 0.5 }} />
      <PageHeader
        title={t('kbs.title')}
        subtitle={t('kbs.totalNeurons', { n: formattedTotal })}
        ctaLabel={t('kbs.newTrail.button')}
        onCta={() => setModalOpen(true)}
      />

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {kbs.map((kb) => {
          const pending = (kb as KnowledgeBase & { pendingCandidateCount?: number })
            .pendingCandidateCount ?? 0;
          const size = (kb as KnowledgeBase & { size?: KbSizeInfo }).size;
          const missingBytes = size ? size.totalBytesClaimed - size.totalBytes : 0;
          const neuronCount = (kb as KnowledgeBase & { wikiPageCount?: number }).wikiPageCount;
          return (
            <a
              key={kb.id}
              href={`/kb/${kb.slug}/neurons`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '18px 24px',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-card)',
                textDecoration: 'none',
                color: 'var(--color-fg)',
                transition: 'all var(--dur) var(--ease)',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.borderColor = 'var(--color-border-strong)';
                el.style.transform = 'translateY(-1px)';
                el.style.boxShadow = 'var(--shadow-md)';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.borderColor = 'var(--color-border)';
                el.style.transform = 'translateY(0)';
                el.style.boxShadow = 'none';
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{kb.name}</div>
                {kb.description ? (
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--color-fg-muted)',
                      marginTop: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {kb.description}
                  </div>
                ) : null}
                {size || typeof neuronCount === 'number' ? (
                  <div
                    data-testid={`trail-size-${kb.slug}`}
                    style={{
                      fontSize: 12,
                      color: 'var(--color-fg-muted)',
                      marginTop: 6,
                      fontFamily: 'var(--font-mono)',
                    }}
                    title={size ? `${fmtSize(size.sourceBytes)} kilder · ${fmtSize(size.imageBytesPresent)} billeder · ${fmtSize(size.knowledgeBytes)} viden` : undefined}
                  >
                    {typeof neuronCount === 'number' ? (
                      <span data-testid={`trail-neurons-${kb.slug}`}>
                        {t('kbs.neuronCount', {
                          n: neuronCount.toLocaleString(locale === 'da' ? 'da-DK' : 'en-US'),
                        })}
                        {size ? ' · ' : ''}
                      </span>
                    ) : null}
                    {size ? fmtSize(size.totalBytes) : null}
                    {size && missingBytes > 0 ? (
                      <span
                        data-testid={`trail-size-missing-${kb.slug}`}
                        style={{ color: 'var(--color-warning, #b45309)', marginLeft: 8 }}
                        title={`${size.imageMissingCount} billed-poster peger på filer der ikke findes`}
                      >
                        ⚠ {fmtSize(missingBytes)} mangler på disken
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {pending > 0 ? (
                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: 999,
                    background: 'var(--color-accent)',
                    color: 'var(--color-accent-fg)',
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                  }}
                  title={t('kbs.pendingBadge', { n: pending })}
                >
                  {pending}
                </span>
              ) : null}
              <span
                class="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--color-fg-subtle)',
                  minWidth: 120,
                  textAlign: 'right',
                }}
              >
                {kb.slug}
              </span>
            </a>
          );
        })}
      </div>

      <NewTrailModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={onCreated}
      />
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
  ctaLabel,
  onCta,
}: {
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        marginBottom: 32,
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: 32,
            letterSpacing: '-0.015em',
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <div
            class="mono"
            style={{
              marginTop: 6,
              fontSize: 12,
              color: 'var(--color-fg-muted)',
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
      {ctaLabel ? (
        <button type="button" class="btn btn-primary" onClick={onCta} style={{ flex: '0 0 auto' }}>
          <Icons.Plus size={13} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {ctaLabel}
          </span>
        </button>
      ) : null}
    </div>
  );
}
