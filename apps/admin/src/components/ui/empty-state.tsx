import type { JSX } from 'preact';

/**
 * F186 — EmptyShell shared component. Ported from
 * docs/design/trail_app/src/home.jsx::EmptyShell.
 *
 * 56×56 accent-tinted ring → serif H2 → muted body → primary CTA
 * (+ optional secondary CTA). Used by Home, every panel's empty branch,
 * and the Manage Tenants / Settings sub-pages.
 *
 * Two variants:
 *   - inline: dashed-border card inside an already-padded container
 *   - default: full-bleed vertical centering for "this whole route is empty"
 */
export interface EmptyStateProps {
  icon: JSX.Element;
  title: string;
  body?: string;
  ctaLabel?: string;
  ctaIcon?: JSX.Element;
  onCta?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  inline?: boolean;
}

export function EmptyState({
  icon,
  title,
  body,
  ctaLabel,
  ctaIcon,
  onCta,
  secondaryLabel,
  onSecondary,
  inline = false,
}: EmptyStateProps) {
  return (
    <div
      style={{
        position: 'relative',
        padding: inline ? '60px 24px 70px' : '80px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 16,
        border: inline ? '1px dashed var(--color-border-strong)' : 'none',
        borderRadius: inline ? 'var(--radius-lg)' : 0,
        background: inline ? 'var(--color-bg-card)' : 'transparent',
        maxWidth: inline ? 'none' : 480,
        margin: inline ? '0' : '60px auto',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-accent-soft)',
          color: 'var(--color-accent)',
        }}
      >
        {icon}
      </div>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--font-serif)',
          fontWeight: 400,
          fontSize: 22,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
      {body ? (
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            color: 'var(--color-fg-muted)',
            maxWidth: 440,
            lineHeight: 1.55,
          }}
        >
          {body}
        </p>
      ) : null}
      {ctaLabel || secondaryLabel ? (
        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
          {ctaLabel ? (
            <button type="button" class="btn btn-primary" style={{ padding: '9px 16px' }} onClick={onCta}>
              {ctaIcon}
              <span>{ctaLabel}</span>
            </button>
          ) : null}
          {secondaryLabel ? (
            <button type="button" class="btn btn-ghost" style={{ padding: '9px 14px' }} onClick={onSecondary}>
              <span>{secondaryLabel}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
