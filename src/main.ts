import { Application, Container } from 'pixi.js';
import { parseDat, DatAttr } from './lib/dat';
import { parseSpr, releaseSprBuffer } from './lib/spr';
import { parseOtb } from './lib/otb';
import { OtbmAttr, OtbmNode, parseOtbmRegion } from './lib/otbm';
import { OtbmParser } from './lib/otbmParser';
import { NODE_END, NODE_START, readNodeData, skipNode } from './lib/nodeTree';
import { buildAtlasPages, collectReferencedSpriteIds, computeAtlasLayout } from './lib/atlas';
import { TileMap } from './lib/tileMap';
import type { Bounds, FloorChange } from './lib/tileMap';
import { createAtlasTextures, renderTileRegion, renderPlayer, buildDatIndex, TILE_SIZE } from './lib/tileRenderer';
import type { AnimatedSprite, TintedTextureCache } from './lib/tileRenderer';
import { Viewport, computePlayZoom } from './lib/viewport';
import type { ViewRect } from './lib/viewport';
import { buildCreatureIndex, createPlayer } from './lib/player';
import type { PlayerState } from './lib/player';
import { screenToTile, stepInDirection } from './lib/input';
import { findPath, isTileWalkable } from './lib/pathfinding';
import { startWalk, updateWalk } from './lib/walkAnimation';
import type { WalkState } from './lib/walkAnimation';
import { createJoystick } from './lib/joystick';
import { createKeyboard } from './lib/keyboard';
import { createDevControls } from './lib/devControls';
import { Direction } from './lib/player';
import {
  buildIlluminationOverlay,
  createLightMaskTexture,
  NIGHT_AMBIENT,
  DAY_AMBIENT,
  type LightingOptions,
} from './lib/lighting';
import { createFileLoader } from './lib/fileLoader';
import type { RenderTexture } from 'pixi.js';
import type { DatFile } from './lib/dat';
import type { SprFile } from './lib/spr';
import type { OtbFile } from './lib/otb';
import type { OtbmFile, OtbmRegion, Position } from './lib/otbm';
import type { CompleteLoadedFiles } from './lib/fileLoader';
import { needsExpansion, needsExpansionForDestination } from './lib/regionExpansion';

// --- File loading UI ---

const INITIAL_REGION_RADIUS = 200;
const dropZone = document.getElementById('drop-zone')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const statusEl = document.getElementById('status')!;
const fileListEl = document.getElementById('file-list')!;
const loaderEl = document.getElementById('loader')!;

function setStatus(msg: string, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'error' : '';
}

function addFileToList(name: string) {
  const li = document.createElement('li');
  li.textContent = name;
  fileListEl.appendChild(li);
}

const handleFiles = createFileLoader({
  setStatus,
  addFileToList,
  startApp,
  onError: console.error,
});

// Drag and drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
});

// Click to open file picker
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files) handleFiles(fileInput.files);
});

// --- App startup ---

