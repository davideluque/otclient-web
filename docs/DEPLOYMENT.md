# Deploying OTClient Web

This guide covers how to get the app running so you can test it on your phone.

## Quick start (local development)

```bash
# 1. Clone and install
git clone git@github.com:davideluque/otclient-web.git
cd otclient-web
nvm use  # Node 24
npm install

# 2. Start the dev server
npm run dev
```

Vite will print a local URL (e.g., `http://localhost:5173`).

### Access from your phone (same Wi-Fi)

Vite exposes a network URL. Start it with `--host`:

```bash
npx vite --host
```

This prints something like:

```
  Local:   http://localhost:5173/
  Network: http://192.168.1.42:5173/
```

Open the **Network** URL on your phone's browser. Both devices must be on the same Wi-Fi.

## Deploying to the internet

### Option 1: Vercel (easiest)

1. Push to GitHub (already done)
2. Go to [vercel.com](https://vercel.com), sign in with GitHub
3. Import the `otclient-web` repo
4. Framework: **Vite** (auto-detected)
5. Click Deploy

Vercel gives you a URL like `otclient-web.vercel.app`. Open it on your phone.

### Option 2: Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy dist --project-name otclient-web
```

### Option 3: GitHub Pages

Add to `.github/workflows/ci.yml`:

```yaml
  deploy:
    runs-on: ubuntu-latest
    needs: check
    if: github.ref == 'refs/heads/main'
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci && npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - uses: actions/deploy-pages@v4
        id: deployment
```

Then enable Pages in repo Settings → Pages → Source: GitHub Actions.

### Option 4: Any static host

```bash
npm run build
# Upload the `dist/` folder to any static file host
```

The built app is fully static — no server needed for the client itself.

## Setting up the WebSocket proxy

The proxy is needed **only** for connecting to an OT server (online play). It's not needed for offline map viewing.

### Run locally

```bash
# Terminal 1: Start the proxy
npm run proxy

# Or with custom settings:
OT_HOST=your-ot-server.com OT_LOGIN_PORT=7171 OT_GAME_PORT=7172 npm run proxy
```

### Run with Docker

```bash
docker build -f proxy/Dockerfile -t otclient-proxy .
docker run -p 8090:8090 -e OT_HOST=your-ot-server.com otclient-proxy
```

### Deploy the proxy

The proxy needs to run on a server that can reach your OT server via TCP. Options:

- **VPS**: Run the Docker container on a cheap VPS (Oracle free tier, Hetzner, etc.)
- **Same machine as OT server**: Run alongside TFS

The client connects to the proxy via WebSocket, so the proxy URL must be accessible from the phone's browser.

## Testing on your phone

### Offline map viewing (no server needed)

1. Deploy or run the dev server (see above)
2. Open the URL on your phone
3. Tap "Drop files here" (or use the file picker)
4. Select your Tibia 7.6 files: `Tibia.dat`, `Tibia.spr`, `items.otb`, and a `.otbm` map file
5. The map renders — pan by dragging, zoom by pinching

### Online play (needs OT server + proxy)

1. Set up a TFS 7.6 server
2. Start the WebSocket proxy pointing to the OT server
3. Deploy the client (the client needs to be modified to show a login form — currently it only has the file loader UI)

> **Note:** The online play integration is not yet wired into the main UI. The modules (GameClient, GameWorld, creature renderer) are built and tested but need to be connected to the main app's render loop. This is tracked in NDIT-140.

## Getting Tibia 7.6 files

You need these files from a Tibia 7.6 client:

| File | Description | Where to find |
|------|-------------|---------------|
| `Tibia.dat` | Item/creature/effect definitions | Tibia 7.6 client folder |
| `Tibia.spr` | Sprite pixel data | Tibia 7.6 client folder |
| `items.otb` | Server item type mapping | OT server `data/` folder |
| `*.otbm` | Map file | OT server `data/world/` folder |

Search for "Tibia 7.6 client download" on OTLand forums. The `.otb` and `.otbm` files come from your OT server's data directory.

## Add to home screen (PWA)

Once the app is deployed to a URL:

- **iOS Safari**: Open the URL → Share → "Add to Home Screen"
- **Android Chrome**: Open the URL → Menu → "Add to Home Screen" or "Install App"

The app includes a PWA manifest so it launches in standalone mode (no browser chrome).
