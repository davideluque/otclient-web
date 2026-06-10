import type { Application, Container } from 'pixi.js';
import { renderTileRegion, renderPlayer, type TintedTextureCache } from '../tileRenderer';
import { createNameplate, type NameplateHandle } from './nameplate';
import { SpeechBubbleRenderer } from '../chat/SpeechBubbleRenderer';
import type { ChatManager } from '../chat/ChatManager';
import type { GameWorld, WorldCreature } from '../GameWorld';
import type { Direction } from '../player';
import type { SpriteAtlas } from '../spriteAtlas';
import { TILE_SIZE } from '../../constants';

/**
 * Tibia-canonical visible-region half-extents around the player. The
 * server feeds an 18×14 window (`playerX-8 … playerX+9`, `playerY-6 …
 * playerY+7`); we render the same span so the renderer paints whatever
 * the server has sent and not a tile more.
 */
const HALF_W_LEFT = 8;
const HALF_W_RIGHT = 9;
const HALF_H_TOP = 6;
const HALF_H_BOTTOM = 7;

/** How long after a confirmed step a creature keeps its walk pose. */
const WALK_ANIM_MS = 400;
/** Walk frame duration — two alternating walk poses at ~8 fps. */
const WALK_FRAME_MS = 125;

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
  // off by `devicePixelRatio` with autoDensity).
  const recenter = (container: Container): void => {
    container.x = app.screen.width / 2 - (world.playerX + 0.5) * TILE_SIZE;
    container.y = app.screen.height / 2 - (world.playerY + 0.5) * TILE_SIZE;
  };

  let rafId = 0;

  const update = (): void => {
    const now = performance.now();
    // While anything is mid-walk-animation the key changes every walk
    // frame, and a rAF loop keeps ticking until everyone is idle again.
    const anyWalking = world.getAllCreatures().some(
      (c) => c.z === world.playerZ && c.lastMoveAt !== undefined && now - c.lastMoveAt < WALK_ANIM_MS,
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
    if (key === paintedKey && currentContainer) return;

    const { container } = renderTileRegion(
      world,
      atlas.datIndex,
      atlas.atlasTextures,
      atlas.layout,
      world.playerX - HALF_W_LEFT, world.playerY - HALF_H_TOP,
      world.playerX + HALF_W_RIGHT, world.playerY + HALF_H_BOTTOM,
      world.playerZ,
    );
    drawCreatures(world, atlas, container, tintedCache, nameplates);
    if (bubbles) container.addChild(bubbles.getContainer());
    recenter(container);

    if (currentContainer) {
      app.stage.removeChild(currentContainer);
      currentContainer.destroy({ children: true });
    }
    app.stage.addChild(container);
    currentContainer = container;
    paintedKey = key;
  };

  // A window resize changes `app.screen` but fires no world change —
  // recenter the existing container without rebuilding it.
  const onResize = (): void => {
    if (currentContainer) recenter(currentContainer);
  };
  window.addEventListener('resize', onResize);

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
    bubbles?.destroy();
    window.removeEventListener('resize', onResize);
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
): void {
  const x1 = world.playerX - HALF_W_LEFT;
  const x2 = world.playerX + HALF_W_RIGHT;
  const y1 = world.playerY - HALF_H_TOP;
  const y2 = world.playerY + HALF_H_BOTTOM;

  const visible = world.getAllCreatures().filter((c) =>
    c.z === world.playerZ && c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2,
  );
  visible.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const now = performance.now();
  const seen = new Set<number>();
  for (const c of visible) {
    const sprite = renderCreature(c, atlas, tintedCache, walkPhase(c, now));
    if (sprite) container.addChild(sprite);

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
  }
  for (const [id, plate] of nameplates) {
    if (!seen.has(id)) {
      plate.destroy();
      nameplates.delete(id);
    }
  }
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
