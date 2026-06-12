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

  const visibleCenterX = midpoint(visible.x1, visible.x2);
  const visibleCenterY = midpoint(visible.y1, visible.y2);
  const nearWestEdge = visible.x1 <= bounds.minX + paddingTiles;
  const nearEastEdge = visible.x2 >= bounds.maxX - paddingTiles;
  const nearNorthEdge = visible.y1 <= bounds.minY + paddingTiles;
  const nearSouthEdge = visible.y2 >= bounds.maxY - paddingTiles;

  if (nearWestEdge) {
    return expansionRegion(bounds.minX - EXPANSION_RADIUS, visibleCenterY, z);
  }
  if (nearEastEdge) {
    return expansionRegion(bounds.maxX + EXPANSION_RADIUS, visibleCenterY, z);
  }
  if (nearNorthEdge) {
    return expansionRegion(visibleCenterX, bounds.minY - EXPANSION_RADIUS, z);
  }
  if (nearSouthEdge) {
    return expansionRegion(visibleCenterX, bounds.maxY + EXPANSION_RADIUS, z);
  }

  return null;
}

function midpoint(a: number, b: number): number {
  return Math.floor((a + b) / 2);
}

function expansionRegion(centerX: number, centerY: number, z: number): OtbmRegion {
  return { centerX, centerY, radius: EXPANSION_RADIUS, z };
}

const MIN_EXPANSION_RADIUS = 100;
const MAX_EXPANSION_RADIUS = 500;

/**
 * Anticipatory expansion: check if a walk destination is near or outside
 * the loaded map bounds. If so, return a region that covers both the
 * destination and the gap from current bounds.
 *
 * The region is centered on the midpoint between the destination and its
 * nearest point on the bounds rectangle, with radius clamped to
 * [MIN, MAX]. Measuring from the nearest edge (not the bounds center)
 * matters on large explored maps: a tap just past the east edge should
 * grow the map eastward, not produce a region centered deep inside
 * already-loaded tiles. One bigger expansion is still cheaper than
 * several iterative ones, so the radius keeps a generous +50 buffer.
 */
export function needsExpansionForDestination(
  bounds: Bounds | null,
  destX: number,
  destY: number,
  z: number,
  paddingTiles: number,
): OtbmRegion | null {
  if (!bounds) return null;

  const nearLeft = destX <= bounds.minX + paddingTiles;
  const nearRight = destX >= bounds.maxX - paddingTiles;
  const nearTop = destY <= bounds.minY + paddingTiles;
  const nearBottom = destY >= bounds.maxY - paddingTiles;

  if (!nearLeft && !nearRight && !nearTop && !nearBottom) return null;

  // Nearest point on the bounds rectangle to the destination — the spot
  // the expansion should grow outward from.
  const edgeX = Math.min(Math.max(destX, bounds.minX), bounds.maxX);
  const edgeY = Math.min(Math.max(destY, bounds.minY), bounds.maxY);

  const midX = Math.floor((edgeX + destX) / 2);
  const midY = Math.floor((edgeY + destY) / 2);
  const halfDist = Math.max(
    Math.abs(destX - edgeX),
    Math.abs(destY - edgeY),
  ) / 2;
  const radius = Math.min(MAX_EXPANSION_RADIUS, Math.max(MIN_EXPANSION_RADIUS, Math.floor(halfDist) + 50));

  const region = { centerX: midX, centerY: midY, radius, z };
  if (import.meta.env.DEV && (
    Math.abs(destX - midX) > radius || Math.abs(destY - midY) > radius
  )) {
    // Diagnostic for the iterative-expansion case: the destination is so
    // far out that even MAX_EXPANSION_RADIUS can't reach it in one parse.
    console.warn(
      `regionExpansion: computed region (center ${midX},${midY} r${radius}) does not contain destination (${destX},${destY})`,
    );
  }
  return region;
}