async function startApp(loaded: CompleteLoadedFiles) {
  const dat: DatFile = parseDat(loaded.dat);
  setStatus('Parsed .dat...');

  const spr: SprFile = parseSpr(loaded.spr);
  setStatus('Parsed .spr...');

  const otb: OtbFile = parseOtb(loaded.otb);
  setStatus('Parsed .otb...');

  // Pass 1: parse only the towns list. A radius-0 region skips every
  // TileArea, so the parser emits header + towns metadata — enough to
  // pick a spawn before we pay for tile data.
  const metadataRegion: OtbmRegion = { centerX: 0, centerY: 0, radius: 0, z: 7 };
  const metadata: OtbmFile = parseOtbmRegion(loaded.otbm, metadataRegion);

  // Pick the spawn: caller override (future server hook) → Rookgaard town
  // (the canonical Tibia 7.6 starting point) → first town the map declares
  // → first tile we can find by scanning.
  const pickedSpawn = pickSpawn(metadata) ?? findFirstTile(loaded.otbm);
  if (!pickedSpawn) {
    console.warn('OTBM declares no towns and findFirstTile found nothing — spawning at (0, 0, 7). Map is probably empty or has an unusual structure.');
  }
  const spawn: Position = pickedSpawn ?? { x: 0, y: 0, z: 7 };

  // Spin up the OTBM worker and transfer ownership of the raw buffer.
  // From here on, the main thread no longer holds the .otbm bytes —
  // every parse goes through otbmParser. (The metadata + findFirstTile
  // passes above ran synchronously before the transfer, when the
  // buffer was still here.)
  const otbmParser = new OtbmParser();
  otbmParser.setBuffer(loaded.otbm);

  const initialRegion: OtbmRegion = regionAround(spawn);
  const otbm: OtbmFile = await otbmParser.parseRegion(initialRegion);
  setStatus(`Loaded ${otbm.tiles.length} tiles around (${spawn.x}, ${spawn.y})`);

  setStatus('Building texture atlas...');
  const referencedSpriteIds = collectReferencedSpriteIds(dat);
  const atlasPages = buildAtlasPages(spr, referencedSpriteIds);
  releaseSprBuffer(spr);
  const atlasTextures = createAtlasTextures(atlasPages);
  const layout = computeAtlasLayout(spr.spriteCount, referencedSpriteIds);
  const datIndex = buildDatIndex(dat);
  const atlasBytes = [...atlasPages.values()].reduce((sum, page) => sum + page.byteLength, 0);
  console.log(`Atlas CPU buffers: ${(atlasBytes / 1024 / 1024).toFixed(1)} MB across ${atlasPages.size} page(s)`);

  setStatus('Building tile map...');
  const tileMap = new TileMap(otbm, otb);
  setStatus(`Loaded ${tileMap.size} tiles around (${spawn.x}, ${spawn.y})`);

  const creatureIndex = buildCreatureIndex(dat);
  const player: PlayerState = createPlayer(
    spawn.x,
    spawn.y,
    spawn.z,
    // Default outfit: lookType 128 (citizen). Brown + blue look —
    // tuning the exact palette indices is tracked in issue #57.
    //   58 → (191, 106, 64)   medium brown
    //   87 → (0, 85, 255)     Tibia shirt blue
    { lookType: 128, headColor: 58, bodyColor: 87, legsColor: 58, feetColor: 58 },
  );

  // Initialize PixiJS.
  //
  // Note: deliberately *not* using `resizeTo: window`. On iOS Safari the
  // `resize` event fires on orientation change before `window.innerWidth/
  // innerHeight` have updated, so PixiJS' internal resize handler picks
  // up stale dimensions and leaves a black bar after the rotation
  // completes. We manage resize ourselves below with a two-RAF debounce
  // that gives the browser time to settle before remeasuring.
  // visualViewport (when supported) reports the actually-visible area
  // excluding mobile browser chrome (URL bar, on-screen keyboard); using
  // it for sizing avoids the dropped-strip case where the page is sized
  // to innerHeight but the visible viewport is shorter.
  const initialW = window.visualViewport?.width ?? window.innerWidth;
  const initialH = window.visualViewport?.height ?? window.innerHeight;

  const app = new Application();
  await app.init({
    background: '#000000',
    width: initialW,
    height: initialH,
    antialias: false,
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });

  // Hide loader, show canvas
  loaderEl.style.display = 'none';
  document.body.appendChild(app.canvas);

  // Keep the screen on during gameplay. The Wake Lock API prevents the
  // device from sleeping — essential for a mobile game PWA. Supported on
  // Chrome/Edge Android and Safari iOS 16.4+ in standalone mode. Falls
  // back silently on unsupported browsers. Re-acquired on visibility
  // change because the lock is automatically released when the tab is
  // backgrounded.
  let wakeLock: WakeLockSentinel | null = null;
  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; }, { once: true });
    } catch {
      // Permission denied or not supported — silently ignore.
    }
  }
  requestWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  const viewport = new Viewport({
    centerX: spawn.x,
    centerY: spawn.y,
    screenWidth: initialW,
    screenHeight: initialH,
    playZoom: computePlayZoom(initialW, initialH),
  });
  // Mutable so floor-change tiles (stair/hole/ladder) can update it on
  // step-land; everything that takes a z parameter reads this each frame.
  let renderZ = spawn.z;

  let tileContainer: Container | null = null;
  let lastVisibleKey = '';
  let lastRenderRow = Number.NaN;
  let lastPlayerX = Number.NaN;
  let lastPlayerY = Number.NaN;
  // Track direction so a turn-without-step (e.g. joystick held into a wall)
  // still triggers a rebuild — without this, the sprite would only update
  // when the player actually moves tiles.
  let lastPlayerDirection = Number.NaN;
  let ambient: LightingOptions = NIGHT_AMBIENT;
  let illuminationTexture: RenderTexture | null = null;
  let animatedSprites: AnimatedSprite[] = [];
  // Reference to the player Container currently in tileContainer, so the
  // walk ticker can move it mid-step without waiting for a tile rebuild.
  let currentPlayerSprite: Container | null = null;
  let walkState: WalkState | null = null;
  // The most recently computed walk offset (pixels). Cached so rebuildTiles
  // and the walk ticker share one source of truth — avoids duplicating the
  // `(to-from) * progress * TILE_SIZE` formula in two places that could
  // drift apart later.
  let lastWalkOffsetX = 0;
  let lastWalkOffsetY = 0;
  const lightMask = createLightMaskTexture();
  // Tinted-outfit cache lives across rebuilds — same outfit + direction
  // re-uses the texture. Cleared on app teardown, never during runtime.
  const tintedOutfitCache: TintedTextureCache = new Map();

  // Row to render the player against. During a south walk we render the
  // player as part of the destination row so its body (which extends into
  // that tile mid-step) isn't painted over by that row's tiles.
  function computeRenderRow(): number {
    if (walkState?.active && walkState.toY > walkState.fromY) {
      return walkState.toY;
    }
    return Math.floor(player.y);
  }

  function rebuildTiles() {
    if (tileContainer) {
      app.stage.removeChild(tileContainer);
      tileContainer.destroy({ children: true });
    }
    if (illuminationTexture) {
      illuminationTexture.destroy(true);
      illuminationTexture = null;
    }

    const visible = viewport.getVisibleTiles();
    lastVisibleKey = `${visible.x1},${visible.y1},${visible.x2},${visible.y2}`;

    // --- Multi-floor rendering (authentic OTClient approach) ---
    // Above ground (z <= 7), render visible floors below at full opacity at
    // the SAME screen position as the current floor (no per-z screen offset).
    // The iso/3D illusion comes purely from tall items: walls and stair tops
    // (height>1) draw their top halves 32px up, poking into the floor above's
    // visual band. FullGround tiles on shallower floors occlude lower floors
    // at the same (tx, ty). Non-FullGround tiles (holes, stair landings)
    // let the lower floor show through directly underneath.
    const MAX_VISIBLE_FLOORS_BELOW = 3;

    // Split tile rendering around the player's row so the player draws on
    // top of items at and north of its tile (floor, decorations, walls
    // behind it) but behind items south (trees, fences). Including the
    // player's own row in `above` means the floor and items on the player's
    // tile draw BEHIND the player sprite — which is what we want.
    const playerRow = computeRenderRow();
    lastRenderRow = playerRow;
    lastPlayerX = player.x;
    lastPlayerY = player.y;
    lastPlayerDirection = player.direction;
    const above = renderTileRegion(
      tileMap, datIndex, atlasTextures, layout,
      visible.x1, visible.y1, visible.x2, Math.min(playerRow, visible.y2), renderZ,
    );
    const below = renderTileRegion(
      tileMap, datIndex, atlasTextures, layout,
      visible.x1, Math.max(playerRow + 1, visible.y1), visible.x2, visible.y2, renderZ,
    );
    tileContainer = new Container();

    // Collect all animated sprites in one pass at the end.
    const allAnimated: typeof animatedSprites = [];

    if (renderZ <= 7) {
      const maxDepth = Math.min(MAX_VISIBLE_FLOORS_BELOW, 15 - renderZ);

      // Cumulative FullGround occlusion: a tile at depth d, position (tx, ty)
      // is occluded if any shallower floor (depth d' < d) has a FullGround
      // item at the SAME (tx, ty). Stair landings, holes, and other
      // non-FullGround tiles let the floor below show through directly.
      const occlusionByDepth: Set<number>[] = [];
      const cumulative = new Set<number>();
      for (let d = 0; d < maxDepth; d++) {
        const floorZ = renderZ + d;
        for (const tile of tileMap.tilesInRegion(
          visible.x1, visible.y1, visible.x2, visible.y2, floorZ,
        )) {
          for (const item of tile.items) {
            const tt = datIndex.get(item.clientId);
            if (tt?.attrs.has(DatAttr.FullGround)) {
              cumulative.add((tile.x << 16) | tile.y);
              break;
            }
          }
        }
        occlusionByDepth.push(new Set(cumulative));
      }

      // Render deep-to-shallow at full opacity, all at the same screen
      // position as the current floor. Tall items (walls, stair tops) on
      // lower floors naturally draw their top halves 32px up — that's the
      // entire isometric/3D effect.
      for (let depth = maxDepth; depth >= 1; depth--) {
        const floor = renderTileRegion(
          tileMap, datIndex, atlasTextures, layout,
          visible.x1, visible.y1, visible.x2, visible.y2, renderZ + depth,
          occlusionByDepth[depth - 1],
        );
        tileContainer.addChild(floor.container);
        allAnimated.push(...floor.animated);
      }
    }
    allAnimated.push(...above.animated, ...below.animated);
    animatedSprites = allAnimated;

    tileContainer.addChild(above.container);
    const playerSprite = renderPlayer(player, creatureIndex, atlasTextures, atlasPages, layout, tintedOutfitCache);
    if (playerSprite) {
      // Apply the current walk offset on creation so a mid-walk rebuild
      // doesn't briefly snap the player back to its rest position before
      // the walk ticker re-applies the offset.
      if (walkState?.active) {
        playerSprite.x = lastWalkOffsetX;
        playerSprite.y = lastWalkOffsetY;
      }
      tileContainer.addChild(playerSprite);
    }
    currentPlayerSprite = playerSprite;
    tileContainer.addChild(below.container);

    if (ambient.enabled) {
      const { sprite, texture } = buildIlluminationOverlay(
        app, tileMap, datIndex, lightMask,
        visible.x1, visible.y1, visible.x2, visible.y2, 7,
        ambient,
      );
      tileContainer.addChild(sprite);
      illuminationTexture = texture;
    }

    app.stage.addChild(tileContainer);
  }

  function updateTransform() {
    if (!tileContainer) return;
    const offset = viewport.getContainerOffset();
    tileContainer.x = offset.x;
    tileContainer.y = offset.y;
    tileContainer.scale.set(viewport.zoom);
  }

  // --- Dynamic region expansion ---
  // Tracks the bounds snapshot from the last expansion attempt that found
  // no new tiles. If bounds haven't grown since, we skip the expensive
  // OTBM re-parse — the file won't have new data in that direction.
  let lastExpansionTime = 0;
  const EXPANSION_COOLDOWN_MS = 500;
  // Track which (bounds + direction) combos yielded no new tiles so we
  // don't rescan the OTBM in that direction again until bounds grow.
  const exhaustedDirections = new Set<string>();

  function expansionKey(b: Bounds | null, region: OtbmRegion): string {
    const bk = b ? `${b.minX},${b.minY},${b.maxX},${b.maxY}` : '';
    return `${bk}@${region.centerX},${region.centerY}`;
  }

  // Pending-expansion flag — the worker is single-threaded and we don't
  // want a backlog of duplicate region parses queued behind it. While
  // one is in flight, tryExpand short-circuits.
  let pendingExpansion = false;

  function tryExpand(visible: ViewRect): void {
    const now = performance.now();
    if (now - lastExpansionTime < EXPANSION_COOLDOWN_MS) return;
    if (pendingExpansion) return;

    const currentBounds = tileMap.getBounds(renderZ);
    const region = needsExpansion(currentBounds, visible, renderZ, 30);
    if (!region) return;

    const ek = expansionKey(currentBounds, region);
    if (exhaustedDirections.has(ek)) return;

    lastExpansionTime = now;
    pendingExpansion = true;
    otbmParser.parseRegion(region).then(expanded => {
      pendingExpansion = false;
      // Baseline captured *here*, right before merge — a concurrent
      // expansion (walk-expand or floor-change-load) may have grown
      // the tilemap during our parse, so taking the snapshot any earlier
      // would risk a stale baseline.
      const sizeBeforeMerge = tileMap.size;
      tileMap.merge(expanded);
      if (tileMap.size > sizeBeforeMerge) {
        exhaustedDirections.clear(); // bounds grew — all directions worth retrying
        console.log('[map] expanded →', tileMap.getBounds(renderZ));
        render(true); // tiles changed; rebuild
      } else {
        exhaustedDirections.add(ek);
      }
    }).catch(err => {
      pendingExpansion = false;
      console.error('[map] expansion failed:', err);
    });
    return;
  }

  function render(forceRebuild = false) {
    const visible = viewport.getVisibleTiles();
    const key = `${visible.x1},${visible.y1},${visible.x2},${visible.y2}`;
    const renderRow = computeRenderRow();

    // Fire-and-forget — if expansion lands, the worker callback will
    // call render(true) on its own. We don't wait here.
    tryExpand(visible);
    if (
      forceRebuild
      || key !== lastVisibleKey
      || renderRow !== lastRenderRow
      || player.x !== lastPlayerX
      || player.y !== lastPlayerY
      || player.direction !== lastPlayerDirection
    ) {
      rebuildTiles();
    }
    updateTransform();
  }

  render(true);

  // Drive item animation (torches, lights, fire). 500 ms per frame matches
  // OTClient's ITEM_TICKS_PER_FRAME for Tibia 7.6-style items (per-phase
  // durations weren't stored in the .dat until ~10.50+). The ticker fires
  // at 60 Hz; skip work on the ~30 frames in a row where the animation
  // frame index hasn't actually advanced.
  const ANIMATION_FRAME_MS = 500;
  let lastFrame = -1;
  app.ticker.add(() => {
    if (animatedSprites.length === 0) return;
    const frame = Math.floor(performance.now() / ANIMATION_FRAME_MS);
    if (frame === lastFrame) return;
    lastFrame = frame;
    for (const a of animatedSprites) {
      const phase = frame % a.texturesByPhase.length;
      const tex = a.texturesByPhase[phase];
      if (tex && a.sprite.texture !== tex) a.sprite.texture = tex;
    }
  });

  // --- Mobile joystick ---
  // A virtual joystick for touch devices. While held, it drives the player
  // in the indicated cardinal direction one tile at a time; releasing it
  // lets the current step finish and stop. Hidden on desktop (fine pointer).
  let joystickDir: Direction | null = null;
  const joystick = createJoystick({
    onChange: (dir) => { joystickDir = dir; },
  });
  // `pointer: coarse` excludes mouse-driven desktop browsers (which match
  // `pointer: fine`) while matching phones and touch tablets in any
  // orientation — so the joystick appears wherever touch input is the
  // primary model and stays hidden on desktop.
  const joystickQuery = window.matchMedia('(pointer: coarse)');
  const applyJoystickVisibility = () => joystick.setVisible(joystickQuery.matches);
  applyJoystickVisibility();
  joystickQuery.addEventListener('change', applyJoystickVisibility);

  // --- Floor changes ---
  // Apply the geometry of an OTB FloorChange* flag to player + camera +
  // tilemap. Geometry mirrors TFS Tile::queryDestination (src/tile.cpp).
  // Up-<dir> goes to z-1 with a one-tile shift in <dir> on the new floor
  // and the player faces that direction; down is z+1 with an *inverse*
  // shift when the destination tile is itself a directional up-stair
  // (the partner side of a bidirectional stair) so the player doesn't
  // land on top of it and instantly re-trigger going back up.
  // Guard for the ~100 ms gap between step-land on a stair and the
  // worker delivering the new floor's tiles. During that gap the held-
  // walk ticker and tap-to-walk would otherwise be free to start new
  // walks on the old floor, which would then be silently overwritten
  // when handleFloorChange resumes. Gated everywhere that *starts* a
  // new walk; existing in-flight walks aren't affected.
  let floorChangeInProgress = false;

  async function handleFloorChange(fc: FloorChange) {
    if (floorChangeInProgress) return; // concurrent calls collapse to one
    floorChangeInProgress = true;
    try {
      // Compute the new (x, y, z) and direction *without* mutating
      // player state yet — we want to wait for tile data before showing
      // the new floor, otherwise a void flash appears for the ~100ms the
      // worker takes to parse.
      let newZ = renderZ;
      let newX = player.x;
      let newY = player.y;
      let newDir = player.direction;
      if (fc === 'down') {
        newZ++;
      } else {
        newZ--;
        if (fc === 'up-north') { newY--; newDir = Direction.North; }
        else if (fc === 'up-east') { newX++; newDir = Direction.East; }
        else if (fc === 'up-south') { newY++; newDir = Direction.South; }
        else if (fc === 'up-west') { newX--; newDir = Direction.West; }
      }

      await ensureLoadedAt(newX, newY, newZ);

      if (fc === 'down') {
        // Bidirectional-stair inverse shift, evaluated against the
        // freshly-loaded destination floor.
        const partner = tileMap.getFloorChange(newX, newY, newZ);
        if (partner === 'up-north') newY++;
        else if (partner === 'up-south') newY--;
        else if (partner === 'up-east') newX--;
        else if (partner === 'up-west') newX++;
      }

      renderZ = newZ;
      player.x = newX;
      player.y = newY;
      player.z = newZ;
      player.direction = newDir;
      exhaustedDirections.clear();
      viewport.centerX = player.x;
      viewport.centerY = player.y;
      render(true);
    } finally {
      floorChangeInProgress = false;
    }
  }

  async function ensureLoadedAt(x: number, y: number, z: number): Promise<void> {
    if (tileMap.getTile(x, y, z)) return;
    const region: OtbmRegion = { centerX: x, centerY: y, radius: 25, z };
    tileMap.merge(await otbmParser.parseRegion(region));
  }

  const onStepLand = (x: number, y: number) => {
    const fc = tileMap.getFloorChange(x, y, renderZ);
    if (!fc) return;
    if (walkState) walkState.path = [];
    handleFloorChange(fc);
  };

  // --- Keyboard input ---
  // Arrow keys + WASD for desktop movement. Toggle bindings (N = night)
  // replace the previous inline keydown handler.
  const keyboard = createKeyboard({
    onToggle: (id) => {
      if (id === 'night') {
        const willBeNight = ambient !== NIGHT_AMBIENT;
        ambient = willBeNight ? NIGHT_AMBIENT : DAY_AMBIENT;
        devControls?.setToggle('Night', willBeNight);
        render(true);
      }
    },
  });

  // --- Walk animation ticker ---
  // Drives the player along its computed A* path. Smoothly interpolates
  // both the player sprite position and the camera so the view follows
  // the player without jitter at tile boundaries.
  app.ticker.add(() => {
    // Joystick: while a direction is held and we're not already walking,
    // kick off a one-tile step in that direction. The ticker fires every
    // frame, so as soon as the current step completes (active goes false)
    // the next iteration starts the next step — that's the held-walk loop.
    // Skipping when the tile is blocked avoids spamming startWalk against a
    // wall: the knob stays "live" but no movement happens.
    // Joystick or keyboard: while a direction is held and we're not
    // already walking, kick off a one-tile step. Joystick takes priority.
    const heldDir = joystickDir ?? keyboard.heldDirection;
    if (heldDir !== null && !floorChangeInProgress && (!walkState || !walkState.active)) {
      const step = stepInDirection(player.x, player.y, heldDir);
      if (isTileWalkable(step.x, step.y, renderZ, tileMap, datIndex)) {
        walkState = startWalk(player, [step], performance.now(), onStepLand);
      } else if (player.direction !== heldDir) {
        // Face the wall even when we can't step through it, for feedback.
        // The ticker is about to return early since no walk is active, so
        // we need to render() ourselves; the new direction-tracking
        // rebuild condition will pick up the change.
        player.direction = heldDir;
        render();
      }
    }

    if (!walkState || !walkState.active) return;
    const offset = updateWalk(walkState, player, performance.now());
    lastWalkOffsetX = offset.offsetX;
    lastWalkOffsetY = offset.offsetY;

    // Smooth camera follow — track the player's interpolated position
    // (player tile + fractional walk offset). Anchoring on player.x/y
    // instead of walkState.fromX/toX means a floor-change-driven
    // teleport inside updateWalk's callback (which mutates player.x/y)
    // doesn't get overwritten by the old walkState's fromX/toX values.
    viewport.centerX = player.x + offset.offsetX / TILE_SIZE;
    viewport.centerY = player.y + offset.offsetY / TILE_SIZE;

    // Render BEFORE applying the offset on the existing sprite. render()
    // may rebuild the tile container (when the visible region key, render
    // row, or player tile changes mid-walk); rebuildTiles picks up
    // lastWalkOffsetX/Y so the freshly-created player container is already
    // at the correct interpolated position when added to the scene graph.
    render();

    if (currentPlayerSprite) {
      currentPlayerSprite.x = offset.offsetX;
      currentPlayerSprite.y = offset.offsetY;
    }
  });

  // --- Touch/mouse controls — tap-to-walk + drag-to-pan ---
  // A tap (small total movement between pointerdown and pointerup) sends
  // the player to the tapped tile via A*. A drag (movement above the
  // threshold) pans the camera as before.

  const TAP_MAX_DISTANCE_PX = 8;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let lastX = 0;
  let lastY = 0;
  let dragMode: 'idle' | 'pending' | 'dragging' = 'idle';
  // Lock the tap-to-walk gesture to a single pointer so a second touch
  // (e.g. pinch-zoom's second finger) or non-primary mouse button can't
  // hijack or terminate it.
  let activePointerId: number | null = null;

  app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    // Primary mouse button only — right/middle clicks must not walk.
    if (e.button !== 0) return;
    // Ignore secondary pointers (pinch second finger, hovering pen tip, etc.).
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
    dragMode = 'pending';
  });

  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    if (dragMode === 'idle') return;
    if (dragMode === 'pending') {
      const totalDx = e.clientX - pointerDownX;
      const totalDy = e.clientY - pointerDownY;
      if (totalDx * totalDx + totalDy * totalDy < TAP_MAX_DISTANCE_PX * TAP_MAX_DISTANCE_PX) return;
      dragMode = 'dragging';
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dragToPanEnabled) {
      viewport.pan(dx, dy);
      render();
    }
  });

  function endGesture() {
    activePointerId = null;
    dragMode = 'idle';
  }

  window.addEventListener('pointerup', async (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    if (dragMode === 'pending') {
      // Was a tap — convert to tile, run A*, start walk. If already walking,
      // plan from the tile we're walking TO and just replace the queued
      // remainder so the current step finishes smoothly — no camera snap.
      // findPath returns null for unreachable targets; in that case clear
      // the queued path so the player stops cleanly at the end of the
      // current step instead of chasing the previous destination.
      const tile = screenToTile(e.clientX, e.clientY, viewport);

      // Anticipatory expansion: if the tap destination is near or outside
      // loaded bounds, expand the map toward it before pathfinding. We
      // await this so findPath sees the merged tilemap below. Reuses
      // exhaustedDirections from viewport expansion to avoid repeated
      // expensive OTBM parses for taps in areas with no data.
      const currentBounds = tileMap.getBounds(renderZ);
      const destRegion = needsExpansionForDestination(
        currentBounds, tile.x, tile.y, renderZ, 30,
      );
      if (destRegion) {
        const ek = expansionKey(currentBounds, destRegion);
        if (!exhaustedDirections.has(ek)) {
          try {
            const expanded = await otbmParser.parseRegion(destRegion);
            // Capture the size baseline *here* (right before merge) so a
            // concurrent expansion that landed during our parse can't
            // skew the growth check via a stale snapshot.
            const sizeBeforeMerge = tileMap.size;
            tileMap.merge(expanded);
            if (tileMap.size > sizeBeforeMerge) {
              exhaustedDirections.clear();
              if (import.meta.env.DEV) {
                console.log('[map] walk-expand →', tileMap.getBounds(renderZ));
              }
              render(true);
            } else {
              exhaustedDirections.add(ek);
            }
          } catch (err) {
            console.error('[map] walk-expand failed:', err);
          }
        }
      }

      // The async walk-expand above may have yielded long enough for the
      // gesture state to change (pointer cancelled, new tap fired) or for
      // a step-land floor change to start. In any of those cases the
      // original tap is stale — drop it.
      if (e.pointerId !== activePointerId) return;
      if (floorChangeInProgress) { endGesture(); return; }

      const startX = walkState?.active ? walkState.toX : player.x;
      const startY = walkState?.active ? walkState.toY : player.y;
      const path = findPath(startX, startY, tile.x, tile.y, renderZ, tileMap, datIndex);
      if (walkState?.active) {
        walkState.path = path ?? [];
      } else if (path && path.length > 0) {
        walkState = startWalk(player, path, performance.now(), onStepLand);
        render(true); // pick up the new facing direction immediately
      }
    }
    endGesture();
  });

  // Browsers can cancel a pointer (e.g. scrolling takes over, page hides) —
  // reset gesture state so the next tap isn't ignored.
  window.addEventListener('pointercancel', (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    endGesture();
  });

  // --- Dev controls state ---
  let zoomUnlocked = false;
  let dragToPanEnabled = false;

  app.canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    if (!zoomUnlocked) return;
    viewport.zoomBy(e.deltaY > 0 ? 0.9 : 1.1);
    render();
  }, { passive: false });

  let lastPinchDist = 0;
  app.canvas.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist = Math.sqrt(dx * dx + dy * dy);
    }
  }, { passive: true });
  app.canvas.addEventListener('touchmove', (e: TouchEvent) => {
    if (e.touches.length > 1) e.preventDefault();
    if (!zoomUnlocked || e.touches.length !== 2) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (lastPinchDist > 0) {
      viewport.zoomBy(dist / lastPinchDist);
      render();
    }
    lastPinchDist = dist;
  }, { passive: false });
  app.canvas.addEventListener('touchend', () => { lastPinchDist = 0; }, { passive: true });

  // --- Dev controls panel ---
  const devControls = createDevControls([
    {
      label: 'Night',
      defaultOn: true,
      onChange: (on) => {
        ambient = on ? NIGHT_AMBIENT : DAY_AMBIENT;
        render(true);
      },
    },
    {
      label: 'Zoom',
      defaultOn: false,
      onChange: (on) => {
        zoomUnlocked = on;
        if (on) {
          viewport.minZoom = viewport.playZoom * 0.1;
          viewport.maxZoom = viewport.playZoom * 5;
        } else {
          viewport.minZoom = viewport.playZoom;
          viewport.maxZoom = viewport.playZoom;
          viewport.setZoom(viewport.playZoom);
          render(true);
        }
      },
    },
    {
      label: 'Drag pan',
      defaultOn: false,
      onChange: (on) => { dragToPanEnabled = on; },
    },
  ]);

  // Handle window resize / orientation change: recompute the play zoom for
  // the new screen so the visible play area stays consistent across
  // devices. iOS Safari fires `resize` while `innerWidth/innerHeight` are
  // still mid-rotation — measuring then leaves a black bar where the new
  // orientation extends past the (stale) canvas. We wait two animation
  // frames before remeasuring; one isn't enough on slower devices.
  let resizeRaf: number | null = null;
  function scheduleViewportUpdate() {
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        // visualViewport reflects the area that's actually visible — on
        // mobile this excludes the URL bar / soft keyboard; on desktop
        // it tracks pinch-zoom. innerWidth/innerHeight as a fallback for
        // older browsers (notably anything pre-iOS 13).
        const w = window.visualViewport?.width ?? window.innerWidth;
        const h = window.visualViewport?.height ?? window.innerHeight;
        // visualViewport.resize fires liberally on mobile (URL-bar
        // reveal, pinch); skip if nothing actually changed.
        if (w === viewport.screenWidth && h === viewport.screenHeight) return;
        app.renderer.resize(w, h);
        viewport.screenWidth = w;
        viewport.screenHeight = h;
        viewport.applyPlayZoom(computePlayZoom(w, h));
        // applyPlayZoom snaps zoom back to the locked baseline and
        // narrows the min/max bounds. If the user had unlocked zoom
        // ("Free") the UI would otherwise be desynced from the now-
        // re-locked viewport, so reset the toggle to match.
        if (zoomUnlocked) {
          zoomUnlocked = false;
          devControls.setToggle('Zoom', false);
        }
        render();
      });
    });
  }
  window.addEventListener('resize', scheduleViewportUpdate);
  window.addEventListener('orientationchange', scheduleViewportUpdate);
  // visualViewport tracks the actually-visible area (excludes URL bar) on
  // mobile; firing on its resize catches URL-bar reveal/hide and pinch.
  window.visualViewport?.addEventListener('resize', scheduleViewportUpdate);
  // Cold-start fix: on installed iOS PWAs the initial visualViewport
  // dimensions can be reported before the status-bar layout settles,
  // leaving a black strip at the top. Fire one deferred remeasure so
  // the canvas catches the post-layout size without needing the user
  // to interact first.
  scheduleViewportUpdate();

  // N toggle is now handled by keyboard.ts via the 'night' toggle binding.

  console.log(`Map loaded: ${tileMap.size} tiles, spawn at (${spawn.x}, ${spawn.y}, z=${spawn.z})`);
}

