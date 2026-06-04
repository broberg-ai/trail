import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { fetchAuthMe, listKnowledgeBases, type AuthMe } from './api';
import { mountConstellation } from './lib/constellation';
import { TopNav } from './components/ui/top-nav';
import { TrailSidebar } from './components/ui/trail-sidebar';
import { CommandPalette } from './components/ui/command-palette';
import { AmbientProvider } from './components/ambient-provider';
import { ThinkingSubscriber } from './components/thinking-subscriber';
import { JobProgressModalRoot } from './components/job-progress-modal';
import { ResumableUploadsBanner } from './components/resumable-uploads-banner';
import { ambientRoute } from './lib/ambient-store';
import { routeFromPath } from './lib/route-to-ambient';
import { useKbResolution } from './lib/kb-cache';
import { useLocale } from './lib/i18n';

/**
 * F186 — admin shell. TopNav (logo + tenant-switcher + ⌘K + user-menu),
 * TrailSidebar when inside a KB (replaces the legacy 11-tab strip),
 * CommandPalette (Phase C builds it out).
 *
 * /me here is admin-server's /api/auth/me, which returns the signed-in
 * user, the full tenant list, the currently-active tenant + its engine
 * URL. Engine's /api/v1/me is still hit by per-panel data fetches.
 */
export function App({ children }: { children: ComponentChildren }) {
  useLocale(); // subscribe to locale changes so labels re-render
  const [me, setMe] = useState<AuthMe | null>(null);
  const [bootstrappedKbId, setBootstrappedKbId] = useState<string | null>(() => {
    try { return localStorage.getItem('trail.admin.lastKbId'); } catch { return null; }
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { path, route } = useLocation();
  const kbId = path.match(/^\/kb\/([^/]+)/)?.[1];
  const { kb, notFound: kbNotFound } = useKbResolution(kbId ?? '');

  // F186 — persist the last-visited KB so global routes (/glossary,
  // /jobs, /activity, /settings, /tenants) can still render the
  // sidebar with KB-scoped links pointing at the most recent trail.
  // Only persist once the kbId RESOLVES to a real KB — persisting an
  // invalid kbId (e.g. a tenant slug typed as /kb/<tenant>/…) would
  // poison every sidebar link with a Trail that doesn't exist.
  useEffect(() => {
    if (kbId && kb) {
      try { localStorage.setItem('trail.admin.lastKbId', kb.slug); } catch { /* no storage */ }
    }
  }, [kbId, kb]);

  // Un-poison: if the URL kbId resolved to "no such Trail" and a stale
  // copy of it is sitting in localStorage, drop it and re-bootstrap from
  // a real KB so the sidebar recovers instead of pointing at the ghost.
  useEffect(() => {
    if (kbId && kbNotFound) {
      try {
        if (localStorage.getItem('trail.admin.lastKbId') === kbId) {
          localStorage.removeItem('trail.admin.lastKbId');
        }
      } catch { /* no storage */ }
      setBootstrappedKbId(null);
    }
  }, [kbId, kbNotFound]);

  // Bootstrap a "lastKbId" when the user hasn't visited a KB yet.
  // Without this, /settings (or any global route) shows no sidebar on
  // first sign-in because lastKbId in localStorage is null.
  // Hit listKnowledgeBases once after /me lands and seed from the
  // first entry — same KB the Cmd+K palette would have offered.
  useEffect(() => {
    if (!me || bootstrappedKbId) return;
    listKnowledgeBases()
      .then((kbs) => {
        if (kbs.length === 0) return;
        const first = kbs[0]!.slug;
        try { localStorage.setItem('trail.admin.lastKbId', first); } catch { /* no storage */ }
        setBootstrappedKbId(first);
      })
      .catch(() => { /* network/auth hiccup — sidebar stays hidden, not fatal */ });
  }, [me, bootstrappedKbId]);

  // Sidebar shown on every route except Home + Login. Resolution
  // order: URL kbId > localStorage > bootstrapped first KB.
  const lastKbId = kbId ?? bootstrappedKbId;
  // Hide the KB sidebar on a not-found Trail — its links would all point
  // at the ghost kbId. The not-found shell carries its own "back" link.
  const showSidebar =
    !!lastKbId && path !== '/' && path !== '/login' && !(kbId && kbNotFound);

  // Ambient route signal
  useEffect(() => {
    const next = routeFromPath(path);
    if (ambientRoute.peek() !== next) {
      ambientRoute.value = next;
    }
  }, [path]);

  // Tab title
  useEffect(() => {
    if (kbId && kb) {
      document.title = `trail: ${kb.name}`;
    } else {
      document.title = 'trail: Admin';
    }
  }, [kbId, kb]);

  // Constellation backdrop
  useEffect(() => {
    if (!canvasRef.current) return;
    return mountConstellation(canvasRef.current);
  }, []);

  // ⌘K — open command palette (replaces previous "jump to search" shortcut)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== 'k' && e.key !== 'K') return;
      e.preventDefault();
      setPaletteOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    fetchAuthMe()
      .then((data) => setMe(data))
      .catch(() => {
        // Not authed — redirect to admin-server's /login (which renders
        // the three-method login UI: Google, GitHub, magic-link).
        // F186 dev-mode: hit engine's dev-login shortcut for local work.
        const target = import.meta.env.DEV
          ? '/api/auth/dev-login?session=dev'
          : '/login';
        window.location.href = target;
      });
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <canvas ref={canvasRef} id="trail-graph" aria-hidden="true" />

      {me ? <TopNav me={me} onOpenPalette={() => setPaletteOpen(true)} /> : null}
      {me ? <ResumableUploadsBanner /> : null}

      {me ? (
        <main style={{ position: 'relative', zIndex: 10, flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {showSidebar ? <TrailSidebar kbId={lastKbId!} urlHasKbId={!!kbId} /> : null}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
            {kbId && kbNotFound ? <KbNotFound kbId={kbId} /> : children}
          </div>
        </main>
      ) : null}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} me={me} />

      <AmbientProvider />
      {me ? <ThinkingSubscriber /> : null}
      {me ? <JobProgressModalRoot /> : null}
    </div>
  );
}

/**
 * Shown when the URL carries a `/kb/<kbId>/…` that resolves to no Trail —
 * typically a tenant slug typed as a KB (e.g. `/kb/broberg-ai/…`, where
 * `broberg-ai` is the tenant, not one of its Trails) or a stale/old URL.
 * Replaces the per-panel infinite loader (panels gate on `if (!kb)` and
 * would otherwise spin forever, since a missing KB never resolves).
 */
function KbNotFound({ kbId }: { kbId: string }) {
  return (
    <div style={{ padding: '64px 28px', maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 28, letterSpacing: '-0.015em' }}>
        Trail ikke fundet
      </h1>
      <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.65, color: 'var(--color-fg-muted)' }}>
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{kbId}</code>{' '}
        matcher ingen Trail i denne tenant. Det er sandsynligvis et tenant-navn eller en
        gammel URL — en tenant kan rumme flere Trails, hver med sin egen slug. Vælg en Trail
        fra oversigten.
      </p>
      <a
        href="/"
        class="btn btn-primary"
        style={{ marginTop: 22, display: 'inline-flex', alignItems: 'center', gap: 8 }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          ← Tilbage til Trails
        </span>
      </a>
    </div>
  );
}

/**
 * Legacy export shim — some tests may still reference these. The new
 * TopNav owns theme/locale/audio via the UserMenu dropdown.
 */
export { App as default };
