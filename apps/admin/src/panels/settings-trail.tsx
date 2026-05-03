import { useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import type { KnowledgeBase } from '@trail/shared';
import { INGEST_MODELS, type IngestModel } from '@trail/shared';
import {
  listKnowledgeBases,
  updateKnowledgeBase,
  getLintStatus,
  getIngestSettings,
  updateIngestSettings,
  type LintStatus,
  type IngestSettingsResponse,
  type IngestBackendId,
  ApiError,
} from '../api';
import { matchKb } from '../lib/kb-cache';
import { t, useLocale } from '../lib/i18n';
import { CenteredLoader } from '../components/centered-loader';
import { Dropdown, type DropdownOption } from '../components/dropdown';

/**
 * Per-Trail settings at `/kb/:kbId/settings`. Home for all configuration
 * that belongs to a single Trail: description, language, lint-policy.
 * Form submits on save; edits don't auto-save so a curator scrolling
 * through doesn't accidentally change anything.
 *
 * Lint-policy ALSO has the inline toggle on the Trails listing — the
 * same field, two surfaces. Dedicated settings page is the canonical
 * home; the listing toggle stays because it's useful to flip without
 * drilling in.
 */
export function SettingsTrailPanel() {
  const route = useRoute();
  const kbId = route.params.kbId ?? '';
  useLocale();
  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState<string>('da');
  const [lintPolicy, setLintPolicy] = useState<'trusting' | 'strict'>('trusting');
  // F160 Phase 2 — per-KB persona overrides for tool/public chat audiences.
  // Empty string in the UI maps to null on save (= "clear back to default").
  const [chatPersonaTool, setChatPersonaTool] = useState('');
  const [chatPersonaPublic, setChatPersonaPublic] = useState('');
  // F176 — per-KB lint cadence in days. null = use global default.
  // The UI dropdown represents null as 'default' (a sentinel), so the
  // form-state stays expressive without a separate "is overridden" flag.
  const [lintScheduleDays, setLintScheduleDays] = useState<number | null>(null);
  const [lintStatus, setLintStatus] = useState<LintStatus | null>(null);
  // F152 — per-KB ingest backend/model. Local form-state vs server value
  // are kept separately so dirty-check is honest. selectedModelKey shape:
  //   ""                 → use env / default chain
  //   "<backend>:<id>"   → per-KB single-step override
  // The full effective-chain (resolveIngestChain output) is rendered as
  // a preview line so curator sees what runs after fallback.
  const [ingestSettings, setIngestSettings] = useState<IngestSettingsResponse | null>(null);
  const [selectedModelKey, setSelectedModelKey] = useState<string>('');
  const [ingestSavePending, setIngestSavePending] = useState(false);

  useEffect(() => {
    listKnowledgeBases()
      .then((list) => {
        // kbId from the route may be a UUID or a slug (F135). Match both
        // so slug-routed URLs don't freeze the panel on a null kb.
        const match = matchKb(list, kbId);
        setKb(match);
        if (match) {
          setName(match.name);
          setDescription(match.description ?? '');
          setLanguage(match.language ?? 'da');
          setLintPolicy(match.lintPolicy ?? 'trusting');
          setChatPersonaTool(match.chatPersonaTool ?? '');
          setChatPersonaPublic(match.chatPersonaPublic ?? '');
          setLintScheduleDays(match.lintScheduleDays ?? null);
          // Fetch the lint-status card asynchronously — failure is
          // non-fatal (the card just stays loading; settings still work).
          getLintStatus(match.id)
            .then((s) => setLintStatus(s))
            .catch(() => setLintStatus(null));
          // F152 — fetch ingest settings + effective chain. Same fail-soft.
          getIngestSettings(match.id)
            .then((s) => {
              setIngestSettings(s);
              if (s.overrides.ingestBackend && s.overrides.ingestModel) {
                setSelectedModelKey(`${s.overrides.ingestBackend}:${s.overrides.ingestModel}`);
              } else {
                setSelectedModelKey('');
              }
            })
            .catch(() => setIngestSettings(null));
        }
      })
      .catch((err: ApiError) => setError(err.message));
  }, [kbId]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const trimmedName = name.trim();
  const nameChanged = kb !== null && trimmedName !== kb.name;
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= 100;
  const dirty =
    kb !== null &&
    (nameChanged ||
      (kb.description ?? '') !== description ||
      (kb.language ?? 'da') !== language ||
      (kb.lintPolicy ?? 'trusting') !== lintPolicy ||
      (kb.chatPersonaTool ?? '') !== chatPersonaTool ||
      (kb.chatPersonaPublic ?? '') !== chatPersonaPublic ||
      (kb.lintScheduleDays ?? null) !== lintScheduleDays);

  const onSave = async () => {
    if (!kb || busy || !dirty || !nameValid) return;
    setBusy(true);
    try {
      const updated = await updateKnowledgeBase(kb.id, {
        ...(nameChanged ? { name: trimmedName } : {}),
        description: description.trim() === '' ? null : description,
        language,
        lintPolicy,
        // Empty string maps to null on the wire = "clear back to default
        // template". Server PATCH treats null + empty equivalently.
        chatPersonaTool: chatPersonaTool.trim() === '' ? null : chatPersonaTool,
        chatPersonaPublic: chatPersonaPublic.trim() === '' ? null : chatPersonaPublic,
        // F176 — null clears the override (use global default).
        lintScheduleDays,
      });
      setKb(updated);
      setToast({ kind: 'success', text: t('settings.savedToast') });
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof Error ? err.message : t('common.error'),
      });
    } finally {
      setBusy(false);
    }
  };

  // F152 — server-side dirty check is implicit (PATCH is idempotent).
  // We just gate the button on form-state vs the last-loaded server
  // value to avoid a no-op round-trip.
  const ingestServerKey = (() => {
    if (!ingestSettings) return '';
    const o = ingestSettings.overrides;
    return o.ingestBackend && o.ingestModel ? `${o.ingestBackend}:${o.ingestModel}` : '';
  })();
  const ingestDirty = ingestSettings !== null && selectedModelKey !== ingestServerKey;

  const onSaveIngestModel = async () => {
    if (!kb || ingestSavePending || !ingestDirty) return;
    setIngestSavePending(true);
    try {
      let body: { ingestBackend: IngestBackendId | null; ingestModel: string | null };
      if (selectedModelKey === '') {
        body = { ingestBackend: null, ingestModel: null };
      } else {
        const [backend, ...rest] = selectedModelKey.split(':');
        body = {
          ingestBackend: backend as IngestBackendId,
          ingestModel: rest.join(':'),
        };
      }
      const updated = await updateIngestSettings(kb.id, body);
      setIngestSettings(updated);
      setToast({ kind: 'success', text: t('settings.savedToast') });
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof Error ? err.message : t('common.error'),
      });
    } finally {
      setIngestSavePending(false);
    }
  };

  if (error) {
    return (
      <div class="page-shell">
        <div class="border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/5 rounded-md p-4 text-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!kb) {
    return (
      <div class="page-shell">
        <CenteredLoader />
      </div>
    );
  }

  return (
    <div class="page-shell">
      <header class="mb-6">
        <h1 class="text-2xl font-semibold tracking-tight mb-1">
          {t('settings.trail.title')}
        </h1>
        <p class="text-[color:var(--color-fg-muted)] text-sm">
          {t('settings.trail.subtitle', { name: kb.name })}
        </p>
      </header>

      <div class="space-y-8 max-w-2xl">
        <section>
          <label class="block mb-2">
            <span class="text-sm font-medium">{t('settings.trail.nameLabel')}</span>
          </label>
          <input
            type="text"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            maxLength={100}
            class={
              'w-full px-3 py-2 rounded-md border bg-transparent text-sm ' +
              (nameValid
                ? 'border-[color:var(--color-border)]'
                : 'border-[color:var(--color-danger)]')
            }
          />
          <p class="mt-1.5 text-[11px] text-[color:var(--color-fg-subtle)]">
            {t('settings.trail.nameHint')}
          </p>
        </section>

        <section>
          <label class="block mb-2">
            <span class="text-sm font-medium">{t('settings.trail.descriptionLabel')}</span>
            <span class="ml-2 text-[11px] text-[color:var(--color-fg-subtle)]">
              {t('common.optional')}
            </span>
          </label>
          <textarea
            value={description}
            onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
            placeholder={t('settings.trail.descriptionPlaceholder')}
            rows={3}
            class="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-sm resize-y"
          />
        </section>

        <section>
          <label class="block mb-2">
            <span class="text-sm font-medium">{t('settings.trail.languageLabel')}</span>
          </label>
          <div
            class="inline-flex items-center rounded-md border border-[color:var(--color-border)] overflow-hidden"
            role="group"
          >
            {(['da', 'en'] as const).map((code) => {
              const active = language === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLanguage(code)}
                  class={
                    'px-3 py-1.5 text-xs font-mono uppercase tracking-wide transition ' +
                    (active
                      ? 'bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]'
                      : 'text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] hover:bg-[color:var(--color-bg-card)]')
                  }
                  aria-pressed={active}
                >
                  {code}
                </button>
              );
            })}
          </div>
          <p class="mt-1.5 text-[11px] text-[color:var(--color-fg-subtle)]">
            {t('settings.trail.languageHint')}
          </p>
        </section>

        <section>
          <label class="block mb-2">
            <span class="text-sm font-medium">{t('kbs.lintPolicy.label')}</span>
          </label>
          <div
            class="inline-flex items-center rounded-md border border-[color:var(--color-border)] overflow-hidden"
            role="group"
          >
            {(['trusting', 'strict'] as const).map((p) => {
              const active = p === lintPolicy;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setLintPolicy(p)}
                  title={t(`kbs.lintPolicy.${p}Hint`)}
                  class={
                    'px-3 py-1.5 text-xs font-mono uppercase tracking-wide transition ' +
                    (active
                      ? 'bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]'
                      : 'text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] hover:bg-[color:var(--color-bg-card)]')
                  }
                  aria-pressed={active}
                >
                  {t(`kbs.lintPolicy.${p}`)}
                </button>
              );
            })}
          </div>
          <p class="mt-1.5 text-[11px] text-[color:var(--color-fg-subtle)] max-w-md">
            {t(`kbs.lintPolicy.${lintPolicy}Hint`)}
          </p>
        </section>

        <section class="pt-2 border-t border-[color:var(--color-border)]">
          <div class="mb-3">
            <h2 class="text-sm font-medium">{t('settings.trail.lintSchedule.title')}</h2>
            <p class="mt-1 text-[11px] text-[color:var(--color-fg-subtle)] max-w-md">
              {t('settings.trail.lintSchedule.subtitle')}
            </p>
          </div>

          <label class="block mb-2">
            <span class="text-sm font-medium">{t('settings.trail.lintSchedule.cadenceLabel')}</span>
          </label>
          {(() => {
            const lintCadenceOptions: DropdownOption[] = [
              {
                value: '',
                label: lintStatus
                  ? `${t('settings.trail.lintSchedule.useDefault')} (${lintStatus.defaultDays}d)`
                  : t('settings.trail.lintSchedule.useDefault'),
              },
              { value: '1', label: t('settings.trail.lintSchedule.daily') },
              { value: '3', label: `3 ${t('settings.trail.lintSchedule.days')}` },
              {
                value: '7',
                label: `7 ${t('settings.trail.lintSchedule.days')}`,
                hint: t('settings.trail.lintSchedule.recommended'),
              },
              { value: '14', label: `14 ${t('settings.trail.lintSchedule.days')}` },
              { value: '30', label: `30 ${t('settings.trail.lintSchedule.days')}` },
              { value: '60', label: `60 ${t('settings.trail.lintSchedule.days')}` },
              { value: '90', label: `90 ${t('settings.trail.lintSchedule.days')}` },
            ];
            return (
              <Dropdown
                value={lintScheduleDays === null ? '' : String(lintScheduleDays)}
                onChange={(v) => setLintScheduleDays(v === '' ? null : Number(v))}
                options={lintCadenceOptions}
                buttonClass="w-[18rem]"
              />
            );
          })()}
          <p class="mt-1.5 text-[11px] text-[color:var(--color-fg-subtle)] max-w-md">
            {t('settings.trail.lintSchedule.hint')}
          </p>

          {/* Status card — last/next/findings, sourced from activity_log */}
          {lintStatus ? (
            <div class="mt-4 grid grid-cols-3 gap-3 max-w-2xl text-[12px]">
              <div class="rounded-md border border-[color:var(--color-border)] p-3">
                <div class="text-[10px] font-mono uppercase tracking-wider text-[color:var(--color-fg-subtle)] mb-1">
                  {t('settings.trail.lintSchedule.lastPass')}
                </div>
                <div class="font-mono">
                  {lintStatus.lastScheduledAt
                    ? formatRelativeFromNow(lintStatus.lastScheduledAt)
                    : t('settings.trail.lintSchedule.never')}
                </div>
              </div>
              <div class="rounded-md border border-[color:var(--color-border)] p-3">
                <div class="text-[10px] font-mono uppercase tracking-wider text-[color:var(--color-fg-subtle)] mb-1">
                  {t('settings.trail.lintSchedule.nextDue')}
                </div>
                <div class="font-mono">{formatNextDue(lintStatus.nextDueAt)}</div>
              </div>
              <div class="rounded-md border border-[color:var(--color-border)] p-3">
                <div class="text-[10px] font-mono uppercase tracking-wider text-[color:var(--color-fg-subtle)] mb-1">
                  {t('settings.trail.lintSchedule.lastFindings')}
                </div>
                <div class="font-mono">
                  {lintStatus.lastFindings === null ? '—' : lintStatus.lastFindings}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* F152 — Ingest model picker. Dropdown over INGEST_MODELS plus
            a "use default" sentinel; preview line shows the full
            fallback chain that resolveIngestChain would produce. Save
            is independent of the global form save because it hits a
            separate PATCH endpoint. */}
        <section class="pt-2 border-t border-[color:var(--color-border)]">
          <div class="mb-3">
            <h2 class="text-sm font-medium">{t('settings.trail.ingestModel.title')}</h2>
            <p class="mt-1 text-[11px] text-[color:var(--color-fg-subtle)] max-w-md">
              {t('settings.trail.ingestModel.subtitle')}
            </p>
          </div>

          <label class="block mb-2">
            <span class="text-sm font-medium">{t('settings.trail.ingestModel.modelLabel')}</span>
          </label>
          {(() => {
            const modelOptions: DropdownOption[] = [
              { value: '', label: t('settings.trail.ingestModel.useDefault') },
              ...INGEST_MODELS.map((m: IngestModel): DropdownOption => {
                const cost =
                  m.costPerMillion.input === 0 && m.costPerMillion.output === 0
                    ? t('settings.trail.ingestModel.maxPlanFree')
                    : `$${m.costPerMillion.input.toFixed(2)} in / $${m.costPerMillion.output.toFixed(2)} out per 1M`;
                return {
                  value: `${m.backend}:${m.id}`,
                  label: m.label,
                  hint: cost,
                };
              }),
            ];
            return (
              <Dropdown
                value={selectedModelKey}
                onChange={setSelectedModelKey}
                options={modelOptions}
                buttonClass="w-[28rem]"
                menuClass="w-[28rem]"
              />
            );
          })()}

          {ingestSettings ? (
            <p class="mt-2 text-[11px] font-mono text-[color:var(--color-fg-subtle)] max-w-2xl">
              <span class="uppercase tracking-wider mr-2">
                {t('settings.trail.ingestModel.fallbackPrefix')}
              </span>
              {ingestSettings.effectiveChain
                .map((step) => {
                  const found = INGEST_MODELS.find(
                    (m) => m.backend === step.backend && m.id === step.model,
                  );
                  return found ? found.label : `${step.backend}:${step.model}`;
                })
                .join(' → ')}
            </p>
          ) : null}

          <div class="mt-3">
            <button
              type="button"
              onClick={onSaveIngestModel}
              disabled={!ingestDirty || ingestSavePending}
              class="px-3 py-1.5 text-sm rounded-md border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 hover:bg-[color:var(--color-accent)]/20 disabled:opacity-40 disabled:cursor-not-allowed active:bg-[color:var(--color-accent)]/30 transition"
            >
              {ingestSavePending
                ? t('settings.trail.ingestModel.saving')
                : t('settings.trail.ingestModel.save')}
            </button>
          </div>

          <p class="mt-2 text-[11px] text-[color:var(--color-fg-subtle)] max-w-md">
            {t('settings.trail.ingestModel.hint')}
          </p>
        </section>

        <section class="pt-2 border-t border-[color:var(--color-border)]">
          <div class="mb-3">
            <h2 class="text-sm font-medium">{t('settings.trail.personas.title')}</h2>
            <p class="mt-1 text-[11px] text-[color:var(--color-fg-subtle)] max-w-md">
              {t('settings.trail.personas.subtitle')}
            </p>
          </div>

          <label class="block mb-2">
            <span class="text-sm font-medium">{t('settings.trail.personas.toolLabel')}</span>
            <span class="ml-2 text-[11px] font-mono uppercase tracking-wider text-[color:var(--color-fg-subtle)]">
              audience: tool
            </span>
          </label>
          <textarea
            value={chatPersonaTool}
            onInput={(e) => setChatPersonaTool((e.target as HTMLTextAreaElement).value)}
            placeholder={t('settings.trail.personas.toolPlaceholder')}
            maxLength={4000}
            rows={4}
            class="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-sm font-mono leading-relaxed resize-y focus:outline-none focus:border-[color:var(--color-accent)] transition"
          />
          <p class="mt-1 mb-4 text-[11px] text-[color:var(--color-fg-subtle)]">
            {t('settings.trail.personas.toolHint')}
          </p>

          <label class="block mb-2">
            <span class="text-sm font-medium">{t('settings.trail.personas.publicLabel')}</span>
            <span class="ml-2 text-[11px] font-mono uppercase tracking-wider text-[color:var(--color-fg-subtle)]">
              audience: public
            </span>
          </label>
          <textarea
            value={chatPersonaPublic}
            onInput={(e) => setChatPersonaPublic((e.target as HTMLTextAreaElement).value)}
            placeholder={t('settings.trail.personas.publicPlaceholder')}
            maxLength={4000}
            rows={5}
            class="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-sm font-mono leading-relaxed resize-y focus:outline-none focus:border-[color:var(--color-accent)] transition"
          />
          <p class="mt-1 text-[11px] text-[color:var(--color-fg-subtle)]">
            {t('settings.trail.personas.publicHint')}
          </p>
        </section>

        <div class="pt-4 border-t border-[color:var(--color-border)]">
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!dirty || busy}
            class="px-4 py-2 rounded-md bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)] text-sm font-medium disabled:opacity-50 transition"
          >
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>

      {toast ? (
        <div
          class={
            'fixed bottom-6 right-6 z-40 px-4 py-3 rounded-md border text-sm shadow-lg ' +
            (toast.kind === 'success'
              ? 'border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10'
              : 'border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10')
          }
        >
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact relative-time formatter for past events — "5h ago", "2d ago".
 * Used for lastPass which is always in the past once it has fired.
 */
function formatRelativeFromNow(iso: string): string {
  const ms = parseToMs(iso);
  if (ms === null) return iso;
  return relativeAgo(ms);
}

/**
 * Specialised formatter for the "Next due" cell. nextDueAt sits in the
 * past when the KB is overdue (scheduler tick will pick it up at the
 * next interval), in the future when waiting. "5d ago" reads like a
 * past event the user missed; "Forfalden 5d" makes it clear that an
 * action is pending. "Soon" handles the just-tipped-overdue minute.
 */
function formatNextDue(iso: string): string {
  const ms = parseToMs(iso);
  if (ms === null) return iso;
  const deltaSec = Math.round((ms - Date.now()) / 1000);
  if (deltaSec >= 0) {
    if (deltaSec < 60) return 'soon';
    return `in ${magnitude(deltaSec)}`;
  }
  // overdue
  const abs = -deltaSec;
  if (abs < 60) return 'now';
  return `overdue ${magnitude(abs)}`;
}

function parseToMs(iso: string): number | null {
  const norm = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const t = Date.parse(norm);
  return Number.isFinite(t) ? t : null;
}

function relativeAgo(ms: number): string {
  const deltaSec = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  const suffix = deltaSec < 0 ? ' ago' : '';
  const prefix = deltaSec >= 0 ? 'in ' : '';
  return `${prefix}${magnitude(abs)}${suffix}`;
}

function magnitude(absSec: number): string {
  if (absSec < 60) return `${absSec}s`;
  if (absSec < 3600) return `${Math.round(absSec / 60)}m`;
  if (absSec < 86_400) return `${Math.round(absSec / 3600)}h`;
  return `${Math.round(absSec / 86_400)}d`;
}
