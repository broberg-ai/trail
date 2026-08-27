import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

const API_URL = process.env.API_URL ?? 'http://localhost:3031';

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  server: {
    port: 3030,
    proxy: {
      // Proxy /api → engine so the admin can send cookies without CORS ceremony
      // during dev. In prod the admin sits behind the same base domain as the
      // engine so no proxy is needed.
      // The control plane serves these itself (they are server-rendered
      // HTML, not SPA routes). Without them here Vite answers /login with
      // the SPA, which sees 401, redirects to /api/auth/dev-login, gets
      // 302'd back to /login — and loops forever with nothing on screen.
      ...Object.fromEntries(
        ['/login', '/logout', '/invite'].map((path) => [
          path,
          { target: API_URL, changeOrigin: true, cookieDomainRewrite: 'localhost' },
        ]),
      ),
      '/api': {
        target: API_URL,
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
        // Large file uploads (25MB+ PDFs, audio, scanned docs) hang
        // through Vite's default http-proxy because the upstream
        // socket-timeout fires while the body still streams. 0 = no
        // proxy-side timeout, let the engine's own timeouts decide.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  build: {
    outDir: 'dist',
    // No sourcemaps in prod build — they were ~12 MB and dominated Fly's
    // deploy context (60% of total upload time on slow ISPs). Re-enable
    // for one build via `VITE_SOURCEMAP=1 pnpm build` if a prod issue
    // needs debugging; sentry-style upload is a future feature.
    sourcemap: process.env.VITE_SOURCEMAP === '1',
  },
});
