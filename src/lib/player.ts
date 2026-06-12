import type { DatFile, ThingType, FrameGroup } from './dat';

export const Direction = {
  North: 0,
  East: 1,
  South: 2,
  West: 3,
} as const;

export type Direction = (typeof Direction)[keyof typeof Direction];

/**
 * Tibia movement updates carry positions, not facing. Adjacent diagonal
 * steps face east/west, while teleports keep the previous direction.
 */
export function directionFromStepDelta<T extends number>(dx: number, dy: number, fallback: T): Direction | T {
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return fallback;
  if (dx > 0) return Direction.East;
  if (dx < 0) return Direction.West;
  if (dy > 0) return Direction.South;
  if (dy < 0) return Direction.North;
  return fallback;
}

export interface Outfit {
  lookType: number;
  headColor: number;
  bodyColor: number;
  legsColor: number;
  feetColor: number;
}

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  direction: Direction;
  outfit: Outfit;
  /** Current walk animation phase (0 = idle). */
  animationPhase: number;
}

/**
 * Sprite ID for a creature frame, following the .dat sprite index layout:
 * patterns are ordered (z, y, x) within each animation phase, with
 * layers × height × width sprites per pattern. Creature pattern X is the
 * facing direction; pattern Y/Z are 1, so direction alone picks the
 * pattern within a phase.
 */
export function getCreatureSpriteId(
  fg: FrameGroup,
  direction: Direction,
  animationPhase: number,
  layer = 0,
): number {
  const clampedDirection = Math.max(0, Math.min(direction, fg.numPatternX - 1));
  const clampedPhase = Math.max(0, Math.min(animationPhase, fg.animationPhases - 1));
  const clampedLayer = Math.max(0, Math.min(layer, fg.layers - 1));

  const patternCount = fg.numPatternZ * fg.numPatternY * fg.numPatternX;
  const spritesPerPattern = fg.layers * fg.height * fg.width;
  const patternIndex = clampedPhase * patternCount + clampedDirection;
  const spriteIndex = patternIndex * spritesPerPattern + clampedLayer * fg.height * fg.width;

  return fg.spriteIds[spriteIndex] ?? 0;
}

/** Build O(1) lookup from creature lookType (1-based ID) → ThingType. */
export function buildCreatureIndex(dat: DatFile): Map<number, ThingType> {
  const index = new Map<number, ThingType>();
  for (const creature of dat.creatures) {
    index.set(creature.id, creature);
  }
  return index;
}

export function createPlayer(
  x: number, y: number, z: number,
  outfit: Outfit,
): PlayerState {
  return {
    x, y, z,
    direction: Direction.South,
    outfit,
    animationPhase: 0,
  };
}
