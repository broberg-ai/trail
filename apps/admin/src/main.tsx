import { render } from 'preact';
import { LocationProvider, Router, Route } from 'preact-iso';
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
import { WorkPanel } from './panels/work';
import { PlayPanel } from './panels/play';
import { SettingsTrailPanel } from './panels/settings-trail';
import { SettingsAccountPanel } from './panels/settings-account';
import { ManageTenantsPanel } from './panels/tenants';
import { CostPanel } from './panels/cost';
import { QualityComparePanel } from './panels/quality-compare';
import { LinkReportPanel } from './panels/link-report';
import { JobsPanel } from './panels/jobs';
import { ActivityPanel } from './panels/activity';
import { ImagesPanel } from './panels/images';
import { NotFound } from './panels/not-found';
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

function Main() {
  return (
    <LocationProvider>
      <App>
        <Router>
          <Route path="/" component={KnowledgeBasesPanel} />
          <Route path="/kb/:kbId/queue" component={QueuePanel} />
          <Route path="/kb/:kbId/neurons" component={WikiTreePanel} />
          <Route path="/kb/:kbId/neurons/:slug" component={WikiReaderPanel} />
          <Route path="/kb/:kbId/graph" component={GraphPanel} />
          <Route path="/kb/:kbId/memory-health" component={MemoryHealthPanel} />
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
          <Route path="/tenants" component={ManageTenantsPanel} />
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
