import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

// F191 — the Station is a localhost dev tool. It talks to the CLOUD admin
// (app.trailmem.com) which proxies /api/v1 to the tenant's engine. We proxy
// /api through Vite so the browser sees same-origin (no CORS) and the personal
// `trail_` Bearer key the app attaches is forwarded upstream. Override the
// cloud target with CLOUD_API for staging/local-engine testing.
const CLOUD_API = process.env.CLOUD_API ?? 'https://app.trailmem.com';
const PORT = Number(process.env.PORT ?? 3032);

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
  build: { outDir: 'dist', sourcemap: process.env.VITE_SOURCEMAP === '1' },
});
