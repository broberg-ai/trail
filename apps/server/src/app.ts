import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { captureException } from '@upmetrics/sdk';
import { ZodError } from 'zod';
import type { TrailDatabase } from '@trail/db';
import type { TenantPool } from './lib/tenant-pool.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { kbRoutes } from './routes/knowledge-bases.js';
import { documentRoutes } from './routes/documents.js';
import { uploadRoutes } from './routes/uploads.js';
import { searchRoutes } from './routes/search.js';
import { retrieveRoutes } from './routes/retrieve.js';
import { userRoutes } from './routes/user.js';
import { imageRoutes } from './routes/images.js';
import { imagesSearchRoutes } from './routes/images-search.js';
import { chatRoutes } from './routes/chat.js';
import { chatSessionRoutes } from './routes/chat-sessions.js';
import { ingestRoutes } from './routes/ingest.js';
import { streamRoutes } from './routes/stream.js';
import { queueRoutes } from './routes/queue.js';
import { readerFeedbackRoutes } from './routes/reader-feedback.js';
import { lintRoutes } from './routes/lint.js';
import { historyRoutes } from './routes/history.js';
import { glossaryRoutes } from './routes/glossary.js';
import { graphRoutes } from './routes/graph.js';
import { memoryHealthRoutes } from './routes/memory-health.js';
import { workRoutes } from './routes/work.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { backupRoutes } from './routes/backups.js';
import { costRoutes } from './routes/cost.js';
import { fxRoutes } from './routes/fx.js';
import { pushRoutes } from './routes/push.js';
import { notifyPush } from './services/push.js';
import { setCandidatePushNotifier } from '@trail/core';
import { chatSettingsRoutes } from './routes/chat-settings.js';
import { ingestSettingsRoutes } from './routes/ingest-settings.js';
import { userNoteRoutes } from './routes/documents-user-note.js';
import { creditsRoutes } from './routes/credits.js';
import { jobRoutes } from './routes/jobs.js';
import { beamRoutes } from './routes/beam.js';
import { activityRoutes } from './routes/activity.js';
import { maintenanceRoutes } from './routes/maintenance.js';
import { lintSettingsRoutes } from './routes/lint-settings.js';
import { ambientRoutes } from './routes/ambient.js';

/**
 * Hono context variables visible to every handler.
 *
 * `trail` is injected at the app root (F40.1) by the bootstrap in
 * index.ts. F40.2 replaces this with per-request tenant-context
 * middleware that resolves the caller's tenant and fetches its
 * TrailDatabase from a pool — handlers keep reading `c.get('trail')`
 * unchanged.
 *
 * `user` and `tenant` are set by requireAuth middleware (see
 * middleware/auth.ts).
 */
export interface AppBindings {
  Variables: {
    trail: TrailDatabase;
    /**
     * F40.2a — when set, the auth middleware selects the right
     * tenant DB from this pool based on bearer/session lookup
     * through `/data/key-index.db`. With TRAIL_MULTI_TENANT unset
     * the pool contains only the primary tenant and the middleware
     * stays on the legacy single-tenant code path.
     */
    tenantPool: TenantPool;
    user?: import('./middleware/auth.js').AuthUser;
    tenant?: import('./middleware/auth.js').AuthTenant;
    /**
     * F205.1 — the single knowledge base a 'partner' API key is confined to,
     * read from the key row by the auth middleware. The partner upload
     * endpoint takes NO kbId of its own and reads this instead, so an external
     * caller cannot retarget another knowledge base by editing the request.
     * Undefined for every non-partner caller.
     */
    partnerKbId?: string | null;
    /**
     * F160 — how the request was authenticated. Lets routes pick
     * sane defaults for audience-aware behaviour: external Bearer
     * callers default to `tool` audience (no admin-only docs, no
     * curator-style prose), session-cookie admin-UI defaults to
     * `curator`.
     */
    authType?: 'bearer' | 'session';
  };
}

