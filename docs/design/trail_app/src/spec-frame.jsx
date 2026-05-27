// =====================================================================
// Trail Spec — annotated frames for design-canvas review
// =====================================================================

const { useState: useState_SP } = React;

// -----------------------------------------------------------------------------
// SpecFrame — design on the left, annotation panel on the right.
// width/height are the OUTER artboard dimensions.
// -----------------------------------------------------------------------------
function SpecFrame({ design, designWidth = 720, designHeight = 640, theme = 'light',
  rationale, microcopy, tokens, edgeCases, height }) {

  return (
    <div data-theme={theme}
      className={theme === 'dark' ? 'theme-dark' : ''}
      style={{
        width: '100%', height: height || (designHeight + 20),
        display: 'grid',
        gridTemplateColumns: `${designWidth}px 360px`,
        gap: 20, padding: 0,
        background: 'transparent',
        fontFamily: 'var(--font-sans)',
      }}>

      {/* DESIGN */}
      <div style={{
        background: theme === 'dark' ? '#17140F' : '#FAF9F5',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 0 rgba(26,23,21,.06), 0 8px 28px rgba(26,23,21,.08)',
        position: 'relative',
        border: `1px solid ${theme === 'dark' ? 'rgba(245,241,234,.08)' : 'rgba(26,23,21,.08)'}`,
      }}>
        {design}
      </div>

      {/* ANNOTATIONS */}
      <div data-theme="light" style={{
        background: '#FFFFFF',
        border: '1px solid rgba(26,23,21,.10)',
        borderRadius: 12,
        padding: '18px 18px 16px',
        fontSize: 12,
        color: '#1A1715',
        display: 'flex', flexDirection: 'column', gap: 16,
        overflowY: 'auto',
      }}>
        {rationale && (
          <Section heading="Why this works">
            <p style={{ margin: 0, lineHeight: 1.55, color: 'rgba(26,23,21,.75)' }}>{rationale}</p>
          </Section>
        )}
        {tokens && tokens.length > 0 && (
          <Section heading="Tokens">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <tbody>
                {tokens.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: '4px 8px 4px 0', color: 'rgba(26,23,21,.55)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      {row[0]}
                    </td>
                    <td style={{ padding: '4px 0', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#1A1715' }}>
                      {row[1]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
        {microcopy && microcopy.length > 0 && (
          <Section heading="Microcopy">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <tbody>
                {microcopy.map((row, i) => (
                  <tr key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(26,23,21,.06)' }}>
                    <td style={{ padding: '6px 8px 6px 0', color: 'rgba(26,23,21,.55)', whiteSpace: 'nowrap', verticalAlign: 'top', fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>
                      {row[0]}
                    </td>
                    <td style={{ padding: '6px 0', color: '#1A1715', lineHeight: 1.4 }}>
                      <span style={{ fontStyle: row[2] === 'da' ? 'italic' : 'normal', color: row[2] === 'da' ? 'rgba(26,23,21,.65)' : '#1A1715' }}>{row[1]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(26,23,21,.45)' }}>
              roman = EN · italic = DA
            </div>
          </Section>
        )}
        {edgeCases && edgeCases.length > 0 && (
          <Section heading="Edge cases">
            <ul style={{ margin: 0, padding: '0 0 0 16px', lineHeight: 1.55, color: 'rgba(26,23,21,.75)' }}>
              {edgeCases.map((c, i) => <li key={i} style={{ marginBottom: 4 }}>{c}</li>)}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ heading, children }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9.5,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: 'rgba(26,23,21,.45)',
        marginBottom: 8,
        fontWeight: 500,
      }}>{heading}</div>
      {children}
    </div>
  );
}

// Annotation pill — peach badge with numeric ref
function Anno({ n, top, left, right, bottom }) {
  return (
    <div style={{
      position: 'absolute',
      top, left, right, bottom,
      width: 20, height: 20,
      borderRadius: '50%',
      background: '#E8A87C',
      color: '#1A1715',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
      boxShadow: '0 0 0 2px #FAF9F5, 0 2px 6px rgba(0,0,0,.15)',
      zIndex: 50,
    }}>{n}</div>
  );
}

// "Before" + "After" comparison row
function BeforeAfter({ children, label }) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', top: -22, left: 0,
        fontFamily: 'var(--font-mono)', fontSize: 10,
        color: 'rgba(26,23,21,.55)',
        textTransform: 'uppercase', letterSpacing: '.08em',
      }}>{label}</div>
      {children}
    </div>
  );
}

window.SpecFrame = SpecFrame;
window.Anno = Anno;
window.BeforeAfter = BeforeAfter;
