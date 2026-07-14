import { drawRange } from './floorVisibility';

/**
 * Which floors the renderer stacks around the player, and which of them
 * actually need repainting — the pure half of the per-floor tile-layer
 * policy in jamera/renderer.ts, split out so the decisions stay
 * unit-testable without a Pixi stage.
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
 * The floors to draw above the player, deepest FIRST — the stacking
 * order of their containers, so the shallowest (nearest the viewer)
 * paints last. Empty when the roof probe found cover on the floor
 * directly above (`firstVisible === playerZ`) — that IS roof culling.
 */
export function drawnFloorsAbove(firstVisible: number, playerZ: number): number[] {
  const floors: number[] = [];
  for (let z = playerZ - 1; z >= firstVisible; z--) floors.push(z);
  return floors;
}

/** Keep every floor aligned to the same raw world-coordinate origin. */
export function floorLayerOffset(z: number, playerZ: number): { x: number; y: number } {
  void z;
  void playerZ;
  return { x: 0, y: 0 };
}

export interface GlideEndpoints { fromX: number; fromY: number; toX: number; toY: number }

/**
 * The two tiles a fractional camera position glides between, for the
 * anti-flicker roof probe (floorVisibility's firstVisibleFloorForGlide).
 * At rest floor === ceil and both endpoints are the camera tile. For the
 * rare diagonal glide these are the path's bounding corners rather than
 * the literal step endpoints — both adjacent to the path, and the
 * probe's max() rule keeps that safe (over-hiding for a half-step at
 * worst, never blinking a roof back in).
 */
export function glideEndpoints(camX: number, camY: number): GlideEndpoints {
  return {
    fromX: Math.floor(camX), fromY: Math.floor(camY),
    toX: Math.ceil(camX), toY: Math.ceil(camY),
  };
}

/**
 * Fingerprint of the revisions of every floor that could roof the
 * player (base..playerZ−1) — when it moves, cover may have appeared or
 * vanished (a door closing, a map edit) and the roof probe must rerun.
 * Watching the whole potential range, not just the currently drawn
 * floors: a roof re-appearing on a currently-hidden floor must still
 * retrigger the probe.
 */
export function coveringRevisionKey(
  revisions: ReadonlyMap<number, number>,
  playerZ: number,
): string {
  const parts: string[] = [];
  for (let z = drawRange(playerZ).base; z < playerZ; z++) {
    parts.push(String(revisions.get(z) ?? 0));
  }
  return parts.join(',');
}

/**
 * Group creatures by the floor they stand on, keeping only the drawn
 * floors — the pure partition behind the renderer's per-floor creature
 * passes. Every drawn floor gets an entry (possibly empty), in `drawn`
 * order, so callers can iterate floors and containers in lockstep;
 * creatures on floors outside the drawn set are simply not rendered.
 */
export function partitionByFloor<T extends { z: number }>(
  creatures: Iterable<T>,
  drawn: readonly number[],
): Map<number, T[]> {
  const byZ = new Map<number, T[]>(drawn.map((z) => [z, []]));
  for (const c of creatures) byZ.get(c.z)?.push(c);
  return byZ;
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

/**
 * Below-player floors are painted deepest-first, but their occlusion is
 * determined by shallower FullGround tiles. If a shallower floor changes,
 * every deeper painted layer must be rebuilt with the new skip set too.
 */
export function dirtyFloorsWithBelowOcclusion(
  drawn: readonly number[],
  painted: ReadonlyMap<number, number>,
  current: ReadonlyMap<number, number>,
): number[] {
  let lastDirty = -1;
  for (let i = 0; i < drawn.length; i++) {
    const z = drawn[i];
    if (painted.get(z) !== (current.get(z) ?? 0)) lastDirty = i;
  }
  return lastDirty === -1 ? [] : drawn.slice(0, lastDirty + 1);
}
