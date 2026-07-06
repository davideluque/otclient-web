# Multi-floor rendering + roof culling

The game renderer draws exactly one floor (`world.playerZ`) while GameWorld
already stores every floor the server sends. This plan adds classic Tibia
floor visibility. Sources: the Jamera server source (aware-range rules,
[VERIFIED] below), OTClient's mapview algorithm ([RECONSTRUCTED]), the
merged offline-viewer work (PR #82 — floors-below with FullGround
occlusion, live in `src/main.ts:369-448`), and the closed roof-culling PoC
(PR #111, salvaged as pure modules).

## The rules

### Aware vs draw range

- Server sends ([VERIFIED] protocol76.cpp:819-850): above ground (z ≤ 7)
  all 8 surface floors 7..0; underground floors z−2..min(15, z+2) — note
  z=8 receives floors 6..10, including two surface floors.
- Client draws: `last = (z ≤ 7) ? 7 : min(z+2, 15)`;
  `first = roofProbe(base)` where `base = 0` above ground,
  `max(z−2, 8)` underground (the surface floors received at z=8 are
  stored but never drawn underground). Draw `last → first`, deepest
  first. Holes above ground never show underground floors (canSee gates
  them server-side anyway).

### Roof probe (indoors detection) — from the PoC + OTClient

Probe the player tile plus the 4 orthogonal neighbors (only those that
are look-possible: no BlockProjectile thing; diagonals never probed).
For each, walk two chains upward in lockstep — physically above (0,0,−1)
and perspective-above (+1,+1,−1) — until a tile "covers":
`limitsFloorsView(freeView)` = first stack thing exists, lacks
`DontHide`, and has `Ground` (or `OnBottom`, gated by freeView/
BlockProjectile). Roof found at z=R → draw only z ≥ R+1. The freeView
polarity at the two call sites is [UNCERTAIN]; the degraded-safe form is
`freeView = true` (slightly aggressive hiding — early-OTClient behavior).
Anti-flicker during glides: compute the probe for BOTH walk endpoints and
take `max(firstVisible)` (PoC commit fabe172).

### Screen placement — two empirically-validated conventions

- **Floors below the player: raw world coordinates, no per-z screen
  offset.** Learned the hard way in the multifloor branch (commit 988f86d:
  the +32px/z SE offset put stairs one tile off). The 2.5D illusion comes
  entirely from tall sprites drawing their upper halves 32px up.
- **Floors above the player: iso offset `(z − playerZ) · TILE_SIZE` on
  both axes.** Learned in the PoC (commit 3691ea3: without it multi-story
  buildings collapse into a flat silhouette).
- The asymmetry is empirical, on-device validated per direction; treat it
  as the spec until proven otherwise.

### Occlusion + perf policy

Naive 8-floor rebuilds ≈ 3,840 tile slots per hysteresis crossing — too
much for phones. Policy:

1. **Cap floors below at 3** (offline-viewer precedent) — with the roof
   probe capping floors above naturally.
2. **Cascading FullGround occlusion** (merged #82 mechanism): per-depth
   occlusion sets, computed shallow→deep, snapshotted before rendering
   (mutating during the loop wrongly hides shallower floors — lesson
   e66e78c), bit-packed `(x<<16)|y` keys, consumed by `renderTileRegion`'s
   existing `skipPositions` param. In town, floor 7 occludes nearly
   everything below.
3. **Per-floor containers + per-floor dirty tracking**: split the global
   `tileRevision` into per-z revisions so the 300ms-throttled revision
   path rebuilds only touched floors. `movedFar`/`zChanged` still rebuild
   all drawn floors.
4. FullGround-only occlusion — never broaden to `Ground` (hid stairs,
   lesson c0c30cc/55e894c). Black gaps at walls on lower floors are
   correct classic behavior.

### Layer order per frame

For z = deepest → shallowest: tiles(z), then creatures(z). Above all
floors: light overlay (gathering light sources from every drawn z — one
merged pass, not per-floor), then effects/combat-text/bubbles (playerZ
semantics unchanged in v1). No per-floor darkening — classic 7.6 draws a
floor at full brightness or not at all; darkness comes from the light
system.

## PR map (stacked)

1. `feat/multifloor-plan` — this document.
2. `feat/multifloor-visibility` — pure `floorVisibility.ts`: draw-range +
   roof probe over `getTile`+`datIndex` (salvage PR #111's module and
   tests; upgrade the covering predicate to limitsFloorsView).
3. `feat/multifloor-world` — GameWorld support: per-z tile revisions,
   `hasFullGround` probe, pure cascade occlusion-set builder + tests.
4. `feat/multifloor-below` — renderer: per-floor containers for playerZ
   and up to 3 floors below, occlusion, per-floor dirty rebuilds.
   Creatures stay playerZ-only here.
5. `feat/multifloor-above` — floors above + roof probe wiring + walk-
   endpoint max + iso offset. The headline: roofs appear, and vanish when
   you step indoors.
6. `feat/multifloor-creatures` — creatures/nameplates on all drawn floors
   (per-floor passes), rAF keep-alive across floors.
7. `feat/multifloor-light` — light overlay gathers all drawn floors
   (`zs` param through buildIlluminationOverlay/gatherLights), creature
   lights across floors, changelog.

## Non-goals (v1)

Per-floor alpha fading (modern OTClient addition), effects/bubbles on
non-player floors, tile-level partial rebuilds (#85 — separate track),
offline-viewer changes (it already has its own floors-below).
