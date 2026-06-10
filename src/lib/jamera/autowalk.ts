import type { GameWorld } from '../GameWorld';
import type { ThingType } from '../dat';
import { DatAttr } from '../dat';
import type { WalkDirection } from '../net/common/types';

/**
 * Tap-to-walk route finding over the live GameWorld.
 *
 * A* on the player's floor across the tiles the server has described
 * (the ~18×14 window plus whatever walking has accumulated), cardinal
 * steps only — matching the joystick and what `Game::playerAutoWalk`
 * paces best. The route is sent as one 0x64 packet; the server walks
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
];

/** Search cap — the visible window is 18×14, anything past this is junk taps. */
const MAX_EXPANDED_NODES = 1024;

export function isWorldTileWalkable(
  world: GameWorld,
  datIndex: Map<number, ThingType>,
  x: number, y: number, z: number,
): boolean {
  const tile = world.getTile(x, y, z);
  if (!tile) return false;
  if (tile.items.length === 0) return false; // no ground described
  for (const item of tile.items) {
    const thing = datIndex.get(item.id);
    if (thing && (thing.attrs.has(DatAttr.NotWalkable) || thing.attrs.has(DatAttr.NotPathable))) {
      return false;
    }
  }
  return true;
}

function creatureBlocks(world: GameWorld, x: number, y: number, z: number): boolean {
  const tile = world.getTile(x, y, z);
  return !!tile && tile.creatures.some((c) => c.id !== world.playerCreatureId);
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
): WalkDirection[] | null {
  const z = world.playerZ;
  const sx = world.playerX;
  const sy = world.playerY;
  if (sx === goalX && sy === goalY) return [];
  if (!isWorldTileWalkable(world, datIndex, goalX, goalY, z)) return null;

  const key = (x: number, y: number): string => `${x}:${y}`;
  const h = (x: number, y: number): number => Math.abs(x - goalX) + Math.abs(y - goalY);

  const open = new Map<string, { x: number; y: number; g: number; f: number }>();
  const cameFrom = new Map<string, { from: string; dir: WalkDirection }>();
  const gScore = new Map<string, number>();
  const closed = new Set<string>();

  const startKey = key(sx, sy);
  open.set(startKey, { x: sx, y: sy, g: 0, f: h(sx, sy) });
  gScore.set(startKey, 0);

  let expanded = 0;
  while (open.size > 0 && expanded < MAX_EXPANDED_NODES) {
    // Lowest f in the open set (the window is tiny — a heap is overkill).
    let current: { x: number; y: number; g: number; f: number } | null = null;
    let currentKey = '';
    for (const [k, n] of open) {
      if (!current || n.f < current.f) { current = n; currentKey = k; }
    }
    if (!current) break;
    open.delete(currentKey);
    closed.add(currentKey);
    expanded++;

    if (current.x === goalX && current.y === goalY) {
      // Reconstruct, walking back to the start.
      const route: WalkDirection[] = [];
      let k = currentKey;
      while (k !== startKey) {
        const step = cameFrom.get(k);
        if (!step) return null; // unreachable bookkeeping bug guard
        route.push(step.dir);
        k = step.from;
      }
      route.reverse();
      return route;
    }

    for (const { dir, dx, dy } of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      if (!isWorldTileWalkable(world, datIndex, nx, ny, z)) continue;
      // Creatures block intermediate steps but not the goal tile itself
      // (the server stops the walk next to it anyway).
      const isGoal = nx === goalX && ny === goalY;
      if (!isGoal && creatureBlocks(world, nx, ny, z)) continue;

      const g = current.g + 1;
      const known = gScore.get(nk);
      if (known !== undefined && g >= known) continue;
      gScore.set(nk, g);
      cameFrom.set(nk, { from: currentKey, dir });
      open.set(nk, { x: nx, y: ny, g, f: g + h(nx, ny) });
    }
  }

  return null;
}
