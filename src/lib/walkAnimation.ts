import type { PlayerState } from './player';
import { Direction } from './player';
import type { PathNode } from './pathfinding';

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

  // Cycle animation phase (1 and 2 are walk frames, 0 is idle)
  const phaseTime = elapsed % (WALK_DURATION_MS * 2);
  player.animationPhase = phaseTime < WALK_DURATION_MS ? 1 : 2;

  if (walk.progress >= 1) {
    // Step completed — move player to destination tile
    player.x = walk.toX;
    player.y = walk.toY;
    player.animationPhase = 0;

    // Start next step if path continues
    if (walk.path.length > 0) {
      const next = walk.path[0];
      walk.path = walk.path.slice(1);
      walk.fromX = player.x;
      walk.fromY = player.y;
      walk.toX = next.x;
      walk.toY = next.y;
      walk.progress = 0;
      walk.startTime = now;

      const dir = computeDirection(player.x, player.y, next.x, next.y);
      if (dir !== null) player.direction = dir;
    } else {
      walk.active = false;
    }

    return { offsetX: 0, offsetY: 0 };
  }

  // Interpolate between tiles
  const dx = walk.toX - walk.fromX;
  const dy = walk.toY - walk.fromY;

  return {
    offsetX: dx * walk.progress * 32,
    offsetY: dy * walk.progress * 32,
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
