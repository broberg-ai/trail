import type { JSX } from 'preact';

/**
 * F186 — shared panel header. Serif H1 + mono subtitle + optional CTA
 * cluster. Replaces every ad-hoc `<h1>` we shipped across the 21 panels
 * so the inner-trail surface matches the design's headline rhythm.
 *
 * Sits inside `.page-shell` or any other container — does NOT impose
 * its own outer padding. Match design's home.jsx::PageHeader pattern.
 */
export interface PanelHeaderProps {
  title: string;
  subtitle?: string | JSX.Element;
  /** Right-aligned action buttons (typically primary + secondary). */
  actions?: JSX.Element | JSX.Element[];
}

export function PanelHeader({ title, subtitle, actions }: PanelHeaderProps) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        marginBottom: 32,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: 32,
            letterSpacing: '-0.015em',
            lineHeight: 1.15,
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
      {actions ? <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>{actions}</div> : null}
    </div>
  );
}
