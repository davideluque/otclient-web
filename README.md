# OTClient Web

A mobile-friendly Open Tibia 7.6 client that runs in the browser. The goal: grab your phone, log into Tibia, walk around, and chat — without needing a PC.

## Why

Real Tibia doesn't have a mobile client. The desktop client requires a full setup. We want to open a browser tab on our phone and be in Tibia.

## What it does

This project connects to real Open Tibia 7.6 servers using the original protocol.

## Tech stack

- **TypeScript** + **Vite** for development
- **PixiJS 8** for WebGL rendering
- **Vitest** for testing
- **Node.js** proxy for TCP-WebSocket bridging

## Getting started

```bash
# Requires Node 24 (see .nvmrc)
nvm use
npm install
npm run dev
```

You'll need Tibia 7.6 client files (`.dat`, `.spr`) — these are not included in the repo. Place them in the project root.

## Connecting to an OT server

Browsers can't open raw TCP sockets, so a small WebSocket↔TCP bridge sits
between the client and the OT server. Start it alongside `npm run dev`:

```bash
npm run proxy          # bridges ws://localhost:8090 → 127.0.0.1:7171 (login) / :7172 (game)
```

Some 7.6 servers (e.g. the jamera stack in `docker/`) serve **login and game
on the same port** 7171. For those, use:

```bash
npm run proxy:jamera   # same as `npm run proxy` but with OT_GAME_PORT=7171
```

Override the target with env vars when needed: `OT_HOST`, `OT_LOGIN_PORT`,
`OT_GAME_PORT`, `WS_PORT` (see `proxy/server.ts`).

For the container image, `OT_HOST` defaults to `host.docker.internal`. On Linux,
include `--add-host=host.docker.internal:host-gateway` in `docker run`, or set
`OT_HOST` to the OT server container/service name.

## Playing from your phone (same Wi‑Fi)

In dev the client points its bridge at `:8090` of **whatever host loaded the
page**, so once you serve over the LAN there's no URL to hand-edit.

1. Start the bridge and the LAN dev server (two terminals):

   ```bash
   npm run proxy:jamera   # or `npm run proxy` for a two-port server
   npm run dev:lan        # Vite bound to 0.0.0.0 — prints a "Network:" URL
   ```

2. Find your computer's LAN IP (looks like `192.168.x.x`):

   ```bash
   ipconfig getifaddr en0   # macOS (try en1 on Ethernet)
   hostname -I              # Linux
   ```

3. On the phone's browser (same Wi‑Fi), open — replacing `<LAN-IP>`:

   ```text
   http://<LAN-IP>:5173/jamera.html
   ```

   The client derives `ws://<LAN-IP>:8090` for the bridge automatically. Make
   sure the OT server (e.g. the Docker stack) is running, and that your
   firewall permits inbound `5173` and `8090`. To point at a bridge on a
   *different* host, append `?proxy=ws://<other-host>:8090` (honoured only for
   loopback or a host matching the page).

## Project structure

```
src/
  lib/
    dat.ts, spr.ts, atlas.ts        # Asset pipeline
    otb.ts, otbm.ts, nodeTree.ts    # Map file parsers
    otbmParser.ts, otbmWorker.ts    # Map parsing (Web Worker)
    tileMap.ts, tileRenderer.ts     # Map rendering
    creatureRenderer.ts             # Creature sprite pool
    GameWorld.ts                    # Live server-driven world state
    viewport.ts                     # Camera/viewport
    player.ts, input.ts             # Player entity & input
    joystick.ts, keyboard.ts        # Mobile + desktop controls
    pathfinding.ts                  # A* pathfinding
    walkAnimation.ts                # Walk animation
    regionExpansion.ts              # Dynamic map streaming
    outfitColors.ts, outfitTint.ts  # Outfit color tinting
    lighting.ts                     # Day/night ambient lighting
    devControls.ts                  # Dev toggles UI
    fileLoader.ts                   # Asset loading
    BinaryReader.ts                 # Binary parsing utility
    net/                            # Network protocol
      Connection.ts, GameClient.ts
      PacketDispatcher.ts
      InputPacket.ts, OutputPacket.ts
      xtea.ts, opcodes.ts
      loginProtocol.ts, mapParser.ts
      creatureParser.ts, chatProtocol.ts
    chat/                           # Chat UI, state, speech bubbles
      ChatManager.ts, ChatUI.ts
      SpeechBubbleRenderer.ts
  __tests__/                        # Unit tests
proxy/
  server.ts                         # TCP-WebSocket proxy
```

## Contributing

Contributions are welcome! This is an open project. If you're interested in Tibia, mobile gaming, or browser-based game clients, feel free to open an issue or PR.

## License

MIT
