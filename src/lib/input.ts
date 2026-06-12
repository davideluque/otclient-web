import { Direction } from './player';
import type { Pixel } from './types';
import type { Viewport } from './viewport';

export interface TileCoord {
  x: number;
  y: number;
}

/**
 * Convert a screen pixel position to a tile coordinate using the viewport.
 */
export function screenToTile(
  screenX: Pixel,
  screenY: Pixel,
  viewport: Viewport,
): TileCoord {
  const tilePixel = viewport.tileSizeOnScreen;
  const offset = viewport.getContainerOffset();

  return {
    x: Math.floor((screenX - offset.x) / tilePixel),
    y: Math.floor((screenY - offset.y) / tilePixel),
  };
}

/**
 * Compute a simple step: move one tile in the given direction.
 */
export function stepInDirection(
  x: number, y: number, dir: Direction,
): TileCoord {
  switch (dir) {
    case Direction.North: return { x, y: y - 1 };
    case Direction.East: return { x: x + 1, y };
    case Direction.South: return { x, y: y + 1 };
    case Direction.West: return { x: x - 1, y };
  }
}
