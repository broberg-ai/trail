import { useEffect, useState } from 'preact/hooks';
import { Modal, ModalButton } from '../components/modal';
import { useRoute } from 'preact-iso';
import type { KnowledgeBase } from '@trail/shared';
import {
  INGEST_MODELS,
  CHAT_MODELS,
  KB_NAME_MAX,
  KB_DESCRIPTION_MAX,
  KB_PERSONA_MAX,
  type IngestModel,
  type ChatModel,
} from '@trail/shared';
import {
  listKnowledgeBases,
  updateKnowledgeBase,
  getLintStatus,
  getIngestSettings,
  updateIngestSettings,
  getChatSettings,
  updateChatSettings,
  getMemoryHealth,
  setKbDecayEnabled,
  getLintSettings,
  setKbContradictionLint,
  type LintStatus,
  type IngestSettingsResponse,
  type IngestBackendId,
  type ChatSettingsResponse,
  ApiError,
} from '../api';
import { matchKb } from '../lib/kb-cache';
import { t, useLocale } from '../lib/i18n';
import { CenteredLoader } from '../components/centered-loader';
import { Dropdown, type DropdownOption } from '../components/dropdown';
import { modelPricing, pricesGeneratedAt } from '@trail/shared';

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

/**
 * F228 — the cost note under a model in the picker.
 *
 * THREE outcomes, and keeping them apart is the point:
 *   free route   -> no note at all (a $0 line reads as a price, not as free)
 *   known price  -> the SDK's current number
 *   UNKNOWN      -> says so. Never a leftover literal, never $0.00.
 *
 * The old table showed a number for everything, which is why it could be four
 * months stale on Mistral Large without anyone noticing.
 */
