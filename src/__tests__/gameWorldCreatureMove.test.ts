import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { GameWorld } from '../lib/GameWorld';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { resetItemWireFlags, setItemWireFlags } from '../lib/net/common/itemFlags';
import type { DatFile } from '../lib/dat';
import type { MapCreature, MapTile } from '../lib/net/common/types';

beforeAll(() => setItemWireFlags({
  signature: 0, itemCount: 0, creatureCount: 0, effectCount: 0, missileCount: 0,
  items: [], creatures: [], effects: [], missiles: [],
} as unknown as DatFile));
afterAll(() => resetItemWireFlags());

/**
 * 0x6D's stack position counts the WHOLE tile stack (ground + items +
 * creatures), not our creatures array. A monster standing on plain
 * ground moves with stackpos 1 — the old guard compared that against
 * creatures.length (1) and silently dropped the move, freezing nearly
 * every monster step on a real server.
 */

function makeCreature(id: number): MapCreature {
  return {
    id, name: `c${id}`, health: 100, direction: 0,
    outfit: { lookType: 21, head: 0, body: 0, legs: 0, feet: 0 },
    lightLevel: 0, lightColor: 0, speed: 134,
  } as MapCreature;
}

function world6D(itemsOnFrom: number): { world: GameWorld; dispatcher: PacketDispatcher } {
  const world = new GameWorld(new GameProtocol());
  const dispatcher = new PacketDispatcher();
  world.registerHandlers(dispatcher);
  const mc = makeCreature(42);
  const fromItems = Array.from({ length: itemsOnFrom }, (_, i) => ({ id: 100 + i }));
  const fromTile: MapTile = {
    x: 100, y: 200, z: 7,
    things: [...fromItems.map((item) => ({ kind: 'item' as const, item })), { kind: 'creature', creature: mc }],
    items: fromItems,
    creatures: [mc],
  };
  const toItem = { id: 100 };
  const toTile: MapTile = {
    x: 101, y: 200, z: 7,
    things: [{ kind: 'item', item: toItem }], items: [toItem], creatures: [],
  };
  // @ts-expect-error private state
  world.tiles.set('100:200:7', fromTile);
  // @ts-expect-error private state
  world.tiles.set('101:200:7', toTile);
  // @ts-expect-error private registry
  world.creatures.set(42, {
    id: 42, name: 'c42', x: 100, y: 200, z: 7,
    direction: 0, health: 100, speed: 134, outfit: mc.outfit,
  });
  return { world, dispatcher };
}

function dispatchMove(dispatcher: PacketDispatcher, fromStack: number): void {
  const out = new OutputPacket();
  out.addU8(0x6d);
  out.addPosition(100, 200, 7);
  out.addU8(fromStack);
  out.addPosition(101, 200, 7);
  dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));
}

describe('handleCreatureMove stackpos resolution', () => {
  it('moves a creature standing on plain ground (stackpos 1, the dropped case)', () => {
    const { world, dispatcher } = world6D(1); // ground item only
    dispatchMove(dispatcher, 1);

    expect(world.getCreature(42)?.x).toBe(101);
    expect(world.getTile(100, 200, 7)?.creatures).toHaveLength(0);
    expect(world.getTile(101, 200, 7)?.creatures).toHaveLength(1);
  });

  it('moves a creature on a stacked tile (ground + 2 items, stackpos 3)', () => {
    const { world, dispatcher } = world6D(3);
    dispatchMove(dispatcher, 3);
    expect(world.getCreature(42)?.x).toBe(101);
  });

  it('clamps when down-items inflate our item count past the stackpos', () => {
    // Tile model holds 3 items but the creature sits at stack 2 (the
    // third item is a down-item that stacks AFTER the creature).
    const { world, dispatcher } = world6D(3);
    dispatchMove(dispatcher, 2);
    expect(world.getCreature(42)?.x).toBe(101);
  });

  it('still derives the facing from the step delta', () => {
    const { world, dispatcher } = world6D(1);
    dispatchMove(dispatcher, 1);
    expect(world.getCreature(42)?.direction).toBe(1); // east
  });
});
