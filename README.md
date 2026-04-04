# OTClient Web

A mobile-friendly Open Tibia 7.6 client that runs in the browser. The goal: grab your phone, log into Tibia, walk around, and chat — without needing a PC.

## Why

Real Tibia doesn't have a mobile client. The desktop client requires a full setup. We want to open a browser tab on our phone and be in Tibia.

## What it does

This project connects to real Open Tibia 7.6 servers using the original protocol. It uses authentic Tibia 7.6 assets (.dat, .spr) for rendering — no recreated sprites, no custom content.

## Current state

The foundation is built. All core modules are implemented and tested:

**Asset Pipeline** — Parse Tibia 7.6 data files and prepare GPU textures
- `.dat` parser (thing type definitions: items, creatures, effects, missiles)
- `.spr` parser (sprite pixel data with RLE decompression)
- Texture atlas generator (decoded sprites packed into GPU-ready pages)

**Map Rendering** — Load and display real Tibia maps
- `.otb` parser (server item ID to client ID mapping)
- `.otbm` parser (map tile areas, positions, item stacks)
- Tile renderer with PixiJS (ground + item layering)
- Viewport with pan/zoom

**Player Movement** — Local tap-to-walk with pathfinding
- Player entity with directional sprite lookup
- Screen-to-tile coordinate conversion
- A* pathfinding respecting collision flags
- Smooth walk animation (200ms per tile)

**OT 7.6 Protocol** — Full network stack for server connectivity
- Binary packet reader/writer
- XTEA encryption
- TCP-WebSocket proxy (browsers can't do raw TCP)
- Login sequence (account login, character list, game login)
- Map description packet parser
- Creature event parsers (move, turn, health, outfit, speed)

**Chat System** — Protocol and state management
- Parse/build all message types (Say, Channel, Private, Whisper, Yell)
- Chat manager with channel routing and speech bubbles

## Tech stack

- **TypeScript** + **Vite** for development
- **PixiJS 8** for WebGL rendering
- **Vitest** for testing (160 unit tests)
- **Node.js** proxy for TCP-WebSocket bridging

## Getting started

```bash
# Requires Node 24 (see .nvmrc)
nvm use
npm install
npm run dev
```

You'll need Tibia 7.6 client files (`.dat`, `.spr`) — these are not included in the repo. Place them in the project root.

To connect to an OT server, start the proxy:

```bash
npm run proxy
```

## Project structure

```
src/
  lib/
    dat.ts, spr.ts, atlas.ts     # Asset pipeline
    otb.ts, otbm.ts, nodeTree.ts  # Map file parsers
    tileMap.ts, tileRenderer.ts   # Map rendering
    viewport.ts                   # Camera/viewport
    player.ts, input.ts           # Player entity & input
    pathfinding.ts                # A* pathfinding
    walkAnimation.ts              # Walk animation
    BinaryReader.ts               # Binary parsing utility
    net/                          # Network protocol
      InputPacket.ts, OutputPacket.ts
      xtea.ts, opcodes.ts
      loginProtocol.ts, mapParser.ts
      creatureParser.ts, chatProtocol.ts
    chat/
      ChatManager.ts              # Chat state management
  __tests__/                      # 160 unit tests
proxy/
  server.ts                       # TCP-WebSocket proxy
```

## Next steps

- Wire all modules into a working browser app (file loading, game loop, touch controls)
- Live server connection with real-time map updates
- Chat UI with mobile-friendly bottom sheet
- Speech bubbles above players

## Contributing

Contributions are welcome! This is an open project. If you're interested in Tibia, mobile gaming, or browser-based game clients, feel free to open an issue or PR.

## License

MIT
