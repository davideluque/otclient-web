import { describe, it, expect } from 'vitest';
import { GameWorld, directionFromDelta } from '../lib/GameWorld';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import type { MapCreature, MapTile } from '../lib/net/common/types';

/**
 * 7.6 carries no facing byte with movement — neither the self-step
 * confirmations nor 0x6D CreatureMove. Facing must be derived from the
 * step delta, or every creature walks around frozen in its spawn
 * direction (the phone bug: "the player is always looking in the same
 * direction").
 */

describe('directionFromDelta', () => {
  it('maps cardinal steps to wire directions', () => {
    expect(directionFromDelta(0, -1, 9)).toBe(0); // north
    expect(directionFromDelta(1, 0, 9)).toBe(1);  // east
    expect(directionFromDelta(0, 1, 9)).toBe(2);  // south
    expect(directionFromDelta(-1, 0, 9)).toBe(3); // west
  });

  it('horizontal component wins on diagonals (Tibia faces east/west)', () => {
    expect(directionFromDelta(1, -1, 9)).toBe(1);
    expect(directionFromDelta(-1, 1, 9)).toBe(3);
  });

  it('keeps the previous facing on zero delta and teleports', () => {
    expect(directionFromDelta(0, 0, 2)).toBe(2);
    expect(directionFromDelta(5, 0, 2)).toBe(2);
    expect(directionFromDelta(0, -12, 0)).toBe(0);
  });
});

function makeCreature(id: number, direction: number): MapCreature {
  return {
    id, name: `c${id}`, health: 100, direction,
    outfit: { lookType: 128, head: 78, body: 69, legs: 58, feet: 95 },
    lightLevel: 0, lightColor: 0, speed: 220, skull: 0, party: 0,
  } as MapCreature;
}

function seedTile(world: GameWorld, x: number, y: number, z: number, creatures: MapCreature[]): void {
  const tile: MapTile = { x, y, z, items: [], creatures };
  // @ts-expect-error reaching into private state for the test
  (world.tiles as Map<string, MapTile>).set(`${x}:${y}:${z}`, tile);
}

describe('GameWorld facing on movement', () => {
  it('0x6D CreatureMove derives the facing from the step delta', () => {
    const world = new GameWorld(new GameProtocol());
    const mc = makeCreature(42, 0); // spawned facing north
    seedTile(world, 100, 200, 7, [mc]);
    seedTile(world, 101, 200, 7, []);
    // @ts-expect-error private registry
    world.creatures.set(42, {
      id: 42, name: 'c42', x: 100, y: 200, z: 7,
      direction: 0, health: 100, speed: 220, outfit: mc.outfit,
    });

    const out = new OutputPacket();
    out.addPosition(100, 200, 7); // from
    out.addU8(0);                 // stack index
    out.addPosition(101, 200, 7); // to: one east
    // @ts-expect-error private handler
    world.handleCreatureMove(new InputPacket(out.toArrayBuffer()));

    expect(world.getCreature(42)?.direction).toBe(1); // east
    expect(world.getTile(101, 200, 7)?.creatures[0]?.direction).toBe(1);
  });

  it('self steps update the player facing via syncSelfCreature', () => {
    const world = new GameWorld(new GameProtocol());
    world.playerCreatureId = 7;
    const mc = makeCreature(7, 2); // facing south
    seedTile(world, 50, 60, 7, [mc]);
    seedTile(world, 50, 59, 7, []);
    // @ts-expect-error private registry
    world.creatures.set(7, {
      id: 7, name: 'me', x: 50, y: 60, z: 7,
      direction: 2, health: 100, speed: 220, outfit: mc.outfit,
    });
    world.playerX = 50; world.playerY = 60; world.playerZ = 7;

    world.playerY = 59; // confirmed step north
    // @ts-expect-error private method
    world.syncSelfCreature(50, 60, 7);

    expect(world.getCreature(7)?.direction).toBe(0); // north
    expect(world.getTile(50, 59, 7)?.creatures[0]?.direction).toBe(0);
  });
});
