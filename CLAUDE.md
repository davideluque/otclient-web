# CLAUDE.md

## Project

Mobile-friendly Open Tibia 7.6 browser client. TypeScript + PixiJS + Vite.

## Commands

```bash
nvm use          # Node 24
npm install
npm run dev      # Vite dev server
npm run build    # tsc + vite build
npm run lint     # eslint
npm test         # vitest (177 tests)
npm run proxy    # TCP-WebSocket proxy for OT server
```

## Architecture

```
src/lib/           # Core modules
  dat.ts spr.ts    # Tibia 7.6 file parsers (.dat thing types, .spr sprites)
  atlas.ts         # Sprite → GPU texture atlas packing
  otb.ts otbm.ts   # Server file parsers (.otb items, .otbm maps)
  nodeTree.ts      # Shared OTB/OTBM binary node tree reader
  tileMap.ts       # Spatial index (server ID → client ID, position lookup)
  tileRenderer.ts  # PixiJS tile rendering with atlas textures
  viewport.ts      # Camera/viewport with pan/zoom
  player.ts        # Player entity, directional creature sprites
  input.ts         # Screen-to-tile conversion, direction computation
  pathfinding.ts   # A* on tile grid with collision flags
  walkAnimation.ts # Smooth tile interpolation (200ms/step)
  GameWorld.ts     # Live server-driven map + creature state
  creatureRenderer.ts # PixiJS creature sprite pool
  BinaryReader.ts  # Little-endian binary parsing utility
  net/             # OT 7.6 protocol stack
    InputPacket.ts OutputPacket.ts  # Binary packet read/write
    xtea.ts        # XTEA cipher (32 rounds)
    opcodes.ts     # Client/server opcodes
    loginProtocol.ts  # Login/game login packets + char list
    mapParser.ts   # Map description packet parser
    creatureParser.ts # Creature event parsers
    chatProtocol.ts   # Chat message parse/build
    Connection.ts  # WebSocket with packet framing + XTEA
    PacketDispatcher.ts # Opcode → handler routing
    GameClient.ts  # Login flow state machine
  chat/
    ChatManager.ts # Channel routing, speech bubbles
    ChatUI.ts      # HTML bottom-sheet chat interface
    SpeechBubbleRenderer.ts # PixiJS text above creatures
proxy/server.ts    # Node.js TCP↔WebSocket bridge
```

## Conventions

- No TypeScript enums — use `as const` objects (erasableSyntaxOnly)
- Tests in `src/__tests__/` using synthetic binary data builders
- Tibia data files (.dat, .spr, .otb, .otbm) are gitignored
- PRs go through CI (lint + build + test + 5-min review gate)
- Gemini and CodeRabbit review PRs automatically — don't trigger manually

## Linear

Project: Tibia Mobile (Norden IT workspace, key: NDIT)
Supervisor: David (ping on Linear with progress updates)
