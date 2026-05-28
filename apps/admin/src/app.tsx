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
import { useKb } from './lib/kb-cache';
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
  const kb = useKb(kbId ?? '');

  // F186 — persist the last-visited KB so global routes (/glossary,
  // /jobs, /activity, /settings, /tenants) can still render the
  // sidebar with KB-scoped links pointing at the most recent trail.
  useEffect(() => {
    if (kbId) {
      try { localStorage.setItem('trail.admin.lastKbId', kbId); } catch { /* no storage */ }
    }
  }, [kbId]);

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
  const showSidebar = !!lastKbId && path !== '/' && path !== '/login';

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
            {children}
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
 * Legacy export shim — some tests may still reference these. The new
 * TopNav owns theme/locale/audio via the UserMenu dropdown.
 */
export { App as default };
