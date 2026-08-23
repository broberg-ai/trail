import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config.json'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: 'popup.html',
        // F208.2 — the extractor is no longer a declared content script (it used
        // to register on EVERY page at document_idle), so crxjs no longer derives
        // it from the manifest. It is built here and injected on click via
        // chrome.scripting.executeScript, which is what activeTab is for.
        extractor: 'src/content/extractor.ts',
      },
      // F208 — no content hashes. A hash in a filename exists to bust an HTTP
      // cache; an extension is loaded from disk and has none, so the hash buys
      // nothing and costs stable paths: every rebuild renames the files, which
      // makes a build diff unreadable and any fixed path (docs, tests, the
      // injected extractor) a moving target. Stable names make a rebuild an
      // overwrite in place.
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name.includes('extractor')) return 'content/extractor.js'
          return 'assets/[name].js'
        },
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [
    crx({ manifest }),
  ],
})
