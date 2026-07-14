import type { GameWorld } from '../GameWorld';
import type { ThingType } from '../dat';
import { DatAttr } from '../dat';
import type { WalkDirection } from '../net/common/types';

/**
 * Tap-to-walk route finding over the live GameWorld.
 *
 * A* on the player's floor across the tiles the server has described
 * (the ~18×14 window plus whatever walking has accumulated), including
 * the four diagonal directions supported by Jamera's 7.6 protocol. The
 * route is sent as one 0x64 packet; the server walks
 * it and confirms every step exactly like manual moves, so position
 * tracking needs nothing new.
 *
 * Walkability mirrors the offline `isTileWalkable`: a tile must exist
 * (unknown tiles are NOT assumed walkable — the server never described
 * them) and carry no item flagged NotWalkable/NotPathable in the .dat.
 * Tiles with creatures are blocked except the destination, so a route
 * can end next to a monster without trying to path through one.
 */

const DIRS: ReadonlyArray<{ dir: WalkDirection; dx: number; dy: number }> = [
  { dir: 0, dx: 0, dy: -1 }, // north
  { dir: 1, dx: 1, dy: 0 },  // east
  { dir: 2, dx: 0, dy: 1 },  // south
  { dir: 3, dx: -1, dy: 0 }, // west
  { dir: 4, dx: 1, dy: -1 }, // north-east
  { dir: 5, dx: 1, dy: 1 },  // south-east
  { dir: 6, dx: -1, dy: 1 }, // south-west
  { dir: 7, dx: -1, dy: -1 }, // north-west
];

const CARDINAL_COST = 2;
// Jamera's Creature::getWalkDelay charges diagonals at 1.5× a cardinal.
const DIAGONAL_COST = 3;

/** Search cap — the visible window is 18×14, anything past this is junk taps. */
const MAX_EXPANDED_NODES = 1024;

interface RouteNode {
  readonly x: number;
  readonly y: number;
  readonly costFromStart: number;
  readonly estimatedTotalCost: number;
}

interface RouteStep {
  readonly from: string;
  readonly direction: WalkDirection;
}

export function isWorldTileWalkable(
  world: GameWorld,
  datIndex: Map<number, ThingType>,
  x: number, y: number, z: number,
  floorChangeIds?: Set<number>,
): boolean {
  const tile = world.getTile(x, y, z);
  if (!tile) return false;
  if (tile.items.length === 0) return false; // no ground described
  for (const item of tile.items) {
    // Stairs/ramps/holes flag NotWalkable in the .dat yet are exactly
    // where a walk must be able to END — same exception as the offline
    // isTileWalkable. Only the OTB knows which ids floor-change.
    if (floorChangeIds?.has(item.id)) continue;
    const thing = datIndex.get(item.id);
    if (thing && (thing.attrs.has(DatAttr.NotWalkable) || thing.attrs.has(DatAttr.NotPathable))) {
      return false;
    }
  }
  return true;
}

/** True when any item on the tile floor-changes (stair, ramp, hole). */
export function tileFloorChanges(
  world: GameWorld,
  x: number, y: number, z: number,
  floorChangeIds?: Set<number>,
): boolean {
  if (!floorChangeIds) return false;
  const tile = world.getTile(x, y, z);
  return !!tile && tile.items.some((item) => floorChangeIds.has(item.id));
}

function creatureBlocks(world: GameWorld, x: number, y: number, z: number): boolean {
  const tile = world.getTile(x, y, z);
  return !!tile && tile.creatures.some((c) => c.id !== world.playerCreatureId);
}

/** True when a tile flanking a diagonal step can't be walked through. */
function diagonalSideBlocked(
  world: GameWorld,
  datIndex: Map<number, ThingType>,
  x: number, y: number, z: number,
  floorChangeIds?: Set<number>,
): boolean {
  return !isWorldTileWalkable(world, datIndex, x, y, z, floorChangeIds)
    || creatureBlocks(world, x, y, z)
    || tileFloorChanges(world, x, y, z, floorChangeIds);
}

function floorTileKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function estimatedCostToGoal(x: number, y: number, goalX: number, goalY: number): number {
  const dx = Math.abs(x - goalX);
  const dy = Math.abs(y - goalY);
  const diagonal = Math.min(dx, dy);
  const cardinal = Math.max(dx, dy) - diagonal;
  return diagonal * DIAGONAL_COST + cardinal * CARDINAL_COST;
}

/**
 * Pop the open node with the lowest estimated total cost. Linear scan
 * on purpose: the search window is tiny (18×14 view, 1024-node cap), a
 * heap is overkill.
 */
