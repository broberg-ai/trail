import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// F191 — the Station is a localhost dev tool. It talks to the CLOUD admin
// (app.trailmem.com) which proxies /api/v1 to the tenant's engine. We proxy
// /api through Vite so the browser sees same-origin (no CORS) and the personal
// `trail_` Bearer key the app attaches is forwarded upstream. Override the
// cloud target with CLOUD_API for staging/local-engine testing.
const CLOUD_API = process.env.CLOUD_API ?? 'https://app.trailmem.com';
const PORT = Number(process.env.PORT ?? 3032);

// F191 — auto-login on localhost: read the personal key from the gitignored
// repo-root .env.local-ingest and inject it so the user never pastes it. Only
// has a value when the file exists (i.e. local dev) — a standalone build with
// no file gets "" and falls back to the paste gate.
function readDevKey(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const p = resolve(here, '../../.env.local-ingest');
  if (!existsSync(p)) return '';
  const m = readFileSync(p, 'utf8').match(/^\s*TRAIL_API_KEY\s*=\s*(.+?)\s*$/m);
  return m ? m[1]!.trim() : '';
}
const DEV_KEY = readDevKey();

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  server: {
    port: PORT,
    proxy: {
      '/api': {
        target: CLOUD_API,
        changeOrigin: true,
        // No proxy-side timeout — large uploads + long-lived SSE (/api/v1/stream)
        // must not be cut off mid-stream.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  define: { __TRAIL_DEV_KEY__: JSON.stringify(DEV_KEY) },
  build: { outDir: 'dist', sourcemap: process.env.VITE_SOURCEMAP === '1' },
});
