## Mock-server browser test

Run the same Chromium check as CI from the repository root with the project's Node version.

```sh
npm ci
npx playwright install --with-deps --only-shell chromium
npm run test:e2e
```

Playwright starts and stops Vite (15180), the WebSocket proxy (18090), and the mock login and game servers (17171 and 17172). Keep these ports free. The browser loads the regular 7.6 asset manifest and receives two generated solid-color sprites and their matching DAT and OTB data. It needs no downloaded game assets.

The test checks character selection, the rendered map, server-confirmed keyboard movement, a chat echo and its speech bubble. Unhandled opcodes and uncaught page errors fail the run. Screenshots are written beneath `test-results/`. Set `E2E_SHOT` to choose a different success screenshot path or `PW_CHROME` to use an existing Chromium executable.
