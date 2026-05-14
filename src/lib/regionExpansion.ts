import type { ViewRect } from './viewport';
import type { Bounds } from './tileMap';
import type { OtbmRegion } from './otbm';

const EXPANSION_RADIUS = 100;

/**
 * Check if the viewport is close enough to the loaded map edge that we
 * should parse more OTBM data. Returns the region to load, or null.
 *
 * The math: if any edge of the visible rect is within `paddingTiles` of
 * the corresponding edge of `bounds`, we place a new region centered
 * `EXPANSION_RADIUS` tiles ahead of the camera in that direction.
 * Only the *first* offending edge is acted on per call — the next
 * render cycle will catch the others if needed.
 */
export function needsExpansion(
  bounds: Bounds | null,
  visible: ViewRect,
  z: number,
  paddingTiles: number,
): OtbmRegion | null {
  if (!bounds) return null;

  // Check each edge: is the visible rect within padding of the loaded bounds?
  if (visible.x1 <= bounds.minX + paddingTiles) {
    return {
      centerX: bounds.minX - EXPANSION_RADIUS,
      centerY: Math.floor((visible.y1 + visible.y2) / 2),
      radius: EXPANSION_RADIUS,
      z,
    };
  }
  if (visible.x2 >= bounds.maxX - paddingTiles) {
    return {
      centerX: bounds.maxX + EXPANSION_RADIUS,
      centerY: Math.floor((visible.y1 + visible.y2) / 2),
      radius: EXPANSION_RADIUS,
      z,
    };
  }
  if (visible.y1 <= bounds.minY + paddingTiles) {
    return {
      centerX: Math.floor((visible.x1 + visible.x2) / 2),
      centerY: bounds.minY - EXPANSION_RADIUS,
      radius: EXPANSION_RADIUS,
      z,
    };
  }
  if (visible.y2 >= bounds.maxY - paddingTiles) {
    return {
      centerX: Math.floor((visible.x1 + visible.x2) / 2),
      centerY: bounds.maxY + EXPANSION_RADIUS,
      radius: EXPANSION_RADIUS,
      z,
    };
  }

  return null;
}
