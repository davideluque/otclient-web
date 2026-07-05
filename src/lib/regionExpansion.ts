import type { ViewRect } from './viewport';
import type { Bounds } from './tileMap';
import type { OtbmRegion } from './otbm';

const DEFAULT_EXPANSION_RADIUS = 100;
const VIEWPORT_EDGE_PRIORITY = ['west', 'east', 'north', 'south'] as const;
type ViewportEdge = typeof VIEWPORT_EDGE_PRIORITY[number];

interface Point {
  x: number;
  y: number;
}

/**
 * Picks one viewport-edge expansion per call. The next render cycle can
 * request another edge after this region has merged into the loaded map.
 */
export function expansionRegionForViewportEdge(
  bounds: Bounds | null,
  visible: ViewRect,
  z: number,
  paddingTiles: number,
): OtbmRegion | null {
  if (!bounds) return null;

  const edge = firstViewportEdgeNearBounds(bounds, visible, paddingTiles);
  if (!edge) return null;

  return expansionRegionBeyondEdge(edge, bounds, visible, z);
}

function firstViewportEdgeNearBounds(
  bounds: Bounds,
  visible: ViewRect,
  paddingTiles: number,
): ViewportEdge | null {
  return VIEWPORT_EDGE_PRIORITY.find((edge) => viewportNearEdge(edge, bounds, visible, paddingTiles)) ?? null;
}

function viewportNearEdge(
  edge: ViewportEdge,
  bounds: Bounds,
  visible: ViewRect,
  paddingTiles: number,
): boolean {
  switch (edge) {
    case 'west': return visible.x1 <= bounds.minX + paddingTiles;
    case 'east': return visible.x2 >= bounds.maxX - paddingTiles;
    case 'north': return visible.y1 <= bounds.minY + paddingTiles;
    case 'south': return visible.y2 >= bounds.maxY - paddingTiles;
  }
}

function expansionRegionBeyondEdge(edge: ViewportEdge, bounds: Bounds, visible: ViewRect, z: number): OtbmRegion {
  const visibleCenterX = midpoint(visible.x1, visible.x2);
  const visibleCenterY = midpoint(visible.y1, visible.y2);

  switch (edge) {
    case 'west':
      return expansionRegion(bounds.minX - DEFAULT_EXPANSION_RADIUS, visibleCenterY, z);
    case 'east':
      return expansionRegion(bounds.maxX + DEFAULT_EXPANSION_RADIUS, visibleCenterY, z);
    case 'north':
      return expansionRegion(visibleCenterX, bounds.minY - DEFAULT_EXPANSION_RADIUS, z);
    case 'south':
      return expansionRegion(visibleCenterX, bounds.maxY + DEFAULT_EXPANSION_RADIUS, z);
  }
}

function midpoint(a: number, b: number): number {
  return Math.floor((a + b) / 2);
}

function expansionRegion(centerX: number, centerY: number, z: number): OtbmRegion {
  return { centerX, centerY, radius: DEFAULT_EXPANSION_RADIUS, z };
}

const MAX_EXPANSION_RADIUS = 500;

/**
 * Anticipatory expansion: if a walk destination is near or outside the
 * loaded bounds, return a region covering both the destination and the
 * gap from current bounds.
 *
 * Centered on the midpoint between the destination and its nearest point
 * on the bounds rectangle. Measuring from the nearest edge (not the bounds
 * center) matters on large explored maps: a tap just past the east edge
 * should grow the map eastward, not produce a region centered deep inside
 * already-loaded tiles. One bigger expansion is cheaper than several
 * iterative ones, so the radius keeps a generous +50 buffer.
 */
export function expansionRegionForDestination(
  bounds: Bounds | null,
  destinationX: number,
  destinationY: number,
  z: number,
  paddingTiles: number,
): OtbmRegion | null {
  if (!bounds) return null;
  if (destinationInsideSafeBounds(bounds, destinationX, destinationY, paddingTiles)) return null;

  const destination = { x: destinationX, y: destinationY };
  const edgePoint = nearestPointInBounds(bounds, destination);
  const center = midpointBetween(edgePoint, destination);
  const radius = expansionRadiusBetween(edgePoint, destination);

  const region = { centerX: center.x, centerY: center.y, radius, z };
  warnIfRegionMissesDestination(region, destination);
  return region;
}

function destinationInsideSafeBounds(bounds: Bounds, destX: number, destY: number, paddingTiles: number): boolean {
  return (
    destX > bounds.minX + paddingTiles &&
    destX < bounds.maxX - paddingTiles &&
    destY > bounds.minY + paddingTiles &&
    destY < bounds.maxY - paddingTiles
  );
}

function nearestPointInBounds(bounds: Bounds, point: Point): Point {
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  };
}

function midpointBetween(a: Point, b: Point): Point {
  return {
    x: midpoint(a.x, b.x),
    y: midpoint(a.y, b.y),
  };
}

function expansionRadiusBetween(edgePoint: Point, destination: Point): number {
  const halfDist = Math.max(
    Math.abs(destination.x - edgePoint.x),
    Math.abs(destination.y - edgePoint.y),
  ) / 2;
  // +50 buffer so one parse overshoots the gap rather than needing several.
  return clamp(Math.floor(halfDist) + 50, DEFAULT_EXPANSION_RADIUS, MAX_EXPANSION_RADIUS);
}

function warnIfRegionMissesDestination(region: OtbmRegion, destination: Point): void {
  // Diagnostic for the iterative-expansion case: the destination is so far
  // out that even MAX_EXPANSION_RADIUS can't reach it in one parse.
  if (import.meta.env.DEV && (
    Math.abs(destination.x - region.centerX) > region.radius ||
    Math.abs(destination.y - region.centerY) > region.radius
  )) {
    console.warn(
      `regionExpansion: computed region (center ${region.centerX},${region.centerY} r${region.radius}) does not contain destination (${destination.x},${destination.y})`,
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