function priceHint(id: string): string | undefined {
  const p = modelPricing(id);
  if (!p) return t('settings.trail.priceUnknown');
  if (p.inputPer1M === 0 && p.outputPer1M === 0) return undefined;
  return `$${p.inputPer1M.toFixed(2)} in / $${p.outputPer1M.toFixed(2)} out per 1M`;
}

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
  // F226 — minimum image size for this Trail. '' means no filter, which is
  // what every Trail did before the setting existed.
  const [minImagePx, setMinImagePx] = useState<string>('');
  const [minImageSaving, setMinImageSaving] = useState(false);
  // F160 Phase 2 — per-KB persona overrides for tool/public chat audiences.
  // Empty string in the UI maps to null on save (= "clear back to default").
  const [chatPersonaTool, setChatPersonaTool] = useState('');
  const [chatPersonaPublic, setChatPersonaPublic] = useState('');
  // F176 — per-KB lint cadence in days. null = use global default.
  // The UI dropdown represents null as 'default' (a sentinel), so the
  // form-state stays expressive without a separate "is overridden" flag.
  const [lintScheduleDays, setLintScheduleDays] = useState<number | null>(null);
  const [lintStatus, setLintStatus] = useState<LintStatus | null>(null);
  // F201.8 — per-KB ambient auto-approval. null threshold = off; "on" maps to 0.5.
  const [autoApproveOn, setAutoApproveOn] = useState<boolean | null>(null);
  const [autoApproveToggling, setAutoApproveToggling] = useState(false);
  // F152 — per-KB ingest backend/model. Local form-state vs server value
  // are kept separately so dirty-check is honest. selectedModelKey shape:
  //   ""                 → use env / default chain
  //   "<backend>:<id>"   → per-KB single-step override
  // The full effective-chain (resolveIngestChain output) is rendered as
  // a preview line so curator sees what runs after fallback.
  const [ingestSettings, setIngestSettings] = useState<IngestSettingsResponse | null>(null);
  const [selectedModelKey, setSelectedModelKey] = useState<string>('');
  const [ingestSavePending, setIngestSavePending] = useState(false);
  // F159 — per-KB chat backend/model. Same shape as F152 ingest-settings.
  const [chatSettings, setChatSettings] = useState<ChatSettingsResponse | null>(null);
  const [selectedChatModelKey, setSelectedChatModelKey] = useState<string>('');
  const [chatSavePending, setChatSavePending] = useState(false);

  // F195 — per-Trail memory-decay on/off (also surfaced on the Sundhed page).
  const [decayEnabled, setDecayEnabled] = useState<boolean | null>(null);
  const [decayToggling, setDecayToggling] = useState(false);

  // F200.1 — per-Trail contradiction-lint on/off (root-cause throttle for
  // high-volume session KBs flooding the queue with alert candidates).
  const [lintEnabled, setLintEnabled] = useState<boolean | null>(null);
  const [lintToggling, setLintToggling] = useState(false);

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
          setMinImagePx(
            (match as { minImagePx?: number | null }).minImagePx == null
              ? ''
              : String((match as { minImagePx?: number | null }).minImagePx),
          );
          setChatPersonaTool(match.chatPersonaTool ?? '');
          setChatPersonaPublic(match.chatPersonaPublic ?? '');
          setLintScheduleDays(match.lintScheduleDays ?? null);
          // F201.8 — ambient auto-approve is "on" whenever a threshold is set.
          setAutoApproveOn((match.autoApproveThreshold ?? null) !== null);
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
          // F159 — fetch chat settings + effective chain. Same fail-soft.
          getChatSettings(match.id)
            .then((s) => {
              setChatSettings(s);
              if (s.overrides.chatBackend && s.overrides.chatModel) {
                setSelectedChatModelKey(`${s.overrides.chatBackend}:${s.overrides.chatModel}`);
              } else {
                setSelectedChatModelKey('');
              }
            })
            .catch(() => setChatSettings(null));
          // F195 — memory-decay on/off for this Trail. Fail-soft.
          getMemoryHealth(match.id)
            .then((d) => setDecayEnabled(d.decayEnabled ?? false))
            .catch(() => setDecayEnabled(null));
          // F200.1 — contradiction-lint on/off for this Trail. Fail-soft.
          getLintSettings(match.id)
            .then((s) => setLintEnabled(s.contradictionLintEnabled))
            .catch(() => setLintEnabled(null));
        }
      })
      .catch((err: ApiError) => setError(err.message));
  }, [kbId]);

  async function handleToggleDecay() {
    if (!kb || decayToggling || decayEnabled === null) return;
    setDecayToggling(true);
    try {
      const r = await setKbDecayEnabled(kb.id, !decayEnabled);
      setDecayEnabled(r.decayEnabled);
      setToast({ kind: 'success', text: t('settings.trail.decay.saved') });
    } catch {
      setToast({ kind: 'error', text: t('settings.trail.decay.error') });
    } finally {
      setDecayToggling(false);
    }
  }

  async function handleToggleLint() {
    if (!kb || lintToggling || lintEnabled === null) return;
    setLintToggling(true);
    try {
      const r = await setKbContradictionLint(kb.id, !lintEnabled);
      setLintEnabled(r.contradictionLintEnabled);
      setToast({ kind: 'success', text: t('settings.trail.lintToggle.saved') });
    } catch {
      setToast({ kind: 'error', text: t('settings.trail.lintToggle.error') });
    } finally {
      setLintToggling(false);
    }
  }

  // F201.12 — Ambient-tilstand: one toggle that makes a KB self-managing. "On"
  // bundles the two settings that a hands-off ambient KB needs, so the user
  // never wires them separately:
  //   • auto-approve armed at 0.5 (F201.8) — distilled knowledge (0.8)
  //     auto-approves; distilled noise auto-rejects out of Pending (F201.12
  //     backend); and
  //   • contradiction-lint OFF (F200.1) — near-duplicate ambient Neurons would
  //     otherwise flood the queue with contradiction candidates.
  // "Off" reverses both (threshold null, lint on). Net effect when on: the
  // Pending queue stays empty with zero human triage.
  async function handleToggleAmbientMode() {
    if (!kb || autoApproveToggling || autoApproveOn === null) return;
    setAutoApproveToggling(true);
    try {
      const next = !autoApproveOn;
      // Both writes, in one action. Auto-approve first: if the lint write fails
      // the KB is still in a coherent "approve on, lint on" state rather than a
      // half-applied ambient mode.
      await updateKnowledgeBase(kb.id, { autoApproveThreshold: next ? 0.5 : null });
      const lint = await setKbContradictionLint(kb.id, !next);
      setAutoApproveOn(next);
      setLintEnabled(lint.contradictionLintEnabled);
      setToast({ kind: 'success', text: t('settings.trail.ambientMode.saved') });
    } catch {
      setToast({ kind: 'error', text: t('settings.trail.ambientMode.error') });
    } finally {
      setAutoApproveToggling(false);
    }
  }

  // F226 — save the minimum image size. Empty clears it back to "no filter";
  // that path has its own test because a field that can only ever be SET looks
  // identical to one that saves correctly until someone tries to clear it.
  async function handleSaveMinImagePx() {
    if (!kb || minImageSaving) return;
    const raw = minImagePx.trim();
    const value = raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setToast({ kind: 'error', text: t('settings.trail.minImage.invalid') });
      return;
    }
    setMinImageSaving(true);
    try {
      await updateKnowledgeBase(kb.id, { minImagePx: value });
      setToast({ kind: 'success', text: t('settings.trail.minImage.saved') });
    } catch {
      setToast({ kind: 'error', text: t('settings.trail.minImage.error') });
    } finally {
      setMinImageSaving(false);
    }
  }

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

  // F159 — same shape as ingestServerKey/ingestDirty/onSaveIngestModel,
  // applied to the chat backend/model fields. PATCH endpoint is
  // /chat-settings; the rest is identical.
  const chatServerKey = (() => {
    if (!chatSettings) return '';
    const o = chatSettings.overrides;
    return o.chatBackend && o.chatModel ? `${o.chatBackend}:${o.chatModel}` : '';
  })();
  const chatDirty = chatSettings !== null && selectedChatModelKey !== chatServerKey;

  const onSaveChatModel = async () => {
    if (!kb || chatSavePending || !chatDirty) return;
    setChatSavePending(true);
    try {
      let body: { chatBackend: import('@trail/shared').ChatBackendId | null; chatModel: string | null };
      if (selectedChatModelKey === '') {
        body = { chatBackend: null, chatModel: null };
      } else {
        const [backend, ...rest] = selectedChatModelKey.split(':');
        body = {
          chatBackend: backend as import('@trail/shared').ChatBackendId,
          chatModel: rest.join(':'),
        };
      }
      const updated = await updateChatSettings(kb.id, body);
      setChatSettings(updated);
      setToast({ kind: 'success', text: t('settings.savedToast') });
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof Error ? err.message : t('common.error'),
      });
    } finally {
      setChatSavePending(false);
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
    <div class="page-shell" data-testid="settings-root">
      <header class="mb-6">
        <h1 style="font-family: var(--font-serif); font-weight: 400; font-size: 32px; letter-spacing: -0.015em; line-height: 1.15; margin: 0 0 6px;">
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
            data-testid="settings-name-input"
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            maxLength={KB_NAME_MAX}
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
            data-testid="settings-description-input"
            onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
            placeholder={t('settings.trail.descriptionPlaceholder')}
            maxLength={KB_DESCRIPTION_MAX}
            rows={3}
            class="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-sm resize-y"
          />
          <p
            data-testid="settings-description-count"
            class="mt-1 text-[11px] text-right text-[color:var(--color-fg-subtle)]"
          >
            {description.length} / {KB_DESCRIPTION_MAX}
          </p>
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

        {/* F195 — per-Trail memory-decay toggle (mirrors the Sundhed banner). */}
        <section class="pt-2 border-t border-[color:var(--color-border)]">
          <div class="mb-3">
            <h2 class="text-sm font-medium">{t('settings.trail.decay.title')}</h2>
            <p class="mt-1 text-[11px] text-[color:var(--color-fg-subtle)] max-w-xl">
              {t('settings.trail.decay.subtitle')}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: '4px 10px',
                borderRadius: 999,
                background: decayEnabled ? 'var(--color-bg-sunk)' : 'var(--color-accent-soft)',
                color: 'var(--color-fg)',
              }}
            >
              {decayEnabled === null
                ? '…'
                : decayEnabled
                  ? t('settings.trail.decay.stateActive')
                  : t('settings.trail.decay.statePaused')}
            </span>
            {decayEnabled !== null ? (
              <button
                type="button"
                onClick={handleToggleDecay}
                disabled={decayToggling}
                class="btn active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ padding: '6px 14px', fontSize: 12.5 }}
              >
                {decayToggling
                  ? t('lifecycle.decaySaving')
                  : decayEnabled
                    ? t('lifecycle.decayPause')
                    : t('lifecycle.decayEnable')}
              </button>
            ) : null}
          </div>
        </section>

        {/* F226 — per-Trail minimum image size. Measured on Sanne's Trail: a
            third of all image rows are bullets and rules lifted out of PDFs,
            costing 0,03% of the bytes but a vision description each. */}
        <section class="pt-2 border-t border-[color:var(--color-border)]" data-testid="settings-min-image-section">
          <div class="mb-3">
            <h2 class="text-sm font-medium">{t('settings.trail.minImage.title')}</h2>
            <p class="mt-1 text-[11px] text-[color:var(--color-fg-subtle)] max-w-xl">
              {t('settings.trail.minImage.subtitle')}
            </p>
          </div>
          <div class="flex items-center gap-3">
            <input
              type="number"
              min="0"
              step="1"
              placeholder={t('settings.trail.minImage.placeholder')}
              value={minImagePx}
              data-testid="settings-min-image-input"
              onInput={(e) => setMinImagePx((e.currentTarget as HTMLInputElement).value)}
              class="w-28 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] px-2 py-1.5 text-sm"
            />
            <span class="text-[11px] text-[color:var(--color-fg-subtle)]">px</span>
            <button
              type="button"
              data-testid="settings-min-image-save"
              disabled={minImageSaving}
              onClick={handleSaveMinImagePx}
              class="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-sm transition-colors hover:border-[color:var(--color-border-strong)] active:translate-y-px disabled:opacity-50"
            >
              {minImageSaving ? t('common.saving') : t('common.save')}
            </button>
          </div>
          <p class="mt-2 text-[11px] text-[color:var(--color-fg-subtle)] max-w-xl">
            {t('settings.trail.minImage.hint')}
          </p>
        </section>

        {/* F200.1 — per-Trail contradiction-lint toggle (mirrors the decay toggle above). */}
        <section class="pt-2 border-t border-[color:var(--color-border)]">
          <div class="mb-3">
            <h2 class="text-sm font-medium">{t('settings.trail.lintToggle.title')}</h2>
            <p class="mt-1 text-[11px] text-[color:var(--color-fg-subtle)] max-w-xl">
              {t('settings.trail.lintToggle.subtitle')}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              data-testid="settings-lint-toggle-state"
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: '4px 10px',
                borderRadius: 999,
                background: lintEnabled ? 'var(--color-bg-sunk)' : 'var(--color-accent-soft)',
                color: 'var(--color-fg)',
              }}
            >
              {lintEnabled === null
                ? '…'
                : lintEnabled
                  ? t('settings.trail.lintToggle.stateOn')
                  : t('settings.trail.lintToggle.stateOff')}
            </span>
            {lintEnabled !== null ? (
              <button
                type="button"
                data-testid="settings-lint-toggle"
                onClick={handleToggleLint}
                disabled={lintToggling}
                class="btn active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ padding: '6px 14px', fontSize: 12.5 }}
              >
                {lintToggling
                  ? t('settings.trail.lintToggle.saving')
                  : lintEnabled
                    ? t('settings.trail.lintToggle.turnOff')
                    : t('settings.trail.lintToggle.turnOn')}
              </button>
            ) : null}
          </div>
        </section>

        {/* F201.12 — Ambient-tilstand: one toggle bundling auto-approve (F201.8)
            + contradiction-lint-off (F200.1) so an ambient KB self-manages. */}
        <section class="pt-2 border-t border-[color:var(--color-border)]">
          <div class="mb-3">
            <h2 class="text-sm font-medium">{t('settings.trail.ambientMode.title')}</h2>
            <p class="mt-1 text-[11px] text-[color:var(--color-fg-subtle)] max-w-xl">
              {t('settings.trail.ambientMode.subtitle')}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              data-testid="settings-ambient-mode-state"
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: '4px 10px',
                borderRadius: 999,
                background: autoApproveOn ? 'var(--color-accent-soft)' : 'var(--color-bg-sunk)',
                color: 'var(--color-fg)',
              }}
            >
              {autoApproveOn === null
                ? '…'
                : autoApproveOn
                  ? t('settings.trail.ambientMode.stateOn')
                  : t('settings.trail.ambientMode.stateOff')}
            </span>
            {autoApproveOn !== null ? (
              <button
                type="button"
                data-testid="settings-ambient-mode-toggle"
                onClick={handleToggleAmbientMode}
                disabled={autoApproveToggling}
                class="btn active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ padding: '6px 14px', fontSize: 12.5 }}
              >
                {autoApproveToggling
                  ? t('settings.trail.ambientMode.saving')
                  : autoApproveOn
                    ? t('settings.trail.ambientMode.turnOff')
                    : t('settings.trail.ambientMode.turnOn')}
              </button>
            ) : null}
          </div>
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
            // Show WHICH model "use default" resolves to — the first step of the
            // effective fallback chain — in both the closed select and the list.
            const firstStep = ingestSettings?.effectiveChain?.[0];
            const defaultLabel = firstStep
              ? INGEST_MODELS.find((m) => m.backend === firstStep.backend && m.id === firstStep.model)?.label
                  ?? `${firstStep.backend}:${firstStep.model}`
              : null;
            const modelOptions: DropdownOption[] = [
              {
                value: '',
                label: defaultLabel
                  ? `${t('settings.trail.ingestModel.useDefault')} (${defaultLabel})`
                  : t('settings.trail.ingestModel.useDefault'),
              },
              ...INGEST_MODELS.map((m: IngestModel): DropdownOption => {
                // F228 — the price comes from @broberg/ai-sdk, not from a table
                // here. Three outcomes, deliberately distinct: free route shows
                // nothing, a known price shows the number, and an UNKNOWN price
                // says so rather than degrading into a confident figure.
                return {
                  value: `${m.backend}:${m.id}`,
                  label: m.label,
                  hint: priceHint(m.id),
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
              data-testid="settings-save-ingest"
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

        {/* F159 — Per-KB chat backend/model picker. Mirrors F152's
            ingest-model section verbatim; PATCH endpoint is
            /chat-settings instead of /ingest-settings. */}
        <section class="pt-2 border-t border-[color:var(--color-border)]">
          <div class="mb-3">
            <h2 class="text-sm font-medium">{t('settings.trail.chatModel.title')}</h2>
            <p class="mt-1 text-[11px] text-[color:var(--color-fg-subtle)] max-w-md">
              {t('settings.trail.chatModel.subtitle')}
            </p>
          </div>

          <label class="block mb-2">
            <span class="text-sm font-medium">{t('settings.trail.chatModel.modelLabel')}</span>
          </label>
          {(() => {
            const firstStep = chatSettings?.effectiveChain?.[0];
            const defaultLabel = firstStep
              ? CHAT_MODELS.find((m) => m.backend === firstStep.backend && m.id === firstStep.model)?.label
                  ?? `${firstStep.backend}:${firstStep.model}`
              : null;
            const modelOptions: DropdownOption[] = [
              {
                value: '',
                label: defaultLabel
                  ? `${t('settings.trail.chatModel.useDefault')} (${defaultLabel})`
                  : t('settings.trail.chatModel.useDefault'),
              },
              ...CHAT_MODELS.map((m: ChatModel): DropdownOption => {
                return {
                  value: `${m.backend}:${m.id}`,
                  label: m.label,
                  hint: priceHint(m.id),
                };
              }),
            ];
            return (
              <Dropdown
                value={selectedChatModelKey}
                onChange={setSelectedChatModelKey}
                options={modelOptions}
                buttonClass="w-[28rem]"
                menuClass="w-[28rem]"
              />
            );
          })()}

          {chatSettings ? (
            <p class="mt-2 text-[11px] font-mono text-[color:var(--color-fg-subtle)] max-w-2xl">
              <span class="uppercase tracking-wider mr-2">
                {t('settings.trail.chatModel.fallbackPrefix')}
              </span>
              {chatSettings.effectiveChain
                .map((step) => {
                  const found = CHAT_MODELS.find(
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
              data-testid="settings-save-chat"
              onClick={onSaveChatModel}
              disabled={!chatDirty || chatSavePending}
              class="px-3 py-1.5 text-sm rounded-md border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 hover:bg-[color:var(--color-accent)]/20 disabled:opacity-40 disabled:cursor-not-allowed active:bg-[color:var(--color-accent)]/30 transition"
            >
              {chatSavePending
                ? t('settings.trail.chatModel.saving')
                : t('settings.trail.chatModel.save')}
            </button>
          </div>

          <p class="mt-2 text-[11px] text-[color:var(--color-fg-subtle)] max-w-md">
            {t('settings.trail.chatModel.hint')}
          </p>
        </section>

        <section class="pt-2 border-t border-[color:var(--color-border)]">
          <div class="mb-3">
            <h2 class="text-sm font-medium">{t('settings.trail.personas.title')}</h2>
            <p class="mt-1 text-[11px] text-[color:var(--color-fg-subtle)] max-w-md">
              {t('settings.trail.personas.subtitle')}
            </p>
          </div>

          <PersonaEditor
            label={t('settings.trail.personas.toolLabel')}
            audience="tool"
            value={chatPersonaTool}
            onChange={setChatPersonaTool}
            placeholder={t('settings.trail.personas.toolPlaceholder')}
            hint={t('settings.trail.personas.toolHint')}
          />

          <PersonaEditor
            label={t('settings.trail.personas.publicLabel')}
            audience="public"
            value={chatPersonaPublic}
            onChange={setChatPersonaPublic}
            placeholder={t('settings.trail.personas.publicPlaceholder')}
            hint={t('settings.trail.personas.publicHint')}
          />
        </section>

        <div class="pt-4 border-t border-[color:var(--color-border)]">
          <button
            type="button"
            data-testid="settings-save"
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

/**
 * F186 follow-up — persona editor with inline + full-screen modes.
 * The inline textarea shows 12 rows by default so most personas fit
 * without scrolling (Christian: "skal være store nok til at vise mindst
 * 80% af indholdet"). An expand button opens the same content in a
 * fullscreen modal where the whole persona can be edited without
 * scroll-juggling against the rest of the form.
 */
function PersonaEditor({
  label,
  audience,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  audience: 'tool' | 'public';
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(value);
  // Keep the modal in sync if the underlying value changes while closed
  useEffect(() => {
    if (!expanded) setDraft(value);
  }, [value, expanded]);

  return (
    <div class="mb-6">
      <div class="flex items-center justify-between mb-2">
        <label class="block">
          <span class="text-sm font-medium">{label}</span>
          <span class="ml-2 text-[11px] font-mono uppercase tracking-wider text-[color:var(--color-fg-subtle)]">
            audience: {audience}
          </span>
        </label>
        <button
          type="button"
          onClick={() => { setDraft(value); setExpanded(true); }}
          class="text-[11px] font-mono uppercase tracking-wider text-[color:var(--color-fg-subtle)] hover:text-[color:var(--color-fg)] transition inline-flex items-center gap-1"
          title={t('common.expand') === 'common.expand' ? 'Expand' : t('common.expand')}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
          <span>{t('common.expand') === 'common.expand' ? 'Expand' : t('common.expand')}</span>
        </button>
      </div>
      <textarea
        value={value}
        onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
        placeholder={placeholder}
        maxLength={KB_PERSONA_MAX}
        rows={12}
        class="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-sm font-mono leading-relaxed resize-y focus:outline-none focus:border-[color:var(--color-accent)] transition"
      />
      <p class="mt-1 text-[11px] text-[color:var(--color-fg-subtle)]">{hint}</p>

      <Modal
        open={expanded}
        onClose={() => setExpanded(false)}
        title={label}
        maxWidth="lg"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <ModalButton onClick={() => setExpanded(false)} variant="secondary">
              {t('common.cancel') === 'common.cancel' ? 'Cancel' : t('common.cancel')}
            </ModalButton>
            <ModalButton onClick={() => { onChange(draft); setExpanded(false); }} variant="primary">
              {t('common.save') === 'common.save' ? 'Save' : t('common.save')}
            </ModalButton>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: 'calc(85vh - 200px)' }}>
          <textarea
            autoFocus
            value={draft}
            onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
            placeholder={placeholder}
            maxLength={KB_PERSONA_MAX}
            class="w-full px-3 py-2 rounded-md border border-[color:var(--color-border)] bg-transparent text-sm font-mono leading-relaxed focus:outline-none focus:border-[color:var(--color-accent)] transition"
            style={{ flex: 1, resize: 'none' }}
          />
          <p class="text-[11px] text-[color:var(--color-fg-subtle)]">{hint}</p>
        </div>
      </Modal>
    </div>
  );
}
