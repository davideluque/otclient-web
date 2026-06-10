import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import { renderTileRegion, renderPlayer, type TintedTextureCache } from '../tileRenderer';
import { createNameplate, type NameplateHandle } from './nameplate';
import { SpeechBubbleRenderer } from '../chat/SpeechBubbleRenderer';
import type { ChatManager } from '../chat/ChatManager';
import type { GameWorld, WorldCreature } from '../GameWorld';
import type { Direction } from '../player';
import type { SpriteAtlas } from '../spriteAtlas';
import { TILE_SIZE } from '../../constants';
import { HALF_W_LEFT, HALF_W_RIGHT, HALF_H_TOP, HALF_H_BOTTOM } from './region';
import { VIEWPORT_EVENT } from './viewport';
import { reportMetric } from './metrics';

/** How long after a confirmed step a creature keeps its walk pose. */
const WALK_ANIM_MS = 400;
/** Walk frame duration — two alternating walk poses at ~8 fps. */
const WALK_FRAME_MS = 125;

/**
 * Glide duration bounds. The right duration is the creature's ACTUAL
 * step cadence (Tibia paces ~400ms/tile at base speed, faster with
 * hastes/levels, plus network jitter) — a fixed value either finishes
 * early (visible stop-start between steps) or rubber-bands. Each
 * creature's cadence is measured from its confirmation intervals
 * (EMA), so continuous walking renders as one unbroken scroll.
 */
export const STEP_GLIDE_DEFAULT_MS = 380;
export const STEP_GLIDE_MIN_MS = 150;
export const STEP_GLIDE_MAX_MS = 650;
/**
 * Extra painted tiles beyond the server window on every side: the
 * pursuing camera trails the confirmed position by up to a tile, and
 * the trailing edge must show the (already-known, lingering) tiles
 * there instead of black.
 */
const GLIDE_PAD = 3;

/**
 * Tile-layer rebuild policy. Rebuilding the tile layer is the expensive
 * operation (hundreds to thousands of sprites in dense town areas), so
 * it no longer runs per walk-pose frame: only when the player has moved
 * HYSTERESIS tiles from the painted center (the pad keeps the screen
 * covered in between), on a floor change, or — throttled — when tile
 * contents change in place (doors, dropped items).
 */
const TILE_REBUILD_HYSTERESIS = 2;
const TILE_REVISION_THROTTLE_MS = 300;

/**
 * Exponential moving average of a creature's step cadence. Exported for
 * tests. Per the Codex review, only samples in the plausible
 * SERVER-step-duration band feed the estimate — anything longer is
 * network arrival jitter or a standing pause, anything shorter is a
 * delivery burst; neither says how fast the creature walks.
 */
export function nextStepEma(prevEma: number, sampleMs: number): number {
  if (sampleMs < STEP_GLIDE_MIN_MS || sampleMs > 500) return prevEma;
  return Math.max(STEP_GLIDE_MIN_MS, Math.min(STEP_GLIDE_MAX_MS, prevEma * 0.75 + sampleMs * 0.25));
}

export interface RenderPos { x: number; y: number }

/**
 * Playout buffer (fixed render delay), the FPS-netcode entity-
 * interpolation pattern Codex recommended over latest-target pursuit:
 * confirmed tiles are buffered as timestamped samples and rendered
 * RENDER_DELAY_MS in the past, each glide timed to FINISH exactly at
 * its sample's (delayed) arrival time. Wi-Fi delivery jitter smaller
 * than the delay reorders nothing on screen — motion plays back as one
 * continuous stream instead of stalling and sprinting.
 */
export const RENDER_DELAY_MS = 180;
/** Buffered samples per creature — enough to ride out a delivery burst. */
const MAX_SAMPLES = 8;

export interface PlaybackSample { x: number; y: number; z: number; at: number }

/**
 * Position on the buffered timeline at (delayed) time `t`. Pure;
 * exported for tests. Each segment glides over min(cadence, gap) so the
 * render position lands ON the sample at its timestamp; discontinuities
 * (non-adjacent tiles, floor changes) hold then snap at the sample time.
 */
