import type { TileMap } from './tileMap';
import type { ThingType } from './dat';
import { DatAttr } from './dat';

export interface PathNode {
  x: number;
  y: number;
}

interface OpenPathNode extends PathNode {
  g: number;
  f: number;
}

const NEIGHBORS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

const MAX_PATH_LENGTH = 128;

function manhattanDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/**
 * Check if a tile is walkable. A tile is not walkable if:
 * - It doesn't exist in the tile map (no ground)
 * - Any of its items has the NotWalkable or NotPathable attribute in .dat
 *
 * Exception: tiles carrying a floor-change flag (stairs, holes, ladders)
 * are always walkable, even when the stair item also flags NotWalkable
 * in .dat — they're the entry point to the next floor. TFS treats them
 * the same way (`Tile::queryDestination` resolves the next floor's
 * position rather than blocking on the stair item itself).
 */
export function isTileWalkable(
  x: number, y: number, z: number,
  tileMap: TileMap,
  datIndex: Map<number, ThingType>,
): boolean {
  const tile = tileMap.getTile(x, y, z);
  if (!tile) return false;

  // Floor-change items override their own block flags (a stair's own
  // BlockSolid is bypassed because the stair is the entry point to the
  // next floor) but they do NOT override blocks from *other* items on
  // the same tile — a wall stacked next to a stair still blocks. One
  // pass over the stack; floor-change items are skipped from the block
  // check, anything else still has the chance to veto.
  for (const item of tile.items) {
    if (item.floorChange) continue;
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

  const openSet = new Map<string, OpenPathNode>();
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();

  const startKey = `${startX}:${startY}`;
  const goalKey = `${goalX}:${goalY}`;

  gScore.set(startKey, 0);
  openSet.set(startKey, {
    x: startX, y: startY,
    g: 0,
    f: manhattanDistance(startX, startY, goalX, goalY),
  });

  while (openSet.size > 0) {
    const [currentKey, current] = takeLowestCostNode(openSet);

    if (currentKey === goalKey) {
      return reconstructPath(cameFrom, goalKey, startKey);
    }

    for (const { dx, dy } of NEIGHBORS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const neighborKey = `${nx}:${ny}`;

      if (!isTileWalkable(nx, ny, z, tileMap, datIndex)) continue;
      // Floor-change tiles are reachable as a destination but A* must
      // not route *through* them — otherwise a stair on a same-floor
      // path would teleport the walker mid-route. Matches TFS
      // Tile::queryAdd, which returns RETURNVALUE_NOTPOSSIBLE for
      // floor-change tiles when FLAG_PATHFINDING is set.
      if (neighborKey !== goalKey && tileMap.getFloorChange(nx, ny, z)) continue;

      const tentativeG = current.g + 1;

      if (tentativeG > MAX_PATH_LENGTH) continue;

      const prevG = gScore.get(neighborKey);
      if (prevG !== undefined && tentativeG >= prevG) continue;

      gScore.set(neighborKey, tentativeG);
      cameFrom.set(neighborKey, currentKey);

      openSet.set(neighborKey, {
        x: nx, y: ny,
        g: tentativeG,
        f: tentativeG + manhattanDistance(nx, ny, goalX, goalY),
      });
    }
  }

  return null;
}

function takeLowestCostNode(openSet: Map<string, OpenPathNode>): [string, OpenPathNode] {
  let bestKey = '';
  let bestNode: OpenPathNode | null = null;

  for (const [key, node] of openSet) {
    if (!bestNode || node.f < bestNode.f) {
      bestKey = key;
      bestNode = node;
    }
  }

  if (!bestNode) {
    throw new Error('cannot take a path node from an empty open set');
  }

  openSet.delete(bestKey);
  return [bestKey, bestNode];
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
