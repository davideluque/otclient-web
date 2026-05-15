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

To connect to an OT server, start the proxy:

```bash
npm run proxy
```

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
