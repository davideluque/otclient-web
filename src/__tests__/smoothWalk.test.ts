import { describe, expect, it } from 'vitest';
import { STEP_GLIDE_MS, interpPos } from '../lib/jamera/renderer';
import { GameWorld, type WorldCreature } from '../lib/GameWorld';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';

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

describe('floor-change resync slices do not glide', () => {
  function makeWorld(): GameWorld {
    const world = new GameWorld(new GameProtocol());
    world.playerCreatureId = 7;
    world.playerX = 50; world.playerY = 60; world.playerZ = 7;
    // @ts-expect-error private registry
    world.creatures.set(7, {
      id: 7, name: 'me', x: 50, y: 60, z: 7,
      direction: 2, health: 100, speed: 220,
      outfit: { lookType: 128, head: 0, body: 0, legs: 0, feet: 0 },
    });
    return world;
  }

  it('snapSelfSync suppresses the origin and a microtask re-arms it', async () => {
    const world = makeWorld();
    // Simulate what handleFloorChange does before the trailing slices.
    // @ts-expect-error private flag
    world.snapSelfSync = true;
    queueMicrotask(() => {
      // @ts-expect-error private flag
      world.snapSelfSync = false;
    });

    // A same-z ±1 resync slice (what 0x68 does after 0xBE): must NOT glide.
    world.playerX = 49;
    // @ts-expect-error private method
    world.syncSelfCreature(50, 60, 7);
    expect(world.getCreature(7)?.fromX).toBeUndefined();

    await Promise.resolve(); // microtask drains — transition over

    // The first real step afterwards glides again.
    world.playerY = 59;
    // @ts-expect-error private method
    world.syncSelfCreature(49, 60, 7);
    expect(world.getCreature(7)?.fromX).toBe(49);
    expect(world.getCreature(7)?.fromY).toBe(60);
  });
});
