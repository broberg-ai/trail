import { useState } from 'preact/hooks';
import { useEffect } from 'preact/hooks';
import { usePwaUpdate, PwaUpdateBanner } from '@broberg/pwa/preact';
import { t } from '../lib/i18n';

/**
 * F247.2 — «Ny version»-toasten, drevet af @broberg/pwa (flådens primitiv,
 * konsument #4 — aldrig kopi #5). Registrerer /sw.js og lytter efter en
 * ventende worker; brugeren vælger selv hvornår der opdateres. Banner-
 * skelettet kommer med testids (pwa-update-confirm/dismiss/close) og
 * role=status — vi lægger kun husets tokens på via klassen.
 *
 * Kill-switch (ship-dark): svarer /api/health med { sw: "off" } afregistreres
 * service-workeren ved næste load — vejen ud hvis en SW-udgave nogensinde
 * opfører sig skidt i marken. Feltet findes ikke i dag; fravær = tændt.
 */
export function PwaUpdate() {
  const [dismissed, setDismissed] = useState(false);
  const disabled = !import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator);
  const { updateReady, applyUpdate } = usePwaUpdate({ swUrl: '/sw.js', disabled });

  useEffect(() => {
    if (disabled) return;
    void (async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) return;
        const body = (await res.json()) as { sw?: string };
        if (body.sw === 'off') {
          for (const reg of await navigator.serviceWorker.getRegistrations()) {
            await reg.unregister();
          }
        }
      } catch {
        /* offline/fejl → ingen beslutning, workeren består */
      }
    })();
  }, [disabled]);

  return (
    <PwaUpdateBanner
      updateReady={updateReady && !dismissed}
      onUpdate={applyUpdate}
      onDismiss={() => setDismissed(true)}
      className="pwa-update-banner"
      labels={{
        title: t('pwa.updateTitle'),
        body: t('pwa.updateBody'),
        update: t('pwa.updateNow'),
        dismiss: t('pwa.updateLater'),
      }}
    />
  );
}
