import { DISTANCE_SHOT_TTL_MS } from '../GameWorld';

/** Walk frame duration — two alternating walk poses at ~8 fps. */
export const WALK_FRAME_MS = 125;

/** Magic-effect animation cadence: 100 ms per .dat phase (OTClient's 7.6 timing). */
export const EFFECT_PHASE_MS = 100;

/**
 * Which .dat animation phase a magic effect shows at `now`, or -1 once
 * it has played through — effects run once, they don't loop.
 */
export function effectPhaseAt(now: number, startedAt: number, animationPhases: number): number {
  const phase = Math.floor((now - startedAt) / EFFECT_PHASE_MS);
  return phase < animationPhases ? phase : -1;
}

/**
 * Sprite pick from a missile's 3×3 directional pattern grid — the
 * OTClient thingtype convention: patX is the flight's horizontal
 * component (west 0, none 1, east 2), patY the vertical (north 0,
 * none 1, south 2). The delta is snapped to 8 directions by angle
 * first (OTClient's getDirectionFromPosition), not by raw sign — a
 * (7, 1) shot flies east, not southeast.
 */
// Octants: 0 = E, 1 = NE, 2 = N, 3 = NW, ±4 = W, -3 = SW, -2 = S, -1 = SE.
// Module-level so the per-shot per-frame lookup allocates nothing.
const MISSILE_PATTERN_BY_OCTANT: Record<number, { patX: number; patY: number }> = {
  0: { patX: 2, patY: 1 },
  1: { patX: 2, patY: 0 },
  2: { patX: 1, patY: 0 },
  3: { patX: 0, patY: 0 },
  4: { patX: 0, patY: 1 },
  [-4]: { patX: 0, patY: 1 },
  [-3]: { patX: 0, patY: 2 },
  [-2]: { patX: 1, patY: 2 },
  [-1]: { patX: 2, patY: 2 },
};

export function missilePattern(dx: number, dy: number): { patX: number; patY: number } {
  if (dx === 0 && dy === 0) return { patX: 1, patY: 1 };
  // Screen y grows southward; flip it so atan2 works in math space.
  const octant = Math.round(Math.atan2(-dy, dx) / (Math.PI / 4));
  return MISSILE_PATTERN_BY_OCTANT[octant];
}

/** Flight progress 0→1 of a distance shot at `now`, clamped at landing. */
export function shotProgressAt(now: number, startedAt: number): number {
  return Math.min(1, Math.max(0, (now - startedAt) / DISTANCE_SHOT_TTL_MS));
}

export function walkPhase(moving: boolean, now: number): number {
  if (!moving) return 0;
  // Phases 1..n-1 are the walk cycle (renderPlayer clamps to the
  // outfit's actual phase count).
  return 1 + (Math.floor(now / WALK_FRAME_MS) % 2);
}

