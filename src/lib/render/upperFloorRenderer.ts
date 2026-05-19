import { Container } from 'pixi.js';
import { renderTileRegion } from '../tileRenderer';
import type { AtlasTextures, AnimatedSprite } from '../tileRenderer';
import type { ThingType } from '../dat';
import type { TileMap } from '../tileMap';
import type { SpriteLocation } from '../atlas';
import { TILE_SIZE } from '../../constants';

/**
 * Render every floor above the player that should still be visible,
 * given the `firstVisibleFloor` cutoff from `calcFirstVisibleFloor`.
 *
 * Each upper floor is shifted on-screen by `(z - playerZ) * TILE_SIZE`
 * (negative, since upper-floor z is smaller than playerZ) — the same
 * formula OTClient uses in `transformPositionTo2D`. The shift gives
 * the iso "stacked" look so a 3-story building's wall layers sit
 * visually above one another instead of overlapping pixel-for-pixel
 * (which would collapse the whole building into a flat 1-story
 * silhouette).
 *
 * Floors render in descending z order — closest-to-player first,
 * sky-most last — so the topmost floor draws on top of everything
 * below it in the same building.
 */
export interface RenderedUpperFloors {
  container: Container;
  animated: AnimatedSprite[];
}

export function renderUpperFloors(
  tileMap: TileMap,
  datIndex: Map<number, ThingType>,
  atlasTextures: AtlasTextures,
  layout: Map<number, SpriteLocation>,
  visible: { x1: number; y1: number; x2: number; y2: number },
  playerZ: number,
  firstVisibleFloor: number,
): RenderedUpperFloors {
  const container = new Container();
  const animated: AnimatedSprite[] = [];

  // Nothing to draw: either the player is the top floor itself, or a
  // roof immediately above cut visibility at the player's own z.
  if (firstVisibleFloor >= playerZ) {
    return { container, animated };
  }

  for (let z = playerZ - 1; z >= firstVisibleFloor; z--) {
    const floor = renderTileRegion(
      tileMap, datIndex, atlasTextures, layout,
      visible.x1, visible.y1, visible.x2, visible.y2, z,
    );
    const dz = playerZ - z;
    floor.container.x = -TILE_SIZE * dz;
    floor.container.y = -TILE_SIZE * dz;
    container.addChild(floor.container);
    animated.push(...floor.animated);
  }

  return { container, animated };
}
