import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

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
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name.includes('extractor')) return 'content/extractor.js'
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
  plugins: [
    crx({ manifest }),
  ],
})
