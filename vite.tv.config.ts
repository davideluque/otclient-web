import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: ['chrome79', 'es2019'],
    cssTarget: 'chrome79',
    outDir: 'dist-tv',
    modulePreload: false,
    sourcemap: true,
    rolldownOptions: { input: 'jamera.html' },
  },
});
