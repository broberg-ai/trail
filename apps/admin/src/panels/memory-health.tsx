/**
 * F182.7 — Memory Health panel (/kb/:kbId/memory-health).
 *
 * Surfaces the confidence lifecycle for a Trail: a 5-bucket distribution
 * histogram, a Decaying tab (low-confidence Neurons a curator can pin to
 * exempt from decay), a Superseded tab (supersession chains), and per-Neuron-
 * type decay-rate (τ) sliders that persist to tenants.settings_json and feed
 * the F182.3 decay job. All custom primitives — no native sliders/selects.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import {
  getMemoryHealth,
  getDecayRates,
  saveDecayRates,
  pinNeuronConfidence,
  type MemoryHealthData,
  type DecayRatesResponse,
  type DecayingNeuron,
} from '../api';
import { ConfidencePill } from '../components/confidence-pill';
import { Slider } from '../components/ui/slider';
import { CenteredLoader } from '../components/centered-loader';
import { formatPathDisplay } from '../lib/display-path';
import { slugify } from '@trail/shared';
import { t } from '../lib/i18n';

const BUCKET_LABELS = ['0–0.2', '0.2–0.4', '0.4–0.6', '0.6–0.8', '0.8–1.0'];
// Bucket bar hue mirrors the ConfidencePill tiers (low→red, high→green).
const BUCKET_COLORS = [
  'var(--color-danger)',
  'var(--color-danger)',
  'var(--color-accent)',
  'var(--color-success)',
  'var(--color-success)',
];

type Tab = 'decaying' | 'superseded';
const TAU_MAX = 730; // slider ceiling; pinning is the "never decays" path.

export function MemoryHealthPanel() {
  const route = useRoute();
  const kbId = route.params.kbId;

  const [data, setData] = useState<MemoryHealthData | null>(null);
  const [rates, setRates] = useState<DecayRatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('decaying');
  const [decaying, setDecaying] = useState<DecayingNeuron[]>([]);
  const [pinningId, setPinningId] = useState<string | null>(null);
  // Local edits to τ before save; null = unchanged from server.
  const [draftRates, setDraftRates] = useState<Record<string, number> | null>(null);
  const [savingRates, setSavingRates] = useState(false);

  useEffect(() => {
    if (!kbId) return;
    setData(null);
    setError(null);
    getMemoryHealth(kbId)
      .then((d) => {
        setData(d);
        setDecaying(d.decaying);
      })
      .catch((e) => setError(String(e)));
    getDecayRates().then(setRates).catch(() => setRates(null));
  }, [kbId]);

  const histMax = useMemo(
    () => (data ? Math.max(1, ...data.histogram) : 1),
    [data],
  );

  const effectiveRates = draftRates ?? rates?.rates ?? null;
  const dirty = useMemo(() => {
    if (!draftRates || !rates) return false;
    return Object.keys(draftRates).some((k) => draftRates[k] !== rates.rates[k]);
  }, [draftRates, rates]);

  async function handlePin(n: DecayingNeuron) {
    if (pinningId) return;
    setPinningId(n.id);
    try {
      await pinNeuronConfidence(n.id, true);
      // Pinned → exempt from decay, drop it out of the decaying list.
      setDecaying((list) => list.filter((x) => x.id !== n.id));
    } catch {
      /* leave it in the list; the row's pin button can be retried */
    } finally {
      setPinningId(null);
    }
  }

  function setTau(type: string, value: number) {
    setDraftRates((prev) => ({ ...(prev ?? rates?.rates ?? {}), [type]: value }));
  }

  async function handleSaveRates() {
    if (!effectiveRates || savingRates) return;
    setSavingRates(true);
    try {
      const updated = await saveDecayRates(effectiveRates);
      setRates(updated);
      setDraftRates(null);
    } catch {
      /* keep the draft so the curator can retry */
    } finally {
      setSavingRates(false);
    }
  }

  if (error) {
    return (
      <div class="page-shell">
        <div class="border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/5 rounded-md p-4 text-sm">
          {error}
        </div>
      </div>
    );
  }
  if (!data) return <CenteredLoader />;

  return (
    <div class="page-shell" data-testid="memory-health-root">
      <header class="mb-6">
        <h1 style="font-family: var(--font-serif); font-weight: 400; font-size: 28px; letter-spacing: -0.015em; margin: 0 0 4px;">
          {t('lifecycle.memoryHealth')}
        </h1>
        <p class="text-sm text-[color:var(--color-fg-muted)]">{t('lifecycle.mhSubtitle')}</p>
      </header>

      {/* Histogram */}
      <section class="mb-8">
        <h2 class="text-[11px] font-mono uppercase tracking-wider text-[color:var(--color-fg-subtle)] mb-3">
          {t('lifecycle.mhDistribution')}
        </h2>
        <div class="flex items-end gap-3 h-40">
          {data.histogram.map((count, i) => (
            <div key={i} class="flex-1 flex flex-col items-center justify-end gap-1.5 h-full">
              <span class="text-[11px] font-mono text-[color:var(--color-fg-muted)]">{count}</span>
              <div
                class="w-full rounded-t transition-[height]"
                style={{
                  height: `${(count / histMax) * 100}%`,
                  minHeight: count > 0 ? '3px' : '0',
                  background: BUCKET_COLORS[i],
                  opacity: 0.55,
                }}
                title={t('lifecycle.mhCount', { n: count })}
              />
              <span class="text-[10px] font-mono text-[color:var(--color-fg-subtle)]">
                {BUCKET_LABELS[i]}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Tabs */}
      <div class="flex items-center gap-1 mb-4 border-b border-[color:var(--color-border)]">
        {(['decaying', 'superseded'] as Tab[]).map((tk) => (
          <button
            key={tk}
            type="button"
            onClick={() => setTab(tk)}
            class={
              'px-3 py-2 text-sm font-mono transition border-b-2 -mb-px active:scale-[0.98] ' +
              (tab === tk
                ? 'border-[color:var(--color-accent)] text-[color:var(--color-fg)]'
                : 'border-transparent text-[color:var(--color-fg-subtle)] hover:text-[color:var(--color-fg)]')
            }
          >
            {tk === 'decaying'
              ? `${t('lifecycle.mhDecaying')} (${decaying.length})`
              : `${t('lifecycle.mhSuperseded')} (${data.superseded.length})`}
          </button>
        ))}
      </div>

      {tab === 'decaying' ? (
        <section class="mb-8">
          <p class="text-[11px] text-[color:var(--color-fg-subtle)] mb-3">{t('lifecycle.mhDecayingHint')}</p>
          {decaying.length === 0 ? (
            <p class="text-sm text-[color:var(--color-fg-muted)] py-6 text-center">{t('lifecycle.mhNoDecaying')}</p>
          ) : (
            <ul class="flex flex-col divide-y divide-[color:var(--color-border)]">
              {decaying.map((n) => (
                <li key={n.id} class="flex items-center gap-3 py-2.5">
                  <ConfidencePill confidence={n.confidence} />
                  <a
                    href={`/kb/${kbId}/neurons/${encodeURIComponent(slugify(n.filename.replace(/\.md$/, '')))}`}
                    class="flex-1 min-w-0 hover:text-[color:var(--color-accent)] transition"
                  >
                    <span class="text-sm truncate block">{n.title ?? n.filename}</span>
                    <span class="text-[10px] font-mono text-[color:var(--color-fg-subtle)]">
                      {formatPathDisplay(n.path)}
                    </span>
                  </a>
                  <button
                    type="button"
                    onClick={() => handlePin(n)}
                    disabled={pinningId === n.id}
                    title={t('lifecycle.pinHint')}
                    class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider border border-[color:var(--color-border)] text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-accent)]/40 hover:text-[color:var(--color-accent)] transition active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span aria-hidden="true">📌</span>
                    {pinningId === n.id ? t('lifecycle.pinning') : t('lifecycle.pin')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section class="mb-8">
          {data.superseded.length === 0 ? (
            <p class="text-sm text-[color:var(--color-fg-muted)] py-6 text-center">{t('lifecycle.mhNoSuperseded')}</p>
          ) : (
            <ul class="flex flex-col divide-y divide-[color:var(--color-border)]">
              {data.superseded.map((s) => (
                <li key={s.id} class="flex items-center gap-2 py-2.5 text-sm">
                  <a
                    href={`/kb/${kbId}/neurons/${encodeURIComponent(slugify(s.filename.replace(/\.md$/, '')))}`}
                    class="line-through text-[color:var(--color-fg-subtle)] hover:text-[color:var(--color-fg)] transition truncate"
                  >
                    {s.title ?? s.filename}
                  </a>
                  <span class="text-[10px] font-mono text-[color:var(--color-fg-subtle)] shrink-0">
                    {t('lifecycle.mhReplacedBy')} →
                  </span>
                  {s.replacementId ? (
                    <a
                      href={`/kb/${kbId}/neurons/${encodeURIComponent(slugify((s.replacementFilename ?? '').replace(/\.md$/, '')))}`}
                      class="text-[color:var(--color-accent)] hover:underline truncate"
                    >
                      {s.replacementTitle ?? s.replacementFilename}
                    </a>
                  ) : (
                    <span class="text-[color:var(--color-fg-subtle)]">—</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Decay rates */}
      {rates && effectiveRates ? (
        <section class="border-t border-[color:var(--color-border)] pt-6">
          <h2 class="text-[11px] font-mono uppercase tracking-wider text-[color:var(--color-fg-subtle)] mb-1">
            {t('lifecycle.mhDecayRates')}
          </h2>
          <p class="text-[11px] text-[color:var(--color-fg-subtle)] mb-4">{t('lifecycle.mhDecayRatesHint')}</p>
          <div class="flex flex-col gap-3 max-w-xl">
            {Object.keys(rates.defaults).map((type) => {
              const value = effectiveRates[type] ?? rates.defaults[type] ?? 180;
              const isDefault = value === rates.defaults[type];
              return (
                <div key={type} class="flex items-center gap-4">
                  <span class="w-24 text-[12px] font-mono text-[color:var(--color-fg-muted)]">{type}</span>
                  <div class="flex-1">
                    <Slider
                      value={value}
                      min={1}
                      max={TAU_MAX}
                      step={5}
                      ariaLabel={`${type} decay τ in days`}
                      onChange={(v) => setTau(type, v)}
                    />
                  </div>
                  <span
                    class={
                      'w-16 text-right text-[12px] font-mono ' +
                      (isDefault ? 'text-[color:var(--color-fg-subtle)]' : 'text-[color:var(--color-accent)]')
                    }
                  >
                    {value}d
                  </span>
                </div>
              );
            })}
          </div>
          <div class="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveRates}
              disabled={!dirty || savingRates}
              class="px-4 py-1.5 rounded-md text-sm border border-[color:var(--color-accent)]/50 text-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10 hover:bg-[color:var(--color-accent)]/20 transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingRates ? t('lifecycle.pinning') : t('lifecycle.mhSave')}
            </button>
            {dirty ? (
              <button
                type="button"
                onClick={() => setDraftRates(null)}
                class="text-[11px] font-mono text-[color:var(--color-fg-subtle)] hover:text-[color:var(--color-fg)] transition"
              >
                {t('lifecycle.mhReset')}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