function regionAround(p: Position): OtbmRegion {
  return { centerX: p.x, centerY: p.y, radius: INITIAL_REGION_RADIUS, z: p.z };
}

/**
 * Decide where the player should appear when the map loads.
 *
 * Layered fallbacks, in order of authority:
 *   1. `override` — the future hook for server-driven login positions
 *      ("you logged out at X, log back in there"). Unused today but
 *      makes the seam explicit.
 *   2. A town named "Rookgaard" — the canonical Tibia 7.6 starting
 *      point. Every real-Tibia 7.6 OTBM declares it.
 *   3. Any town the map declares — better than a hardcoded coordinate
 *      because it's guaranteed to be inside the populated area of
 *      *this* particular map.
 *   4. `null` — caller falls back to a tile-scan probe.
 */
function pickSpawn(otbm: OtbmFile, override?: Position): Position | null {
  if (override) return override;

  // Exact case-insensitive match wins over partial — otherwise "Rookgaard East"
  // would shadow the canonical "Rookgaard" town when both exist.
  const exact = otbm.towns.find(t => t.name.toLowerCase() === 'rookgaard');
  if (exact) return exact.templePosition;

  const partial = otbm.towns.find(t => /rookgaard/i.test(t.name));
  if (partial) return partial.templePosition;

  if (otbm.towns.length > 0) return otbm.towns[0].templePosition;
  return null;
}

