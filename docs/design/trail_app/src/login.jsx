// =====================================================================
// Trail — Login flow
//   states: 'cold' | 'redirecting' | 'splash' | 'error'
// =====================================================================

const { useState, useEffect } = React;

function LoginScreen({ t, onSignedIn, initialState = 'cold' }) {
  const [state, setState] = useState(initialState);

  useEffect(() => { setState(initialState); }, [initialState]);

  const handleSignIn = () => {
    setState('redirecting');
    setTimeout(() => setState('splash'), 950);
    setTimeout(() => onSignedIn(), 2100);
  };

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="constellation" />

      <div className="card" style={{
        position: 'relative',
        width: '100%',
        maxWidth: 420,
        padding: '40px 36px 28px',
        boxShadow: 'var(--shadow-md)',
      }}>
        {/* Brand block */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginBottom: 28 }}>
          <window.TrailLogoSvg size={44} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="wordmark" style={{ fontSize: 26 }}>trail</span>
            <span className="wordmark-sub">admin</span>
          </div>
        </div>

        {/* Headline + tagline */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{
            margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400,
            fontSize: 22, letterSpacing: '-0.01em', lineHeight: 1.25
          }}>{t.signInTitle}</h1>
          <p style={{
            margin: '8px 0 0', color: 'var(--color-fg-muted)',
            fontSize: 13.5, lineHeight: 1.5, maxWidth: 300, marginLeft: 'auto', marginRight: 'auto'
          }}>{t.signInSubtitle}</p>
        </div>

        {/* CTA */}
        {state === 'error' && (
          <div style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            padding: '10px 12px', borderRadius: 'var(--radius)',
            background: 'rgba(194,65,12,.08)',
            border: '1px solid rgba(194,65,12,.20)',
            color: 'var(--color-danger)',
            fontSize: 12.5, marginBottom: 16,
          }}>
            <window.Icons.X size={14} style={{ marginTop: 1, flex: '0 0 auto' }} />
            <span>{t.signInError}</span>
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={handleSignIn}
          disabled={state === 'redirecting' || state === 'splash'}
          style={{
            width: '100%', justifyContent: 'center', padding: '12px 16px',
            fontSize: 14, fontWeight: 500, gap: 10,
          }}>
          {state === 'redirecting' ? (
            <>
              <span className="spinner" />
              <span>{t.signInLoading}</span>
            </>
          ) : (
            <>
              <window.Icons.Google size={16} />
              <span>{t.signInCTA}</span>
            </>
          )}
        </button>

        {/* Tertiary */}
        <div style={{
          marginTop: 14, textAlign: 'center', fontSize: 12,
          color: 'var(--color-fg-subtle)'
        }}>
          <span>OAuth · zero passwords stored</span>
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 28, paddingTop: 16,
          borderTop: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'center', gap: 18,
          fontSize: 12, color: 'var(--color-fg-muted)',
        }}>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>{t.legal}</a>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>{t.privacy}</a>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>{t.docs}</a>
        </div>
      </div>

      {/* Splash overlay — brand-presenting redirect-back */}
      {state === 'splash' && (
        <div className="anim-fade" style={{
          position: 'absolute', inset: 0,
          background: 'var(--color-bg)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 18,
          zIndex: 10,
        }}>
          <div style={{ position: 'relative', width: 64, height: 64 }}>
            <window.TrailLogoSvg size={64} />
            <span className="splash-pulse" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="wordmark">trail</span>
          </div>
          <p style={{ color: 'var(--color-fg-muted)', fontSize: 13, margin: 0 }}>{t.signInSplash}</p>
          <style>{`
            .splash-pulse {
              position: absolute; inset: -8px;
              border-radius: 50%;
              border: 1px solid var(--color-accent);
              opacity: 0;
              animation: pulse 1.6s ease-out infinite;
            }
            @keyframes pulse {
              0% { transform: scale(.85); opacity: .9; }
              100% { transform: scale(1.35); opacity: 0; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

window.LoginScreen = LoginScreen;
