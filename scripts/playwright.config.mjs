import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const mockPorts = { OT_LOGIN_PORT: '17171', OT_GAME_PORT: '17172' };

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  testMatch: process.env.TV_SMOKE === '1' ? 'e2e-controller.mjs' : 'e2e-*.mjs',
  outputDir: '../test-results',
  use: {
    baseURL: 'http://127.0.0.1:15180',
    viewport: { width: 1100, height: 700 },
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PW_CHROME, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] },
  },
  webServer: [
    {
      command: 'npm exec -- tsx proxy/mockOtServer.ts',
      cwd: root,
      env: mockPorts,
      port: 17172,
    },
    {
      command: 'npm run proxy',
      cwd: root,
      env: { ...mockPorts, OT_HOST: '127.0.0.1', WS_PORT: '18090' },
      port: 18090,
    },
    {
      command: process.env.TV_SMOKE === '1'
        ? 'npm exec -- vite preview --config vite.tv.config.ts --host 127.0.0.1 --port 15180 --strictPort'
        : 'npm run dev -- --host 127.0.0.1 --port 15180 --strictPort',
      cwd: root,
      url: 'http://127.0.0.1:15180/jamera.html',
    },
  ],
});
