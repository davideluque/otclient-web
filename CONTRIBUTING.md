# Contributing

Thanks for your interest in OTClient Web! Here's how to get started.

## Setup

```bash
nvm use        # Node 24 (see .nvmrc)
npm install
npm run dev    # Start Vite dev server
```

You'll need Tibia 7.6 client files (`.dat`, `.spr`) to test map rendering. These are not included in the repo.

## Development workflow

1. Create a branch from `main`
2. Write code + tests
3. Run `npm test` and `npm run build` to verify
4. Open a PR against `main`
5. CI runs lint, build, and tests automatically
6. AI reviewers (Gemini, CodeRabbit) will post feedback
7. Address review comments, then merge when CI is green

## Code style

- TypeScript strict mode (`erasableSyntaxOnly` — no enums, use `as const` objects)
- ESLint with typescript-eslint
- 2-space indentation (see `.editorconfig`)
- No `any` types — use proper typing or `unknown`

## Testing

Tests use Vitest and live in `src/__tests__/`. Binary parsers are tested with synthetic data builders (no real Tibia files needed).

```bash
npm test           # Run once
npm run test:watch # Watch mode
```

## Project structure

- `src/lib/` — Core modules (parsers, renderers, game logic)
- `src/lib/net/` — Network protocol (packets, XTEA, login, parsers)
- `src/lib/chat/` — Chat system (manager, UI, speech bubbles)
- `src/__tests__/` — Unit tests
- `proxy/` — TCP-WebSocket proxy for OT server connectivity

## What to work on

Check the [Linear project](https://linear.app/norden-it/project/tibia-mobile-d287444a39f6) for open issues, or open a new one if you have ideas.

Areas that need help:
- End-to-end testing with a real OT 7.6 server
- Outfit color mask rendering (creature color customization)
- Multi-tile sprite rendering (large objects like trees)
- Performance profiling and optimization
- Mobile touch gesture refinement