export function playbackPosAt(
  samples: ReadonlyArray<PlaybackSample>,
  cadenceMs: number,
  t: number,
): RenderPos {
  if (samples.length === 0) return { x: 0, y: 0 };
  if (t >= samples[samples.length - 1].at) {
    const last = samples[samples.length - 1];
    return { x: last.x, y: last.y };
  }
  // Find the segment [a, b] with a.at <= t < b.at.
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1].at > t) i--;
  const b = samples[i];
  const a = i > 0 ? samples[i - 1] : b;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const discontinuity = b.z !== a.z || Math.abs(dx) > 1 || Math.abs(dy) > 1;
  if (discontinuity) return { x: a.x, y: a.y }; // snaps when t reaches b.at
  const duration = Math.min(cadenceMs, Math.max(1, b.at - a.at));
  const u = Math.min(1, Math.max(0, (t - (b.at - duration)) / duration));
  return { x: a.x + dx * u, y: a.y + dy * u };
}

function walkPhase(c: WorldCreature, now: number): number {
  // performance.now() starts near 0, so an undefined stamp must mean
  // idle explicitly rather than defaulting to 0 and looking recent.
  if (c.lastMoveAt === undefined || now - c.lastMoveAt >= WALK_ANIM_MS) return 0;
  // Phases 1..n-1 are the walk cycle (renderPlayer clamps to the
  // outfit's actual phase count).
  return 1 + (Math.floor(now / WALK_FRAME_MS) % 2);
}

/**
 * Bridges `GameWorld` → PIXI: subscribes to `world.onChange` and repaints
 * the visible region around the player using the `SpriteAtlas` the cache
 * PR exposed. Returns a teardown for the caller to invoke on re-login or
 * page unload — without it, the previous session's container would leak
 * into the new session's stage.
 *
 * No diffing — every change rebuilds the visible-region container from
 * scratch. Adequate for first-paint correctness; a follow-up PR will
 * diff tile-by-tile so single moves don't trigger ~250-tile rebuilds.
 *
 * Creatures (the player included — it's just a creature the server put
 * on a tile) draw after the tile pass, north-to-south so southern
 * creatures overlap correctly, idle pose for now (walk animation is a
 * follow-up).
 */