function takeLowestCostNode(openNodes: Map<string, RouteNode>): { key: string; node: RouteNode } | null {
  let bestKey = '';
  let bestNode: RouteNode | null = null;

  for (const [key, node] of openNodes) {
    if (!bestNode || node.estimatedTotalCost < bestNode.estimatedTotalCost) {
      bestKey = key;
      bestNode = node;
    }
  }

  if (!bestNode) return null;
  openNodes.delete(bestKey);
  return { key: bestKey, node: bestNode };
}

/**
 * Walk the cameFrom chain back from the goal, first-step-first. Null on
 * a broken chain — an unreachable bookkeeping bug guard.
 */
function buildWalkRoute(
  cameFrom: Map<string, RouteStep>,
  startKey: string,
  goalKey: string,
): WalkDirection[] | null {
  const route: WalkDirection[] = [];
  let currentKey = goalKey;

  while (currentKey !== startKey) {
    const step = cameFrom.get(currentKey);
    if (!step) return null;
    route.push(step.direction);
    currentKey = step.from;
  }

  route.reverse();
  return route;
}

/**
 * A* from the player to (goalX, goalY) on the player's floor. Returns
 * the step directions first-step-first, [] when already there, or null
 * when the goal is unknown/blocked/unreachable.
 */
export function findWalkRoute(
  world: GameWorld,
  datIndex: Map<number, ThingType>,
  goalX: number,
  goalY: number,
  floorChangeIds?: Set<number>,
): WalkDirection[] | null {
  const z = world.playerZ;
  const sx = world.playerX;
  const sy = world.playerY;
  if (sx === goalX && sy === goalY) return [];
  if (!isWorldTileWalkable(world, datIndex, goalX, goalY, z, floorChangeIds)) return null;

  const openNodes = new Map<string, RouteNode>();
  const cameFrom = new Map<string, RouteStep>();
  const bestCostToTile = new Map<string, number>();
  const visitedTiles = new Set<string>();

  const startKey = floorTileKey(sx, sy);
  openNodes.set(startKey, {
    x: sx,
    y: sy,
    costFromStart: 0,
    estimatedTotalCost: estimatedCostToGoal(sx, sy, goalX, goalY),
  });
  bestCostToTile.set(startKey, 0);

  let expanded = 0;
  while (openNodes.size > 0 && expanded < MAX_EXPANDED_NODES) {
    const current = takeLowestCostNode(openNodes);
    if (!current) break;
    visitedTiles.add(current.key);
    expanded++;

    if (current.node.x === goalX && current.node.y === goalY) {
      return buildWalkRoute(cameFrom, startKey, current.key);
    }

    for (const { dir, dx, dy } of DIRS) {
      const nextX = current.node.x + dx;
      const nextY = current.node.y + dy;
      const nextKey = floorTileKey(nextX, nextY);
      if (visitedTiles.has(nextKey)) continue;
      if (!isWorldTileWalkable(world, datIndex, nextX, nextY, z, floorChangeIds)) continue;

      // Creatures block intermediate steps but not the goal tile itself
      // (the server stops the walk next to it anyway).
      const isGoalTile = nextX === goalX && nextY === goalY;
      if (!isGoalTile && creatureBlocks(world, nextX, nextY, z)) continue;
      // A floor-change tile is a valid destination but never a waypoint:
      // routing THROUGH a stair would teleport the walker mid-route —
      // same rule as the offline pathfinder.
      if (!isGoalTile && tileFloorChanges(world, nextX, nextY, z, floorChangeIds)) continue;

      // Diagonals are ESCAPE moves only — taken when exactly one flanking
      // side is blocked (the classic monster-in-front slip, or a wall
      // corner cut). With both sides open the diagonal is skipped: a
      // 1.5×-cost diagonal beats two cardinals, so allowing it turned
      // every open-ground path into a zig-zag; classic clients keep those
      // straight. Both sides blocked is squeezing through a closed
      // corner, which the server rejects.
      const isDiagonal = dx !== 0 && dy !== 0;
      if (isDiagonal) {
        const sideXBlocked = diagonalSideBlocked(
          world, datIndex, current.node.x + dx, current.node.y, z, floorChangeIds,
        );
        const sideYBlocked = diagonalSideBlocked(
          world, datIndex, current.node.x, current.node.y + dy, z, floorChangeIds,
        );
        if (sideXBlocked === sideYBlocked) continue;
      }

      const costFromStart = current.node.costFromStart
        + (isDiagonal ? DIAGONAL_COST : CARDINAL_COST);
      const knownCost = bestCostToTile.get(nextKey);
      if (knownCost !== undefined && costFromStart >= knownCost) continue;

      bestCostToTile.set(nextKey, costFromStart);
      cameFrom.set(nextKey, { from: current.key, direction: dir });
      openNodes.set(nextKey, {
        x: nextX,
        y: nextY,
        costFromStart,
        estimatedTotalCost: costFromStart + estimatedCostToGoal(nextX, nextY, goalX, goalY),
      });
    }
  }

  return null;
}
