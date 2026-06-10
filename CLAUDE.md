# CLAUDE.md

## Project

Mobile-friendly Open Tibia 7.6 browser client. TypeScript + PixiJS + Vite.

## Conventions

- Read README.md
- Familiarize with typescript rules and style.
- PRs go through CI (lint + build + test + review gate)
- Gemini and CodeRabbit review PRs automatically — don't trigger manually

## Multi-version protocol architecture

The client is meant to support multiple Tibia protocol versions over time.
Place code accordingly:

- `src/lib/net/7.6/` — anything specific to the 7.6 wire format (opcode
  values, packet layouts, parsers for 7.6 quirks).
- `src/lib/net/common/` — version-agnostic infrastructure (Connection,
  PacketDispatcher, InputPacket/OutputPacket, GameClient, shared types)
  and anything that holds across versions.

When touching protocol code, ask "would an 8.x implementation reuse this
unchanged?" — if not, it belongs under the version folder, reached through
the `GameProtocol` interface rather than imported directly.
