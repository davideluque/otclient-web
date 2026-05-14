import type { PlayerState } from './player';
import { Direction } from './player';
import type { PathNode } from './pathfinding';
import { TILE_SIZE } from './tileRenderer';

/** Duration of one tile walk step in milliseconds. */
export const WALK_DURATION_MS = 200;

export interface WalkState {
  /** The path being walked (remaining nodes). */
  path: PathNode[];
  /** The tile the player is walking from. */
  fromX: number;
  fromY: number;
  /** The tile the player is walking to. */
  toX: number;
  toY: number;
  /** Progress through current step (0 to 1). */
  progress: number;
  /** Time when current step started. */
  startTime: number;
  /** Is the walk in progress? */
  active: boolean;
  /** The walking sprite phase for this step (1 or 2 — alternates per step).
   *  Held constant across the step so the gait doesn't snap to idle pose
   *  for one frame at every tile boundary, which produced a visible "front
   *  and back" oscillation on east/west walks. */
  walkPhase: 1 | 2;
}

/**
 * Start a walk along a path.
 */
export function startWalk(
  player: PlayerState,
  path: PathNode[],
  now: number,
): WalkState | null {
  if (path.length === 0) return null;

  const first = path[0];
  const dir = computeDirection(player.x, player.y, first.x, first.y);
  if (dir !== null) player.direction = dir;

  return {
    path: path.slice(1),
    fromX: player.x,
    fromY: player.y,
    toX: first.x,
    toY: first.y,
    progress: 0,
    startTime: now,
    active: true,
    walkPhase: 1,
  };
}

/**
 * Update walk animation. Call each frame with current timestamp.
 * Returns the interpolated pixel offset from the player's logical tile position.
 */
export function updateWalk(
  walk: WalkState,
  player: PlayerState,
  now: number,
): { offsetX: number; offsetY: number } {
  if (!walk.active) return { offsetX: 0, offsetY: 0 };

  const elapsed = now - walk.startTime;
  walk.progress = Math.min(elapsed / WALK_DURATION_MS, 1);

  // Hold this step's walk phase for its entire duration; phase alternates
  // at step boundaries (below) so the gait flows continuously instead of
  // snapping to idle each frame the step crosses.
  player.animationPhase = walk.walkPhase;

  if (walk.progress >= 1) {
    // Step completed — move player to destination tile
    player.x = walk.toX;
    player.y = walk.toY;

    // Start next step if path continues
    if (walk.path.length > 0) {
      const next = walk.path[0];
      walk.path = walk.path.slice(1);
      walk.fromX = player.x;
      walk.fromY = player.y;
      walk.toX = next.x;
      walk.toY = next.y;
      walk.progress = 0;
      // Advance the step clock by exactly one step's worth of time so the
      // ms we overshot in this frame carry into the next step instead of
      // being discarded — keeps chained walks honest to WALK_DURATION_MS.
      walk.startTime += WALK_DURATION_MS;
      walk.walkPhase = walk.walkPhase === 1 ? 2 : 1;
      // Apply the new phase immediately. The render-path rebuild that's
      // about to fire (player.x just changed) reads animationPhase, so
      // without this line the new step would render with the previous
      // step's phase and the gait would skip a beat.
      player.animationPhase = walk.walkPhase;

      const dir = computeDirection(player.x, player.y, next.x, next.y);
      if (dir !== null) player.direction = dir;
    } else {
      walk.active = false;
      player.animationPhase = 0;
    }

    return { offsetX: 0, offsetY: 0 };
  }

  // Interpolate between tiles
  const dx = walk.toX - walk.fromX;
  const dy = walk.toY - walk.fromY;

  return {
    offsetX: dx * walk.progress * TILE_SIZE,
    offsetY: dy * walk.progress * TILE_SIZE,
  };
}

function computeDirection(
  fromX: number, fromY: number,
  toX: number, toY: number,
): Direction | null {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return null;
  if (dx > 0) return Direction.East;
  if (dx < 0) return Direction.West;
  if (dy > 0) return Direction.South;
  return Direction.North;
}
