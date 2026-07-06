import { drawRange } from './floorVisibility';

/**
 * Which floors the renderer stacks below (and including) the player, and
 * which of them actually need repainting — the pure half of the
 * per-floor tile-layer policy in jamera/renderer.ts, split out so the
 * decisions stay unit-testable without a Pixi stage.
 */

/**
 * At most this many floors below the player draw, regardless of what the
 * draw range allows (design/multifloor.md perf policy — the offline
 * viewer shipped with this cap and deep pits read fine). Underground the
 * server's z+2 window is the tighter bound anyway; the cap only bites on
 * the surface stack.
 */
export const BELOW_FLOOR_CAP = 3;

/**
 * The floors to draw from the player's floor downward, deepest FIRST —
 * exactly the order their containers stack, so shallower floors paint
 * over deeper ones. Always contains at least playerZ itself.
 */
export function drawnFloorsBelow(playerZ: number): number[] {
  const last = Math.min(playerZ + BELOW_FLOOR_CAP, drawRange(playerZ).last);
  const floors: number[] = [];
  for (let z = last; z >= playerZ; z--) floors.push(z);
  return floors;
}

/**
 * The subset of `drawn` floors whose world revision moved since they
 * were last painted (absent = 0 on the world side; a floor never painted
 * is always dirty). Order is preserved from `drawn`.
 */
export function dirtyFloors(
  drawn: readonly number[],
  painted: ReadonlyMap<number, number>,
  current: ReadonlyMap<number, number>,
): number[] {
  return drawn.filter((z) => painted.get(z) !== (current.get(z) ?? 0));
}
