import { Container } from 'pixi.js';
import { renderTileRegion } from '../tileRenderer';
import type { AtlasTextures, AnimatedSprite } from '../tileRenderer';
import type { ThingType } from '../dat';
import type { TileMap } from '../tileMap';
import type { SpriteLocation } from '../atlas';

/**
 * Render every floor above the player that should still be visible,
 * given the `firstVisibleFloor` cutoff from `calcFirstVisibleFloor`.
 *
 * Drawing convention: each upper floor is rendered at the SAME screen
 * (x, y) as the player's floor, matching the existing downward pass.
 * Tibia's isometric illusion is carried by tall items (walls, roof
 * sprites) declaring `height > 1` in the .dat — those sprites poke up
 * above their tile so a roof drawn at (x*32, y*32) visually sits over
 * the corresponding building tile below it.
 *
 * Floors are added back-to-front (highest in world / lowest z first),
 * so closer-to-the-player floors layer on top.
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

  for (let z = firstVisibleFloor; z < playerZ; z++) {
    const floor = renderTileRegion(
      tileMap, datIndex, atlasTextures, layout,
      visible.x1, visible.y1, visible.x2, visible.y2, z,
    );
    container.addChild(floor.container);
    animated.push(...floor.animated);
  }

  return { container, animated };
}
