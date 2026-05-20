import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Multi-page setup: `index.html` is the offline-OTBM demo; `jamera.html`
 * is the Phase 2 jamera-login scaffold. Without explicit input entries
 * Vite only bundles `index.html`, so the production build would 404 on
 * the jamera page even though it works under `npm run dev`.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        jamera: resolve(__dirname, 'jamera.html'),
      },
    },
  },
});
