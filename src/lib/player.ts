import type { DatFile, ThingType, FrameGroup } from './dat';

export const Direction = {
  North: 0,
  East: 1,
  South: 2,
  West: 3,
} as const;

export type Direction = (typeof Direction)[keyof typeof Direction];

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
 * Get the sprite ID for a creature given its frame group, direction, and animation phase.
 *
 * Sprite index layout (from Tibia .dat format):
 * index = ((phase * numPatternZ + z) * numPatternY + y) * numPatternX + x) * layers + layer) * h + hIdx) * w + wIdx
 *
 * For basic creatures: w=1, h=1, layers=1-2, numPatternX=4 (directions), numPatternZ=1
 */
export function getCreatureSpriteId(
  fg: FrameGroup,
  direction: Direction,
  animationPhase: number,
  layer = 0,
): number {
  const w = fg.width;
  const h = fg.height;
  const layers = fg.layers;
  const patX = fg.numPatternX;
  const patY = fg.numPatternY;
  const patZ = fg.numPatternZ;

  // Clamp values to valid ranges
  const dir = Math.min(direction, patX - 1);
  const phase = Math.min(animationPhase, fg.animationPhases - 1);
  const l = Math.min(layer, layers - 1);

  // Sprite index for single-tile creatures (w=1, h=1, patY=1, patZ=1)
  // Full formula: ((((phase * patZ) * patY) * patX + dir) * layers + layer) * h * w
  const index = (((phase * patZ * patY) * patX + dir) * layers + l) * h * w;

  return fg.spriteIds[index] ?? 0;
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
