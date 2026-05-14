import { defineConfig } from 'vite';

/**
 * F29 — `<trail-chat>` embeddable widget build.
 *
 * Two outputs:
 *   1. dist/trail-chat.js     — full ESM bundle (sourcemap, readable)
 *   2. dist/trail-chat.min.js — minified for production embedding
 *
 * The bundle is a self-contained ESM module — Lit + marked + the
 * component class. No external deps at runtime. Hosts include via
 * <script type="module" src="https://widget.trailmem.com/v1/trail-chat.js">
 * and then drop <trail-chat ...> into their HTML.
 *
 * Versioned URLs (/v1/, /v2/) mean breaking changes don't break
 * embedded sites — old hosts keep pointing at v1, new hosts opt-in
 * to v2 by changing the script src.
 */
export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: 'src/trail-chat.ts',
      formats: ['es'],
      fileName: () => 'trail-chat.js',
    },
    rollupOptions: {
      // Bundle everything; the embed should pull a single file.
      external: [],
      output: {
        // Output dir is `dist/`; we also generate `trail-chat.min.js`
        // via a second rollup output pipe below.
        inlineDynamicImports: true,
      },
    },
    sourcemap: true,
    minify: false,
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 3050,
    open: '/',
  },
});
