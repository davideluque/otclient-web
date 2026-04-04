import type { TileMap } from './tileMap';
import type { ThingType } from './dat';
import { DatAttr } from './dat';

export interface PathNode {
  x: number;
  y: number;
}

const NEIGHBORS = [
  { dx: 0, dy: -1 }, // North
  { dx: 1, dy: 0 },  // East
  { dx: 0, dy: 1 },  // South
  { dx: -1, dy: 0 }, // West
];

const MAX_PATH_LENGTH = 128;

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/**
 * Check if a tile is walkable. A tile is not walkable if:
 * - It doesn't exist in the tile map (no ground)
 * - Any of its items has the NotWalkable or NotPathable attribute in .dat
 */
export function isTileWalkable(
  x: number, y: number, z: number,
  tileMap: TileMap,
  datIndex: Map<number, ThingType>,
): boolean {
  const tile = tileMap.getTile(x, y, z);
  if (!tile) return false;

  for (const item of tile.items) {
    const thingType = datIndex.get(item.clientId);
    if (thingType && (thingType.attrs.has(DatAttr.NotWalkable) || thingType.attrs.has(DatAttr.NotPathable))) {
      return false;
    }
  }

  return true;
}

/**
 * A* pathfinding on the tile grid.
 * Returns an array of tile positions from start (exclusive) to goal (inclusive),
 * or null if no path is found.
 */
export function findPath(
  startX: number, startY: number,
  goalX: number, goalY: number,
  z: number,
  tileMap: TileMap,
  datIndex: Map<number, ThingType>,
): PathNode[] | null {
  if (startX === goalX && startY === goalY) return [];

  if (!isTileWalkable(goalX, goalY, z, tileMap, datIndex)) return null;

  const openSet = new Map<string, { x: number; y: number; g: number; f: number }>();
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();

  const startKey = `${startX}:${startY}`;
  const goalKey = `${goalX}:${goalY}`;

  gScore.set(startKey, 0);
  openSet.set(startKey, {
    x: startX, y: startY,
    g: 0,
    f: heuristic(startX, startY, goalX, goalY),
  });

  while (openSet.size > 0) {
    // Find node with lowest f in open set
    let bestKey = '';
    let bestF = Infinity;
    for (const [key, node] of openSet) {
      if (node.f < bestF) {
        bestF = node.f;
        bestKey = key;
      }
    }

    const current = openSet.get(bestKey)!;
    openSet.delete(bestKey);

    if (bestKey === goalKey) {
      return reconstructPath(cameFrom, goalKey, startKey);
    }

    for (const { dx, dy } of NEIGHBORS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const neighborKey = `${nx}:${ny}`;

      if (!isTileWalkable(nx, ny, z, tileMap, datIndex)) continue;

      const tentativeG = current.g + 1;

      if (tentativeG > MAX_PATH_LENGTH) continue;

      const prevG = gScore.get(neighborKey);
      if (prevG !== undefined && tentativeG >= prevG) continue;

      gScore.set(neighborKey, tentativeG);
      cameFrom.set(neighborKey, bestKey);

      openSet.set(neighborKey, {
        x: nx, y: ny,
        g: tentativeG,
        f: tentativeG + heuristic(nx, ny, goalX, goalY),
      });
    }
  }

  return null; // No path found
}

function reconstructPath(
  cameFrom: Map<string, string>,
  goalKey: string,
  startKey: string,
): PathNode[] {
  const path: PathNode[] = [];
  let current = goalKey;

  while (current !== startKey) {
    const [x, y] = current.split(':').map(Number);
    path.unshift({ x, y });
    const prev = cameFrom.get(current);
    if (!prev) break;
    current = prev;
  }

  return path;
}
