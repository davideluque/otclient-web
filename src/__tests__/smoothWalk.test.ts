import { describe, expect, it } from 'vitest';
import {
  SNAP_DISTANCE,
  STEP_GLIDE_DEFAULT_MS,
  STEP_GLIDE_MIN_MS,
  advanceRenderPos,
  nextStepEma,
} from '../lib/jamera/renderer';
import { GameWorld } from '../lib/GameWorld';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';

describe('advanceRenderPos (pursuit)', () => {
  it('chases the target at one tile per cadence', () => {
    const pos = { x: 100, y: 200 };
    advanceRenderPos(pos, 101, 200, 200, 400); // half a cadence elapsed
    expect(pos.x).toBeCloseTo(100.5, 5);
    expect(pos.y).toBe(200);
    advanceRenderPos(pos, 101, 200, 400, 400); // overshoot clamps to target
    expect(pos).toEqual({ x: 101, y: 200 });
  });

  it('never jumps when a new step confirms mid-chase — it keeps chasing', () => {
    const pos = { x: 100, y: 200 };
    advanceRenderPos(pos, 101, 200, 300, 400); // 0.75 of the way
    // Next confirmation arrives early: target moves to 102 — continuous.
    advanceRenderPos(pos, 102, 200, 16, 400);
    expect(pos.x).toBeGreaterThan(100.75);
    expect(pos.x).toBeLessThan(101);
  });

  it('boosts when more than a tile behind, snaps past SNAP_DISTANCE', () => {
    const slow = { x: 100, y: 200 };
    advanceRenderPos(slow, 101.5, 200, 100, 400);
    expect(slow.x).toBeGreaterThan(100.25); // 1.6x the base 0.25-tile step

    const tele = { x: 100, y: 200 };
    advanceRenderPos(tele, 100 + SNAP_DISTANCE + 0.1, 200, 16, 400);
    expect(tele.x).toBeCloseTo(100 + SNAP_DISTANCE + 0.1, 5);
  });

  it('is idle at the target', () => {
    const pos = { x: 101, y: 200 };
    advanceRenderPos(pos, 101, 200, 16, 400);
    expect(pos).toEqual({ x: 101, y: 200 });
  });
});

describe('nextStepEma', () => {
  it('converges toward the sampled cadence', () => {
    let ema = STEP_GLIDE_DEFAULT_MS;
    for (let i = 0; i < 20; i++) ema = nextStepEma(ema, 500);
    expect(ema).toBeGreaterThan(480);
    expect(ema).toBeLessThanOrEqual(500);
  });

  it('ignores standing pauses and absurdly fast samples', () => {
    expect(nextStepEma(400, 5000)).toBe(400);
    expect(nextStepEma(400, STEP_GLIDE_MIN_MS - 1)).toBe(400);
  });
});

describe('floor-change resync slices do not record a glide origin', () => {
  it('snapSelfSync suppresses the origin and a microtask re-arms it', async () => {
    const world = new GameWorld(new GameProtocol());
    world.playerCreatureId = 7;
    world.playerX = 50; world.playerY = 60; world.playerZ = 7;
    // @ts-expect-error private registry
    world.creatures.set(7, {
      id: 7, name: 'me', x: 50, y: 60, z: 7,
      direction: 2, health: 100, speed: 220,
      outfit: { lookType: 128, head: 0, body: 0, legs: 0, feet: 0 },
    });
    // @ts-expect-error private flag
    world.snapSelfSync = true;
    queueMicrotask(() => {
      // @ts-expect-error private flag
      world.snapSelfSync = false;
    });

    world.playerX = 49;
    // @ts-expect-error private method
    world.syncSelfCreature(50, 60, 7);
    expect(world.getCreature(7)?.fromX).toBeUndefined();

    await Promise.resolve();

    world.playerY = 59;
    // @ts-expect-error private method
    world.syncSelfCreature(49, 60, 7);
    expect(world.getCreature(7)?.fromX).toBe(49);
    expect(world.getCreature(7)?.fromY).toBe(60);
  });
});
