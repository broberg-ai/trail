/// <reference lib="webworker" />
/**
 * F247.2 — Trail admins service worker. Bygges af `bun build` til dist/sw.js
 * (se package.json build) så @broberg/pwa/sw kan importeres.
 *
 * Strategien er bevidst minimal, og rækkefølgen af hensyn er ikke til
 * forhandling:
 *
 *  1. NAVIGATION ER NETWORK-FIRST. index.html er den ene fil hvis URL står
 *     stille mens indholdet flytter sig ved hvert deploy — serveres den fra
 *     cache, peger den på hashede assets der ikke findes længere, og appen
 *     er DØD indtil nogen rydder site-data (den klassiske PWA-fælde,
 *     admin-serverens egen kommentar om cache-parrets to modsatte regler).
 *     Cachen bruges KUN som offline-fallback.
 *  2. /assets/* er cache-first: filnavnene er indholds-hashede, så en URL
 *     kan aldrig skifte betydning — præcis derfor er de sikre at cache.
 *  3. API-kald røres ALDRIG. Kundedata hører ikke hjemme i en browser-cache,
 *     og en cachet 200 fra i går er en løgn i dag.
 */
import { listenForSkipWaiting } from '@broberg/pwa/sw';
import { createPushHandler, handleNotificationClick } from '@broberg/webpush/sw';

declare const self: ServiceWorkerGlobalScope;

// F247.2 — SW_REV er ÆGTE kode, ikke en kommentar: minifieren stripper
// kommentarer, så et kommentar-bump gav en byte-identisk sw.js og browseren
// så aldrig en ny version (målt: flow b215c53d, toasten udeblev i 120s).
// Bump den ved et bevis-run; logges så en DevTools-kigger kan se revisionen.
const SW_REV = 'r8';
console.log('[trail-sw]', SW_REV);

const SHELL_CACHE = 'trail-shell-v1';
// F248.5 — v2: ikonerne er cache-first, så et navne-bump er det der får en
// allerede-installeret klient til at hente de nye (mørke) ikoner i stedet for
// at servere de gamle fra cachen for evigt. activate rydder ukendte caches.
const ASSET_CACHE = 'trail-assets-v2';
const KNOWN_CACHES = new Set([SHELL_CACHE, ASSET_CACHE]);

// @broberg/pwa: den nye worker aktiverer først når brugeren siger til
// («Ny version»-toasten) — ingen reload-loop, ingen tavs udskiftning.
listenForSkipWaiting(self);

// F247.3 — web-push via @broberg/webpush. defaultIcon SKAL være en rigtig
// fil: en ikon-URL der svarer HTML gør notifikationen usynlig på iOS, tavst.
self.addEventListener(
  'push',
  createPushHandler({
    defaultTitle: 'Trail',
    defaultNavigate: '/',
    defaultIcon: '/icon-192.png',
    defaultBadgeIcon: '/icon-192.png',
  }),
);
self.addEventListener('notificationclick', (event) => handleNotificationClick(event));

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (!KNOWN_CACHES.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

const OFFLINE_FALLBACK = `<!doctype html><html lang="da"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Trail — offline</title>
<body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#faf7f2;color:#1a1715">
<div style="text-align:center;padding:24px"><div style="font-size:40px">⛰️</div>
<h1 style="font-size:18px">Du er offline</h1>
<p style="font-size:14px;color:#6b6560">Trail kræver netværk — prøv igen når du har forbindelse.</p></div>`;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API + auth + SSE: aldrig gennem cachen.
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(SHELL_CACHE);
            void cache.put('/', res.clone());
          }
          return res;
        } catch {
          const cached = await caches.match('/');
          return (
            cached ??
            new Response(OFFLINE_FALLBACK, {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      })(),
    );
    return;
  }

  const cacheFirst =
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/manifest.webmanifest' ||
    /^\/(icon-|apple-touch-icon)/.test(url.pathname);
  if (cacheFirst) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(ASSET_CACHE);
          void cache.put(req, res.clone());
        }
        return res;
      })(),
    );
  }
});
