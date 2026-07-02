import { useEffect, useMemo, useState } from 'preact/hooks';
import { approveAmbientDevice, listKnowledgeBases } from '../api';
import type { KnowledgeBase } from '@trail/shared';
import { t } from '../lib/i18n';

/**
 * F201.2 — Ambient device-approval page.
 *
 * The Trail Ambient macOS agent opens the browser at
 * /ambient/connect?code=<64hex>&name=<mac-name>. The signed-in user picks
 * which Trails (KBs) the device may write captures into and approves —
 * the engine mints an 'ambient'-scoped API key and the agent claims it by
 * polling POST /api/v1/ambient/token. No token is ever shown or pasted.
 *
 * KB selection uses custom checkbox-rows (house rule: no native controls).
 */
export function AmbientConnectPanel() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get('code') ?? '').trim().toLowerCase();
  const deviceName = (params.get('name') ?? '').trim() || 'Ukendt Mac';
  const codeValid = /^[0-9a-f]{64}$/.test(code);

  const [kbs, setKbs] = useState<KnowledgeBase[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<'pick' | 'saving' | 'done' | 'denied'>('pick');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listKnowledgeBases()
      .then(setKbs)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canApprove = useMemo(
    () => codeValid && selected.size > 0 && phase === 'pick',
    [codeValid, selected, phase],
  );

  const approve = async () => {
    if (!canApprove) return;
    setPhase('saving');
    setError(null);
    try {
      await approveAmbientDevice({ code, deviceName, kbIds: [...selected] });
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('pick');
    }
  };

  return (
    <div data-testid="ambient-connect-root" style={{ padding: '64px 28px', maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 28, letterSpacing: '-0.015em' }}>
        {t('ambient.connect.title')}
      </h1>

      {!codeValid ? (
        <p data-testid="ambient-connect-invalid" style={{ marginTop: 14, fontSize: 14, color: 'var(--color-fg-muted)' }}>
          {t('ambient.connect.invalidCode')}
        </p>
      ) : phase === 'done' ? (
        <div data-testid="ambient-connect-success" style={{ marginTop: 18 }}>
          <p style={{ fontSize: 14, lineHeight: 1.65 }}>
            {t('ambient.connect.success', { device: deviceName })}
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>
            {t('ambient.connect.successHint')}
          </p>
        </div>
      ) : phase === 'denied' ? (
        <p data-testid="ambient-connect-denied" style={{ marginTop: 14, fontSize: 14, color: 'var(--color-fg-muted)' }}>
          {t('ambient.connect.deniedNote')}
        </p>
      ) : (
        <>
          <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.65, color: 'var(--color-fg-muted)' }}>
            {t('ambient.connect.intro')}
          </p>
          <div
            data-testid="ambient-connect-device-name"
            style={{
              marginTop: 10, display: 'inline-block', padding: '6px 12px', borderRadius: 8,
              border: '1px solid var(--color-border)', background: 'var(--color-bg-card)',
              fontFamily: 'var(--font-mono)', fontSize: 13,
            }}
          >
            {deviceName}
          </div>

          <h2 style={{ marginTop: 26, fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-fg-muted)' }}>
            {t('ambient.connect.pickKbs')}
          </h2>
          {!kbs ? (
            <p style={{ fontSize: 13, color: 'var(--color-fg-subtle)' }}>…</p>
          ) : kbs.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-fg-subtle)' }}>{t('ambient.connect.noKbs')}</p>
          ) : (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {kbs.map((kb) => {
                const on = selected.has(kb.id);
                return (
                  <button
                    key={kb.id}
                    type="button"
                    data-testid={`ambient-connect-kb-${kb.slug}`}
                    aria-pressed={on}
                    onClick={() => toggle(kb.id)}
                    class="active:scale-[0.99] transition"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                      padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: on ? 'var(--color-accent-soft)' : 'var(--color-bg-card)',
                      color: 'var(--color-fg)',
                    }}
                  >
                    <span
                      style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                        background: on ? 'var(--color-accent)' : 'transparent',
                        fontSize: 11, color: 'var(--color-bg)',
                      }}
                    >
                      {on ? '✓' : ''}
                    </span>
                    <span style={{ fontSize: 14 }}>{kb.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-fg-subtle)', fontFamily: 'var(--font-mono)' }}>{kb.slug}</span>
                  </button>
                );
              })}
            </div>
          )}

          {error ? (
            <p data-testid="ambient-connect-error" style={{ marginTop: 14, fontSize: 13, color: 'var(--color-danger, #e5484d)' }}>
              {error}
            </p>
          ) : null}

          <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
            <button
              type="button"
              data-testid="ambient-connect-approve"
              onClick={approve}
              disabled={!canApprove}
              class="btn btn-primary active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ padding: '8px 18px', fontSize: 13 }}
            >
              {phase === 'saving' ? t('ambient.connect.approving') : t('ambient.connect.approve')}
            </button>
            <button
              type="button"
              data-testid="ambient-connect-deny"
              onClick={() => setPhase('denied')}
              disabled={phase !== 'pick'}
              class="btn active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ padding: '8px 18px', fontSize: 13 }}
            >
              {t('ambient.connect.deny')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