export function createApp(trail: TrailDatabase, tenantPool: TenantPool): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use('*', logger());
  const adminOrigin = process.env.APP_URL ?? 'http://localhost:3030';
  // F111.2 — `TRAIL_ALLOWED_ORIGINS` (CSV) lets operators whitelist
  // additional origins (e.g. an integration site on localhost:3001
  // during dev, or a customer subdomain in prod) without editing
  // code. Each entry is validated at boot: must parse as a URL with
  // scheme + host (+ optional port), no path/query. Invalid entries
  // log a warning and are dropped — boot continues with the rest, so
  // a typo in one entry doesn't take the engine down.
  const configuredExtraOrigins = (process.env.TRAIL_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => {
      try {
        const u = new URL(s);
        if (u.pathname && u.pathname !== '/') {
          console.warn(`[cors] dropping TRAIL_ALLOWED_ORIGINS entry with path: ${s}`);
          return false;
        }
        return true;
      } catch {
        console.warn(`[cors] dropping invalid TRAIL_ALLOWED_ORIGINS entry: ${s}`);
        return false;
      }
    })
    .map((s) => s.replace(/\/$/, ''));
  if (configuredExtraOrigins.length > 0) {
    console.log(
      `[cors] extra origins from TRAIL_ALLOWED_ORIGINS: ${configuredExtraOrigins.join(', ')}`,
    );
  }
  app.use(
    '/api/*',
    cors({
      origin: (origin) => {
        // Allow configured APP_URL, localhost variants, browser extensions,
        // and any origins from TRAIL_ALLOWED_ORIGINS env (F111.2).
        const allowed = [
          process.env.APP_URL ?? 'http://localhost:3030',
          'http://localhost:3030',
          'http://127.0.0.1:3030',
          ...configuredExtraOrigins,
        ];
        if (allowed.includes(origin)) return origin;
        if (origin.startsWith('chrome-extension://')) return origin;
        if (origin.startsWith('moz-extension://')) return origin;
        if (origin.startsWith('safari-web-extension://')) return origin;
        return allowed[0];
      },
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
      exposeHeaders: ['Set-Cookie', 'X-Document-Id'],
    }),
  );

  // Inject the primary TrailDatabase + the full tenant pool into every
  // request. The auth middleware (requireAuth in middleware/auth.ts)
  // overrides `trail` with the bearer/session's resolved tenant DB
  // when TRAIL_MULTI_TENANT=1; with the flag off it leaves `trail`
  // as the primary (back-compat for routes that fire pre-auth like
  // /health and /api/auth/google).
  app.use('*', async (c, next) => {
    c.set('trail', trail);
    c.set('tenantPool', tenantPool);
    await next();
  });

  app.route('/api', healthRoutes);
  // F168 Beam — engine-side import endpoint. NO requireAuth: uses its own
  // BEAM_TOKEN Bearer check (different from F111.2 tenant Bearer keys).
  app.route('/api', beamRoutes);
  app.route('/api/auth', authRoutes);
  // F201.2 — ambient device-auth. MUST mount before the requireAuth'd
  // groups below: POST /ambient/token is deliberately unauthenticated
  // (the device has no credential yet; the single-use code is the
  // bearer), and Hono matches in registration order — mounted later it
  // would inherit kbRoutes' use('*', requireAuth) and 401. /ambient/
  // approve carries its own explicit requireAuth. Ship-dark until
  // TRAIL_AMBIENT_AUTH=1.
  app.route('/api/v1', ambientRoutes);
  app.route('/api/v1', kbRoutes);
  app.route('/api/v1', documentRoutes);
  app.route('/api/v1', uploadRoutes);
  app.route('/api/v1', searchRoutes);
  app.route('/api/v1', retrieveRoutes);
  app.route('/api/v1', userRoutes);
  app.route('/api/v1', imageRoutes);
  app.route('/api/v1', imagesSearchRoutes);
  app.route('/api/v1', chatRoutes);
  app.route('/api/v1', chatSessionRoutes);
  app.route('/api/v1', ingestRoutes);
  app.route('/api/v1', streamRoutes);
  app.route('/api/v1', queueRoutes);
  app.route('/api/v1', readerFeedbackRoutes);
  app.route('/api/v1', lintRoutes);
  app.route('/api/v1', historyRoutes);
  app.route('/api/v1', glossaryRoutes);
  app.route('/api/v1', graphRoutes);
  app.route('/api/v1', memoryHealthRoutes);
  app.route('/api/v1', workRoutes);
  app.route('/api/v1', apiKeyRoutes);
  // F153 — admin-only backup endpoints. Route prefix is `/api/v1/admin/...`.
  app.route('/api/v1', backupRoutes);
  // F151 — Cost & Quality Dashboard endpoints.
  app.route('/api/v1', costRoutes);
  // F151 — USD→DKK rate proxy for currency-localised cost display.
  app.route('/api/v1', fxRoutes);
  // F159 — per-KB chat backend overrides (GET + PATCH /knowledge-bases/:kbId/chat-settings).
  app.route('/api/v1', chatSettingsRoutes);
  // F152 — per-KB ingest backend overrides (GET + PATCH /knowledge-bases/:kbId/ingest-settings).
  app.route('/api/v1', ingestSettingsRoutes);
  // F112 — Luhmann-friction "Your Take" field (PUT /documents/:docId/user-note).
  app.route('/api/v1', userNoteRoutes);
  // F156 Phase 0 — credits balance + recent transactions for the cost panel card.
  app.route('/api/v1', creditsRoutes);
  // F164 — generic background-jobs API (submit, list, get, abort, SSE stream).
  app.route('/api/v1', jobRoutes);
  // F97 — activity log read API (paginated audit timeline).
  app.route('/api/v1', activityRoutes);

  // F182.5 repair + F200.2 lint-drain — admin maintenance.
  app.route('/api/v1', maintenanceRoutes);
  // F200.1 — per-KB lint settings (contradiction-lint toggle).
  app.route('/api/v1', lintSettingsRoutes);
  // F247.3 — web-push: config/subscribe/unsubscribe/prefs/test.
  app.route('/api/v1', pushRoutes);

  // F247.3 — kø-hook: en kandidat der lander PENDING pinger abonnenterne.
  // Registreres her (én gang pr. proces) fordi kun core ser alle veje ind.
  setCandidatePushNotifier(({ trail: t, tenantId, candidate }) => {
    void notifyPush(t, tenantId, 'queue', {
      title: 'Trail — ny kandidat i køen',
      body: candidate.title || 'En ny kandidat afventer kuratering',
      navigate: `/kb/${candidate.knowledgeBaseId}/queue`,
      icon: '/icon-192.png',
      tag: 'trail-queue',
    });
  });

  // Upmetrics — capture unhandled route errors (no-op unless UPMETRICS_DSN was
  // set at boot in index.ts), then preserve Hono's default 500 response.
  //
  // F214.1 — a ZodError is NOT a server error. Six routes call
  // `Schema.parse(await c.req.json())` directly, so any body the schema
  // rejects threw straight into this handler and came back as a bare
  // `Internal Server Error` with no field, no limit and no log line. The
  // owner hit it on Settings → a description longer than the schema's 500
  // characters, and the surface could only say "500" about text he had just
  // spent minutes writing. A 400 that names the field is the difference
  // between "fix this word" and "something broke, good luck".
  //
  // Handled here rather than at each call site on purpose: the same bug
  // exists identically at all six, and a per-route try/catch would have to
  // be remembered at the seventh.
  app.onError((err, c) => {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({
        field: i.path.join('.') || '(body)',
        message: i.message,
      }));
      const first = issues[0];
      return c.json(
        {
          error: first ? `${first.field}: ${first.message}` : 'Invalid request body',
          issues,
        },
        400,
      );
    }
    // Anything else IS a server error — and must leave a trace. Without this
    // line the 500 above was invisible in `flyctl logs`: the request line
    // said 500 and nothing said why.
    console.error(`[error] ${c.req.method} ${c.req.url}`, err);
    captureException(err, { request: { url: c.req.url, method: c.req.method } });
    return c.text('Internal Server Error', 500);
  });

  return app;
}
