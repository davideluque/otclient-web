import { Direction } from './player';
import type { Viewport } from './viewport';

export interface TileCoord {
  x: number;
  y: number;
}

/**
 * Convert a screen pixel position to a tile coordinate using the viewport.
 */
export function screenToTile(
  screenX: number,
  screenY: number,
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
 * Compute the direction from one tile to another.
 * Returns the primary cardinal direction (no diagonals).
 * If tiles are the same, returns null.
 */
export function directionTo(
  fromX: number, fromY: number,
  toX: number, toY: number,
): Direction | null {
  const dx = toX - fromX;
  const dy = toY - fromY;

  if (dx === 0 && dy === 0) return null;

  // Use the axis with the greater absolute delta
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? Direction.East : Direction.West;
  } else {
    return dy > 0 ? Direction.South : Direction.North;
  }
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
