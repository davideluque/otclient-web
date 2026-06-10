# scripts/

## e2e-mock-server.mjs

End-to-end check of the full client stack against the mock 7.6 server —
login → character select → in-game world → walking → chat round-trip —
in headless Chromium. Asserts zero unhandled opcodes along the way.

Prerequisites (all local, nothing in CI yet):

```bash
npx vite --port 5180          # client dev server
npx tsx proxy/server.ts       # WS↔TCP proxy on :8090
npx tsx proxy/mockOtServer.ts # mock login/game server on :7171/:7172
# assets present in public/assets/760/ (gitignored)

# playwright-core installed somewhere importable, plus a chromium build:
PW_CHROME=~/.cache/ms-playwright/chromium-*/chrome-linux/chrome \
  node scripts/e2e-mock-server.mjs
```

Exits non-zero with the tail of the browser console on any failure;
prints PASS and writes a screenshot (E2E_SHOT, default /tmp/e2e-jamera.png)
on success.
