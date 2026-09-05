import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { LocationProvider, Router, Route, useLocation } from 'preact-iso';
import { App } from './app';
import { QueuePanel } from './panels/queue';
import { KnowledgeBasesPanel } from './panels/kbs';
import { WikiTreePanel } from './panels/wiki-tree';
import { WikiReaderPanel } from './panels/wiki-reader';
import { SourcesPanel } from './panels/sources';
import { SearchPanel } from './panels/search';
import { ChatPanel } from './panels/chat';
import { GlossaryPanel } from './panels/glossary';
import { GraphPanel } from './panels/graph';
import { MemoryHealthPanel } from './panels/memory-health';
import { BrainVersionsPanel } from './panels/brain-versions';
import { WorkPanel } from './panels/work';
import { PlayPanel } from './panels/play';
import { SettingsTrailPanel } from './panels/settings-trail';
import { SettingsAccountPanel } from './panels/settings-account';
import { ManageTenantsPanel } from './panels/tenants';
import { TenantMembersPanel } from './panels/tenant-members';
import { CostPanel } from './panels/cost';
import { QualityComparePanel } from './panels/quality-compare';
import { LinkReportPanel } from './panels/link-report';
import { JobsPanel } from './panels/jobs';
import { ActivityPanel } from './panels/activity';
import { ImagesPanel } from './panels/images';
import { NotFound } from './panels/not-found';
import { AmbientConnectPanel } from './panels/ambient-connect';
import { initTheme } from './theme';
import { ensureAnchorMarkedExtensions } from './lib/markdown';
import { init as initUpmetrics } from '@upmetrics/sdk';
import { UPMETRICS_DSN } from '@trail/shared';
import './index.css';

// Upmetrics fleet-dogfooding — browser telemetry (auto-instruments
// window.onerror / unhandledrejection / failed-fetch). DSN is the single
// source from @trail/shared (compiled in). Only in production builds, so dev
// (`vite dev`) doesn't ship telemetry.
if (import.meta.env.PROD) {
  initUpmetrics({ dsn: UPMETRICS_DSN, environment: import.meta.env.MODE, release: 'trail-admin' });
}

// Apply persisted theme before first paint so we never flash the wrong palette.
initTheme();
// F22 — install claim-anchor-aware marked renderer once before any panel
// calls marked.parse. Idempotent.
ensureAnchorMarkedExtensions();

/** F248.1 — /kb/:kbId uden underside → Chat (sidebarens første punkt). */
function KbIndexRedirect({ kbId }: { kbId?: string }) {
  const { route } = useLocation();
  useEffect(() => {
    if (kbId) route(`/kb/${kbId}/chat`, true);
  }, [kbId, route]);
  return null;
}

function Main() {
  return (
    <LocationProvider>
      <App>
        <Router>
          <Route path="/" component={KnowledgeBasesPanel} />
          {/* F248.1 — en BAR trail-adresse (/kb/<slug>) er gyldig og lander på
              Chat. Uden denne rute faldt den i NotFound: ejeren loggede ind på
              telefonen og fik 404 midt i en fungerende trail (5/9). */}
          <Route path="/kb/:kbId" component={KbIndexRedirect} />
          <Route path="/kb/:kbId/queue" component={QueuePanel} />
          <Route path="/kb/:kbId/neurons" component={WikiTreePanel} />
          <Route path="/kb/:kbId/neurons/:slug" component={WikiReaderPanel} />
          <Route path="/kb/:kbId/graph" component={GraphPanel} />
          <Route path="/kb/:kbId/memory-health" component={MemoryHealthPanel} />
          <Route path="/kb/:kbId/brain-versions" component={BrainVersionsPanel} />
          <Route path="/kb/:kbId/work" component={WorkPanel} />
          <Route path="/kb/:kbId/sources" component={SourcesPanel} />
          <Route path="/kb/:kbId/images" component={ImagesPanel} />
          <Route path="/kb/:kbId/sources/:sourceId/compare" component={QualityComparePanel} />
          <Route path="/kb/:kbId/search" component={SearchPanel} />
          <Route path="/kb/:kbId/chat" component={ChatPanel} />
          <Route path="/kb/:kbId/cost" component={CostPanel} />
          <Route path="/kb/:kbId/link-check" component={LinkReportPanel} />
          <Route path="/kb/:kbId/settings" component={SettingsTrailPanel} />
          <Route path="/settings" component={SettingsAccountPanel} />
          <Route path="/ambient/connect" component={AmbientConnectPanel} />
          <Route path="/tenants" component={ManageTenantsPanel} />
          <Route path="/tenants/:tenantId/members" component={TenantMembersPanel} />
          <Route path="/glossary" component={GlossaryPanel} />
          <Route path="/jobs" component={JobsPanel} />
          <Route path="/activity" component={ActivityPanel} />
          <Route path="/play" component={PlayPanel} />
          <Route default component={NotFound} />
        </Router>
      </App>
    </LocationProvider>
  );
}

render(<Main />, document.getElementById('app')!);
