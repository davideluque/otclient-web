import type { Application, Container } from 'pixi.js';
import { renderTileRegion } from '../tileRenderer';
import type { GameWorld } from '../GameWorld';
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
 * No creature/player rendering yet — `renderPlayer` needs outfit-tint
 * resolution which is its own concern.
 */
export function bindRenderer(
  world: GameWorld,
  atlas: SpriteAtlas,
  app: Application,
): () => void {
  let currentContainer: Container | null = null;
  // Snapshot of what the current container was painted from. Creature
  // moves fire `onChange` constantly but don't touch tiles — when neither
  // the player position nor the tile revision moved, skip the ~250-tile
  // rebuild (this renderer draws tiles only; see header comment).
  let paintedKey = '';

  // Center the player tile on the canvas. The 0.5 offset puts the
  // *center* of the player's tile at the canvas center instead of
  // the tile's top-left corner. Use `app.screen` (CSS pixels — what
  // the scene graph uses) rather than `app.canvas` (device pixels,
  // off by `devicePixelRatio` with autoDensity).
  const recenter = (container: Container): void => {
    container.x = app.screen.width / 2 - (world.playerX + 0.5) * TILE_SIZE;
    container.y = app.screen.height / 2 - (world.playerY + 0.5) * TILE_SIZE;
  };

  const update = (): void => {
    const key = `${world.playerX}:${world.playerY}:${world.playerZ}:${world.tileRevision}`;
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
    window.removeEventListener('resize', onResize);
    if (world.onChange === update) world.onChange = null;
    if (currentContainer) {
      app.stage.removeChild(currentContainer);
      currentContainer.destroy({ children: true });
      currentContainer = null;
    }
  };
}
