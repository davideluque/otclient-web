# Extended aware range — killing the portrait black bands (NDIT-205)

Portrait phones show black above and below the player because the 7.6
protocol's aware window is **hardcoded server-side** and shaped for a
landscape CRT: the client never requests a size, the server just sends
`18×14` tiles around the player (`Map::maxClientViewportX = 8`,
`maxClientViewportY = 6` → width `2·8+2`, height `2·6+2`; the literals
are copied into every `GetMapDescription` call in protocol76.cpp).
With the player centered, the *guaranteed* symmetric core is 17×13.

The math on a 19.5:9 phone in portrait: at the current 11-tile play
width, `rowsVisible = 11 × (844/390) ≈ 23.8` — against 13 guaranteed
rows. ~5 rows of black at top and bottom, filled only by tiles
accumulated while walking. No client-side change can fix this; the
data does not exist.

## Target v1

| knob | today | proposed |
|---|---|---|
| server `maxClientViewportY` | 6 | **11** (window 18×24, guaranteed 17×23) |
| server `maxClientViewportX` | 8 | 8 (unchanged — landscape already covered) |
| server `maxViewportY` (spectator band) | 11 | **13** (min is clientY+1; keep slack) |
| client portrait play width | 11 tiles | **10 tiles** (→ 21.7 rows visible ≤ 23 guaranteed) |

Landscape needs nothing: 17 guaranteed columns at 17-across zoom gives
`17 × (9/19.5) ≈ 7.8` visible rows ≤ 13.

Cost: login/teleport/floor-change descriptions grow 14→24 rows
(×1.71 tiles); east/west step slices grow the same; north/south slices
are unchanged (18 wide). Spectator events cover a taller band (more
creature-move traffic near the player). All acceptable on a private
server; measure with the metrics overlay after deploy.

## Server changes (jameraServer76, own git repo, docker build.sh)

1. `map.h`: bump the two constants above.
2. `protocol76.cpp`: replace every hardcoded `18, 14`, `x − 8`, `y − 6`
   (and the floor-change/slice variants at ~2168–2181, 2400,
   MoveUp/MoveDownCreature) with expressions of
   `Map::maxClientViewport*` so this can never drift again.
3. `canSee(const Position&)` in protocol76.cpp: the delta check
   (9/7 today) must widen with the window, or updates at the new edge
   rows are silently dropped.
4. Check `NETWORKMESSAGE_MAXSIZE` headroom: the full login description
   grows ×1.71 (worst case 18×24×8 = 3,456 tile slots vs 2,016 today).
5. Gameplay review: monster aggro/targeting uses its own ranges — only
   `getSpectators` callers that default to `maxClientViewport*` widen.

## Client changes (this repo)

Single source of truth: an `AwareRange` value (`left 8, right 9,
top 11, bottom 12`) carried on the `GameProtocol` interface, replacing
the scattered constants — vanilla 7.6 keeps `8/9/6/7`. The value is
fixed per session: the 0x33 confirmation arrives after the login ack
and before the first 0x64 map description, so it is set exactly once,
before any consumer reads it — no mid-session mutation, and downstream
code (renderer windows, slice bounds, parse dims) reads it lazily per
frame/packet anyway. Touch points:

- `jamera/region.ts` `HALF_W_LEFT/RIGHT/H_TOP/BOTTOM` (feeds renderer
  paint windows, occlusion + light regions — all already derive).
- `GameWorld.visibleSliceAfterPlayerMove` (already uses the constants)
  and `handleFloorChange`'s literal `18, 14` parse dims.
- `jamera/viewport.ts`: `GUARANTEED_TILES_Y` derives; portrait target
  10 across.
- Wire tests: parametrize the description fixtures by AwareRange.

## Deploy — order matters

A range mismatch is not cosmetic: skip counts misalign the whole map
stream. Two options:

- **v1 (recommended): client announces, server confirms.** The client
  appends one capability byte to its (fixed-length) 7.6 login packet;
  an old server parses its known fields and never looks at trailing
  bytes, so this is invisible to vanilla. A server with
  `extendedAwareRange = true` that SEES the flag replies with one
  custom packet (unused opcode `0x33: u8 width, u8 height`) after the
  login ack, before the first 0x64, and uses the extended window for
  that session only. Every pairing is safe: old client + new server →
  no flag → vanilla range, no 0x33; new client + old server → flag
  ignored, no 0x33 → client stays at its 18×14 default. Deploy order
  is fully flexible (review catch: a server that sent 0x33
  unconditionally would crash old clients on the unknown opcode).
- v0 (rejected): lockstep hardcode on both sides — one missed deploy
  bricks the map stream for everyone.

## Rollout

1. Client PR: AwareRange plumbing, the login capability byte, and 0x33
   parsing (default vanilla — zero behavior change until the server
   opts in).
2. Server branch: constants + parametrized protocol76 + 0x33 sender
   behind `extendedAwareRange` (default off). Build via docker
   `build.sh` (~100 s restart; qemu amd64).
3. Flip config on Jamera, verify portrait on-device, watch the walk
   metrics overlay for regression.
