import { useState } from 'preact/hooks';
import { useEffect } from 'preact/hooks';
import { usePwaUpdate } from '@broberg/pwa/preact';
import { t } from '../lib/i18n';

/**
 * F247.2/F247.4 — «Ny version klar»-banneret. Livscyklussen (registrér /sw.js,
 * opdag ventende worker, SKIP_WAITING + reload) kommer fra @broberg/pwa —
 * flådens primitiv. Men SELVE BANNERET er flådens kanoniske markup+CSS
 * (pwa-banner-wrap-familien), 1:1 som cardmem/xrt81/sanne/moovyy — ejerens
 * ordre 5/9: «100% det samme … ikke en ny avart». Kun farve-tokens er Trails.
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

  if (!updateReady || dismissed) return null;

  return (
    <div class="pwa-banner-wrap" role="status" aria-live="polite" data-testid="pwa-update-banner">
      <div class="pwa-banner">
        <span class="pwa-banner-ic" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </span>
        <div class="pwa-banner-txt">
          <p class="pwa-banner-ttl">{t('pwa.updateTitle')}</p>
          <p class="pwa-banner-sub">{t('pwa.updateBody')}</p>
        </div>
        <div class="pwa-banner-actions">
          <button
            type="button"
            class="pwa-banner-later"
            data-testid="pwa-update-dismiss"
            onClick={() => setDismissed(true)}
          >
            {t('pwa.updateLater')}
          </button>
          <button
            type="button"
            class="btn btn-primary pwa-banner-go"
            data-testid="pwa-update-confirm"
            onClick={() => applyUpdate()}
          >
            {t('pwa.updateNow')}
          </button>
        </div>
      </div>
    </div>
  );
}