export function bindRenderer(
  world: GameWorld,
  atlas: SpriteAtlas,
  app: Application,
  chatManager?: ChatManager,
): () => void {
  // Persistent scene root (recentered by the camera) holding three
  // layers: tiles (expensive, rebuilt with hysteresis), creatures
  // (cheap, rebuilt per pose/state change), bubbles (persistent).
  let root: Container | null = null;
  let tileLayer: Container | null = null;
  let creatureLayer: Container | null = null;
  let paintedCenterX = NaN;
  let paintedCenterY = NaN;
  let paintedCenterZ = NaN;
  let paintedTileRevision = -1;
  let lastTileRebuildAt = 0;
  let creatureKey = '';
  // Outfit tint compositions are expensive; cache them for the lifetime
  // of this binding (i.e. per session).
  const tintedCache: TintedTextureCache = new Map();
  // Nameplates persist across rebuilds (PIXI Text layout is costly);
  // keyed by creature id, evicted when the creature leaves view.
  const nameplates = new Map<number, NameplateHandle>();
  // Speech bubbles live in their own persistent layer, reparented on top
  // of each rebuilt container and updated every frame — bubble motion and
  // expiry must not depend on tiles changing.
  const bubbles = chatManager ? new SpeechBubbleRenderer() : null;
  // A creature speaking while everything stands still fires no
  // world.onChange — chain the manager's handleMessage (ChatUI uses the
  // same pattern) so a fresh bubble repaints immediately and arms the
  // rAF loop; restored on teardown.
  const originalHandleMessage = chatManager ? chatManager.handleMessage.bind(chatManager) : null;
  if (chatManager && originalHandleMessage) {
    chatManager.handleMessage = (msg) => {
      originalHandleMessage(msg);
      update();
    };
  }

  // Center the player tile on the canvas. The 0.5 offset puts the
  // *center* of the player's tile at the canvas center instead of
  // the tile's top-left corner. Use `app.screen` (CSS pixels — what
  // the scene graph uses) rather than `app.canvas` (device pixels,
  // off by `devicePixelRatio` with autoDensity). The stage carries the
  // cover zoom (see viewport.ts), so screen px → stage units divides
  // by the stage scale.
  const recenter = (container: Container, camX = world.playerX, camY = world.playerY): void => {
    const zoom = app.stage?.scale?.x || 1;
    container.x = app.screen.width / 2 / zoom - (camX + 0.5) * TILE_SIZE;
    container.y = app.screen.height / 2 / zoom - (camY + 0.5) * TILE_SIZE;
  };

  // Per-rebuild registry of creature display nodes at their build-time
  // base positions — the per-frame glide pass nudges these (and the
  // camera) by the interpolated fraction without rebuilding anything.
  let movables: Array<{ node: Container; baseX: number; baseY: number; c: WorldCreature }> = [];

  // Per-creature playout buffers (see playbackPosAt).
  const playback = new Map<number, { samples: PlaybackSample[]; cadence: number }>();

  const playbackFor = (c: WorldCreature): { samples: PlaybackSample[]; cadence: number } => {
    let p = playback.get(c.id);
    if (!p) {
      // Seed in the past so a creature with no pending motion renders
      // at its tile immediately.
      p = {
        samples: [{ x: c.x, y: c.y, z: c.z, at: (c.lastMoveAt ?? 0) - RENDER_DELAY_MS }],
        cadence: STEP_GLIDE_DEFAULT_MS,
      };
      playback.set(c.id, p);
    }
    const last = p.samples[p.samples.length - 1];
    if (last.x !== c.x || last.y !== c.y || last.z !== c.z) {
      const at = c.lastMoveAt ?? performance.now();
      p.cadence = nextStepEma(p.cadence, at - last.at);
      p.samples.push({ x: c.x, y: c.y, z: c.z, at });
      if (p.samples.length > MAX_SAMPLES) p.samples.shift();
    }
    return p;
  };

  /** True while any creature's buffered timeline hasn't played out. */
  const anyBufferedMotion = (now: number): boolean => {
    const t = now - RENDER_DELAY_MS;
    for (const p of playback.values()) {
      if (t < p.samples[p.samples.length - 1].at) return true;
    }
    return false;
  };

  const renderPosFor = (c: WorldCreature, now: number): RenderPos => {
    const p = playbackFor(c);
    return playbackPosAt(p.samples, p.cadence, now - RENDER_DELAY_MS);
  };

  const glide = (now: number): void => {
    if (!root) return;
    const self = world.getCreature(world.playerCreatureId);
    const cam = self ? renderPosFor(self, now) : { x: world.playerX, y: world.playerY };
    recenter(root, cam.x, cam.y);
    for (const m of movables) {
      const p = renderPosFor(m.c, now);
      m.node.x = m.baseX + (p.x - m.c.x) * TILE_SIZE;
      m.node.y = m.baseY + (p.y - m.c.y) * TILE_SIZE;
    }
  };

  let rafId = 0;

  const update = (): void => {
    const now = performance.now();
    // While anything is mid-walk-animation the key changes every walk
    // frame, and a rAF loop keeps ticking until everyone is idle again.
    const anyWalking = world.getAllCreatures().some(
      (c) => c.z === world.playerZ && c.lastMoveAt !== undefined
        && now - c.lastMoveAt < Math.max(WALK_ANIM_MS, STEP_GLIDE_MAX_MS) + RENDER_DELAY_MS,
    ) || anyBufferedMotion(now);
    // Bubble lifecycle: ChatManager expiry runs on wall-clock time
    // (expiresAt comes from Date.now()), and the layer updates every
    // call — including ones the tile short-circuit below skips.
    let bubblesActive = false;
    if (chatManager && bubbles) {
      bubbles.update(chatManager, 0, 0, 1, Date.now());
      bubblesActive = chatManager.speechBubbles.length > 0;
    }
    const walkTick = anyWalking ? Math.floor(now / WALK_FRAME_MS) : -1;
    if ((anyWalking || bubblesActive) && rafId === 0) {
      const tick = (): void => {
        rafId = 0;
        update();
      };
      rafId = requestAnimationFrame(tick);
    }
    if (!root) {
      root = new Container();
      app.stage.addChild(root);
      if (bubbles) root.addChild(bubbles.getContainer());
    }

    // ── Tile layer (expensive): hysteresis + throttle ──
    const movedFar =
      Number.isNaN(paintedCenterX) ||
      Math.abs(world.playerX - paintedCenterX) >= TILE_REBUILD_HYSTERESIS ||
      Math.abs(world.playerY - paintedCenterY) >= TILE_REBUILD_HYSTERESIS;
    const zChanged = world.playerZ !== paintedCenterZ;
    const revChanged = world.tileRevision !== paintedTileRevision;
    if (!tileLayer || zChanged || movedFar
      || (revChanged && now - lastTileRebuildAt >= TILE_REVISION_THROTTLE_MS)) {
      const repaintStart = performance.now();
      // GLIDE_PAD: covers both the pursuing camera trailing behind the
      // confirmed position AND the hysteresis lag of the painted center
      // — the trailing/lagging edges show lingering known tiles instead
      // of black. Undescribed tiles stay black but sit past the leading
      // edge, never on screen.
      const { container: nextTiles } = renderTileRegion(
        world,
        atlas.datIndex,
        atlas.atlasTextures,
        atlas.layout,
        world.playerX - HALF_W_LEFT - GLIDE_PAD, world.playerY - HALF_H_TOP - GLIDE_PAD,
        world.playerX + HALF_W_RIGHT + GLIDE_PAD, world.playerY + HALF_H_BOTTOM + GLIDE_PAD,
        world.playerZ,
      );
      root.addChildAt(nextTiles, 0);
      if (tileLayer) {
        root.removeChild(tileLayer);
        tileLayer.destroy({ children: true });
      }
      tileLayer = nextTiles;
      paintedCenterX = world.playerX;
      paintedCenterY = world.playerY;
      paintedCenterZ = world.playerZ;
      paintedTileRevision = world.tileRevision;
      lastTileRebuildAt = now;
      // Tile rebuild cost — the phone-CPU half of the lag decomposition.
      reportMetric('repaint', performance.now() - repaintStart);
    }

    // ── Creature layer (cheap): poses + creature state ──
    const ck = `${world.creatureRevision}:${walkTick}:${world.playerZ}:${world.playerX}:${world.playerY}`;
    if (!creatureLayer || ck !== creatureKey) {
      const nextCreatures = new Container();
      // Build first, destroy after: drawCreatures reparents persistent
      // nameplates into the new layer, keeping them out of the destroy.
      movables = drawCreatures(world, atlas, nextCreatures, tintedCache, nameplates);
      root.addChildAt(nextCreatures, tileLayer ? 1 : 0);
      if (creatureLayer) {
        root.removeChild(creatureLayer);
        creatureLayer.destroy({ children: true });
      }
      creatureLayer = nextCreatures;
      creatureKey = ck;
    }

    glide(now);
  };

  // A viewport change alters `app.screen` and the stage zoom but fires
  // no world change — recenter the existing container without
  // rebuilding it. VIEWPORT_EVENT arrives *after* the app-level
  // debounce actually resized the renderer (a plain `resize` listener
  // would read pre-resize dimensions); the raw `resize` listener stays
  // as a fallback for tests / non-cover hosts.
  const onResize = (): void => {
    if (root) recenter(root);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener(VIEWPORT_EVENT, onResize);

  world.onChange = update;
  // Render immediately in case MapDescription has already populated the
  // world before this binding ran (e.g., assets finished loading after
  // the first map frame arrived).
  update();

  return () => {
    if (chatManager && originalHandleMessage) chatManager.handleMessage = originalHandleMessage;
    if (rafId !== 0) cancelAnimationFrame(rafId);
    // Tinted outfit textures are dynamically created GPU resources; the
    // shared atlas textures live for the page, but these are per-binding.
    for (const tex of tintedCache.values()) tex.destroy(true);
    tintedCache.clear();
    for (const plate of nameplates.values()) plate.destroy();
    nameplates.clear();
    playback.clear();
    bubbles?.destroy();
    window.removeEventListener('resize', onResize);
    window.removeEventListener(VIEWPORT_EVENT, onResize);
    if (world.onChange === update) world.onChange = null;
    if (root) {
      app.stage.removeChild(root);
      root.destroy({ children: true });
      root = null;
      tileLayer = null;
      creatureLayer = null;
    }
  };
}

/**
 * Draw every creature in the visible region (the player included) on top
 * of the tile pass. North-to-south so southern creatures overlap the
 * ones behind them, matching the tile painter order.
 */
function drawCreatures(
  world: GameWorld,
  atlas: SpriteAtlas,
  container: Container,
  tintedCache: TintedTextureCache,
  nameplates: Map<number, NameplateHandle>,
): Array<{ node: Container; baseX: number; baseY: number; c: WorldCreature }> {
  const movables: Array<{ node: Container; baseX: number; baseY: number; c: WorldCreature }> = [];
  const x1 = world.playerX - HALF_W_LEFT - GLIDE_PAD;
  const x2 = world.playerX + HALF_W_RIGHT + GLIDE_PAD;
  const y1 = world.playerY - HALF_H_TOP - GLIDE_PAD;
  const y2 = world.playerY + HALF_H_BOTTOM + GLIDE_PAD;

  const visible = world.getAllCreatures().filter((c) =>
    c.z === world.playerZ && c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2,
  );
  visible.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const now = performance.now();
  const seen = new Set<number>();
  for (const c of visible) {
    const sprite = renderCreature(c, atlas, tintedCache, walkPhase(c, now));
    if (sprite) {
      container.addChild(sprite);
      movables.push({ node: sprite, baseX: sprite.x, baseY: sprite.y, c });
    }

    // Nameplate (name + six-band health bar) above the creature's tile.
    // Reparented into the fresh container each rebuild; updated in place.
    seen.add(c.id);
    let plate = nameplates.get(c.id);
    if (!plate) {
      plate = createNameplate(c.name, c.health);
      nameplates.set(c.id, plate);
    } else {
      plate.update(c.name, c.health);
    }
    plate.container.x = (c.x + 0.5) * TILE_SIZE;
    plate.container.y = c.y * TILE_SIZE - 14;
    container.addChild(plate.container);
    movables.push({ node: plate.container, baseX: plate.container.x, baseY: plate.container.y, c });
  }
  for (const [id, plate] of nameplates) {
    if (!seen.has(id)) {
      plate.destroy();
      nameplates.delete(id);
    }
  }
  return movables;
}

function renderCreature(
  c: WorldCreature,
  atlas: SpriteAtlas,
  tintedCache: TintedTextureCache,
  animationPhase: number,
): Container | null {
  if (!c.outfit || c.outfit.lookType === 0) return null; // invisible / item-look: not drawn yet
  return renderPlayer(
    {
      x: c.x,
      y: c.y,
      z: c.z,
      // The wire direction byte is value-compatible with Direction
      // (0 north, 1 east, 2 south, 3 west); renderPlayer additionally
      // clamps to the outfit's pattern count.
      direction: (c.direction & 3) as Direction,
      animationPhase,
      outfit: {
        lookType: c.outfit.lookType,
        headColor: c.outfit.head,
        bodyColor: c.outfit.body,
        legsColor: c.outfit.legs,
        feetColor: c.outfit.feet,
      },
    },
    atlas.creatureIndex,
    atlas.atlasTextures,
    atlas.atlasPages,
    atlas.layout,
    tintedCache,
  );
}
