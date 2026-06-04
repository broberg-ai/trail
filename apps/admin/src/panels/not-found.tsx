import { t } from '../lib/i18n';

export function NotFound() {
  return (
    <div class="page-shell text-center" data-testid="not-found-root">
      <h1 style="font-family: var(--font-serif); font-weight: 400; font-size: 64px; letter-spacing: -0.015em; line-height: 1.15; margin: 0 0 8px;">404</h1>
      <p class="text-[color:var(--color-fg-muted)]">{t('notFound.body')}</p>
      <a
        href="/"
        class="inline-block mt-6 px-4 py-2 rounded-md border border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-card)] transition text-sm"
      >
        ← {t('notFound.backToTrails')}
      </a>
    </div>
  );
}
