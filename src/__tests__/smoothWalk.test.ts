import { describe, expect, it } from 'vitest';
import { STEP_GLIDE_MS, interpPos } from '../lib/jamera/renderer';
import type { WorldCreature } from '../lib/GameWorld';

function creature(extra: Partial<WorldCreature>): WorldCreature {
  return {
    id: 1, name: 'c', x: 101, y: 200, z: 7, direction: 1,
    health: 100, speed: 220,
    outfit: { lookType: 128, head: 0, body: 0, legs: 0, feet: 0 },
    ...extra,
  } as WorldCreature;
}

describe('interpPos', () => {
  it('glides linearly from the departed tile to the confirmed one', () => {
    const c = creature({ fromX: 100, fromY: 200, lastMoveAt: 1000 });
    expect(interpPos(c, 1000)).toEqual({ x: 100, y: 200 });
    const half = interpPos(c, 1000 + STEP_GLIDE_MS / 2);
    expect(half.x).toBeCloseTo(100.5, 5);
    expect(half.y).toBe(200);
    expect(interpPos(c, 1000 + STEP_GLIDE_MS)).toEqual({ x: 101, y: 200 });
  });

  it('snaps when there is no from-tile (teleport / floor change / fresh spawn)', () => {
    expect(interpPos(creature({ lastMoveAt: 1000 }), 1010)).toEqual({ x: 101, y: 200 });
    expect(interpPos(creature({}), 1010)).toEqual({ x: 101, y: 200 });
  });

  it('snaps once the glide window has elapsed', () => {
    const c = creature({ fromX: 100, fromY: 200, lastMoveAt: 1000 });
    expect(interpPos(c, 1000 + STEP_GLIDE_MS + 1)).toEqual({ x: 101, y: 200 });
  });
});
