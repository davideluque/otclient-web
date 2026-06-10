import type { Application, Container } from 'pixi.js';
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
/** Confirmation gaps beyond this are standing pauses, not cadence. */
const STEP_SAMPLE_MAX_MS = 800;

/**
 * Extra painted tiles beyond the server window on every side: the
 * pursuing camera trails the confirmed position by up to a tile, and
 * the trailing edge must show the (already-known, lingering) tiles
 * there instead of black.
 */
const GLIDE_PAD = 2;

/**
 * Exponential moving average of a creature's step cadence. Exported for
 * tests. Samples outside the plausible-cadence band are ignored — a
 * pause between walks must not stretch the next glide.
 */
export function nextStepEma(prevEma: number, sampleMs: number): number {
  if (sampleMs < STEP_GLIDE_MIN_MS || sampleMs > STEP_SAMPLE_MAX_MS) return prevEma;
  return prevEma * 0.75 + sampleMs * 0.25;
}

/**
 * Screen-position interpolation for a confirmed step: from (fromX,
 * fromY) toward (x, y) over `durationMs`. Teleports and floor changes
 * have no from-tile and snap.
 */
export interface RenderPos { x: number; y: number }

/**
 * Pursuit step: advance a continuous render position toward the
 * confirmed tile at the creature's measured walking speed (1 tile per
 * `cadenceMs`). Unlike a per-step timed glide, the position never
 * restarts or jumps when confirmations jitter — late ones briefly slow
 * the chase, early ones are caught up at CATCHUP_BOOST. Distances
 * beyond SNAP_DISTANCE tiles are teleports/floor changes: snap.
 * Exported for tests.
 */
export const SNAP_DISTANCE = 1.75;
const CATCHUP_BOOST = 1.6;

export function advanceRenderPos(
  pos: RenderPos,
  targetX: number,
  targetY: number,
  dtMs: number,
  cadenceMs: number,
): void {
  const dx = targetX - pos.x;
  const dy = targetY - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;
  if (dist > SNAP_DISTANCE) {
    pos.x = targetX;
    pos.y = targetY;
    return;
  }
  // Falling behind a full tile means confirmations are outpacing the
  // chase (burst after a jitter spike) — hurry without snapping.
  const boost = dist > 1 ? CATCHUP_BOOST : 1;
  const step = (dtMs / cadenceMs) * boost;
  if (step >= dist) {
    pos.x = targetX;
    pos.y = targetY;
    return;
  }
  pos.x += (dx / dist) * step;
  pos.y += (dy / dist) * step;
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
  let currentContainer: Container | null = null;
  // Snapshot of what the current container was painted from: player
  // position plus the tile and creature revision counters — onChange
  // fires for plenty of packets that change none of these.
  let paintedKey = '';
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

  // Per-creature pursuit state: a continuous render position chasing
  // the confirmed tile at the measured cadence, plus the cadence EMA.
  // Never restarted per step, so confirmation jitter bends the speed
  // instead of pausing or jumping the sprite.
  const pursuit = new Map<number, { pos: RenderPos; lastAt: number; ema: number }>();
  let lastGlideAt = 0;

  const renderPosFor = (c: WorldCreature, dtMs: number): RenderPos => {
    let entry = pursuit.get(c.id);
    if (!entry) {
      // First sighting: start from the step's departure tile when one
      // is in flight so even the first step glides.
      entry = {
        pos: { x: c.fromX ?? c.x, y: c.fromY ?? c.y },
        lastAt: c.lastMoveAt ?? 0,
        ema: STEP_GLIDE_DEFAULT_MS,
      };
      pursuit.set(c.id, entry);
    } else if (c.lastMoveAt !== undefined && c.lastMoveAt !== entry.lastAt) {
      if (entry.lastAt !== 0) entry.ema = nextStepEma(entry.ema, c.lastMoveAt - entry.lastAt);
      entry.lastAt = c.lastMoveAt;
    }
    advanceRenderPos(entry.pos, c.x, c.y, dtMs, entry.ema);
    return entry.pos;
  };

  const glide = (now: number): void => {
    if (!currentContainer) return;
    const dtMs = lastGlideAt === 0 ? 0 : Math.min(100, now - lastGlideAt);
    lastGlideAt = now;
    const self = world.getCreature(world.playerCreatureId);
    const cam = self ? renderPosFor(self, dtMs) : { x: world.playerX, y: world.playerY };
    recenter(currentContainer, cam.x, cam.y);
    for (const m of movables) {
      if (m.c.id === world.playerCreatureId) {
        // Already advanced above as the camera — reuse, don't advance twice.
        const p = pursuit.get(m.c.id)?.pos ?? m.c;
        m.node.x = m.baseX + (p.x - m.c.x) * TILE_SIZE;
        m.node.y = m.baseY + (p.y - m.c.y) * TILE_SIZE;
        continue;
      }
      const p = renderPosFor(m.c, dtMs);
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
        && now - c.lastMoveAt < Math.max(WALK_ANIM_MS, STEP_GLIDE_MAX_MS),
    );
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
    const key = `${world.playerX}:${world.playerY}:${world.playerZ}:${world.tileRevision}:${world.creatureRevision}:${walkTick}`;
    if (key === paintedKey && currentContainer) {
      // Nothing structural changed — but mid-step glides still need
      // their per-frame camera/sprite nudge.
      glide(now);
      return;
    }

    const repaintStart = performance.now();
    // GLIDE_PAD: while the camera pursues the player it trails up to a
    // tile behind the confirmed position — paint beyond the server
    // window so the trailing edge shows the lingering already-known
    // tiles instead of black. Tiles the server never described stay
    // black, but they're always on the leading edge, behind the player
    // center, never visible.
    const { container } = renderTileRegion(
      world,
      atlas.datIndex,
      atlas.atlasTextures,
      atlas.layout,
      world.playerX - HALF_W_LEFT - GLIDE_PAD, world.playerY - HALF_H_TOP - GLIDE_PAD,
      world.playerX + HALF_W_RIGHT + GLIDE_PAD, world.playerY + HALF_H_BOTTOM + GLIDE_PAD,
      world.playerZ,
    );
    movables = drawCreatures(world, atlas, container, tintedCache, nameplates);
    if (bubbles) container.addChild(bubbles.getContainer());
    recenter(container);

    if (currentContainer) {
      app.stage.removeChild(currentContainer);
      currentContainer.destroy({ children: true });
    }
    app.stage.addChild(container);
    currentContainer = container;
    paintedKey = key;
    glide(now);
    // Full-region rebuild cost on this device — the phone-CPU half of
    // the walk-lag decomposition.
    reportMetric('repaint', performance.now() - repaintStart);
  };

  // A viewport change alters `app.screen` and the stage zoom but fires
  // no world change — recenter the existing container without
  // rebuilding it. VIEWPORT_EVENT arrives *after* the app-level
  // debounce actually resized the renderer (a plain `resize` listener
  // would read pre-resize dimensions); the raw `resize` listener stays
  // as a fallback for tests / non-cover hosts.
  const onResize = (): void => {
    if (currentContainer) recenter(currentContainer);
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
    pursuit.clear();
    bubbles?.destroy();
    window.removeEventListener('resize', onResize);
    window.removeEventListener(VIEWPORT_EVENT, onResize);
    if (world.onChange === update) world.onChange = null;
    if (currentContainer) {
      app.stage.removeChild(currentContainer);
      currentContainer.destroy({ children: true });
      currentContainer = null;
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