function findFirstTile(buffer: ArrayBuffer): { x: number; y: number; z: number } | null {
  const data = new Uint8Array(buffer);
  let offset = 4;
  const scanEnd = Math.min(data.length, 1024 * 1024);
  let areaBaseX = 0;
  let areaBaseY = 0;
  let areaBaseZ = 0;

  if (data[offset] !== NODE_START) return null;
  offset++;

  const root = readNodeData(data, offset);
  offset = root.nextOffset;

  function walk(depth = 0): { x: number; y: number; z: number } | null {
    if (depth > 8) return null;

    while (offset < scanEnd && offset < data.length) {
      const marker = data[offset];

      if (marker === NODE_END) {
        offset++;
        return null;
      }

      if (marker !== NODE_START) {
        offset++;
        continue;
      }

      offset++;
      const node = readNodeData(data, offset);
      offset = node.nextOffset;
      if (node.bytes.length === 0) {
        const found = walk(depth + 1);
        if (found) return found;
        continue;
      }

      const nodeType = node.bytes[0];
      if (nodeType === OtbmNode.TileArea) {
        areaBaseX = node.bytes[1] | (node.bytes[2] << 8);
        areaBaseY = node.bytes[3] | (node.bytes[4] << 8);
        areaBaseZ = node.bytes[5];
        if (areaBaseZ !== 7) {
          offset = skipNode(data, offset);
          continue;
        }
        const found = walk(depth + 1);
        if (found) return found;
      } else if (nodeType === OtbmNode.Tile || nodeType === OtbmNode.HouseTile) {
        if (tileNodeHasItems(node.bytes) || data[offset] === NODE_START) {
          return {
            x: areaBaseX + node.bytes[1],
            y: areaBaseY + node.bytes[2],
            z: areaBaseZ,
          };
        }
        offset = skipNode(data, offset);
      } else if (nodeType === OtbmNode.MapData || nodeType === OtbmNode.Towns) {
        const found = walk(depth + 1);
        if (found) return found;
      } else {
        offset = skipNode(data, offset);
      }
    }

    return null;
  }

  return walk();
}

function tileNodeHasItems(bytes: Uint8Array): boolean {
  let offset = bytes[0] === OtbmNode.HouseTile ? 7 : 3;

  while (offset < bytes.length) {
    const attrType = bytes[offset];
    offset++;

    if (attrType === OtbmAttr.Item) return true;
    if (attrType === OtbmAttr.TileFlags) {
      offset += 4;
    } else if (attrType === OtbmAttr.Description) {
      const len = bytes[offset] | (bytes[offset + 1] << 8);
      offset += 2 + len;
    } else {
      break;
    }
  }

  return false;
}
