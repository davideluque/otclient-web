import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { GameWorld } from '../lib/GameWorld';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { resetItemWireFlags, setItemWireFlags } from '../lib/net/common/itemFlags';
import { calcFirstVisibleFloor } from '../lib/render/floorVisibility';
import { drawnFloorsAbove, coveringRevisionKey } from '../lib/render/floorStack';
import { DatAttr, ThingCategory } from '../lib/dat';
import type { DatFile, ThingType } from '../lib/dat';
import type { MapTile } from '../lib/net/common/types';

// Plain items only — an empty dat is the honest setup for the wire side;
// the roof semantics come from the local datIndex below.
beforeAll(() => setItemWireFlags({
  signature: 0, itemCount: 0, creatureCount: 0, effectCount: 0, missileCount: 0,
  items: [], creatures: [], effects: [], missiles: [],
} as unknown as DatFile));
afterAll(() => resetItemWireFlags());

function makeDatItem(clientId: number, attrIds: number[]): ThingType {
  return {
    id: clientId,
    category: ThingCategory.Item,
    attrs: new Map(attrIds.map((a) => [a, true])),
    frameGroup: {
      width: 1, height: 1, exactSize: 32, layers: 1,
      numPatternX: 1, numPatternY: 1, numPatternZ: 1,
      animationPhases: 1, spriteIds: [1],
    },
  };
}

const GROUND = 100; // plain walkable ground
const ROOF = 200;   // FullGround roof tile — covers the floors above it

const datIndex = new Map<number, ThingType>([
  [GROUND, makeDatItem(GROUND, [DatAttr.Ground])],
  [ROOF, makeDatItem(ROOF, [DatAttr.Ground, DatAttr.FullGround])],
]);

function mkTile(x: number, y: number, z: number, itemIds: number[]): MapTile {
  const items = itemIds.map((id) => ({ id }));
  return {
    x, y, z,
    things: items.map((item) => ({ kind: 'item' as const, item })),
    items,
    creatures: [],
  };
}

function seed(world: GameWorld, tile: MapTile): void {
  // @ts-expect-error reaching into private state for the test
  world.tiles.set(`${tile.x}:${tile.y}:${tile.z}`, tile);
}

function dispatch(dispatcher: PacketDispatcher, build: (out: OutputPacket) => void): void {
  const out = new OutputPacket();
  build(out);
  dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));
}

// The renderer path end-to-end minus Pixi: world state built over the
// wire drives the roof probe, whose result drives the drawn-above set.
describe('roof culling over the wire', () => {
  function indoorWorld(): { world: GameWorld; dispatcher: PacketDispatcher } {
    const world = new GameWorld(new GameProtocol());
    const dispatcher = new PacketDispatcher();
    world.registerHandlers(dispatcher);
    seed(world, mkTile(60, 60, 7, [GROUND]));
    seed(world, mkTile(60, 60, 6, [ROOF]));
    return { world, dispatcher };
  }

  it('a FullGround tile directly above hides every floor above the player', () => {
    const { world } = indoorWorld();

    const firstVisible = calcFirstVisibleFloor(world, datIndex, 60, 60, 7);

    expect(firstVisible).toBe(7);
    expect(drawnFloorsAbove(firstVisible, 7)).toEqual([]); // roof culled ≡ nothing above
  });

  it('a 0x69 roof removal re-opens the view to the whole surface stack', () => {
    const { world, dispatcher } = indoorWorld();
    const keyBefore = coveringRevisionKey(world.tileRevisionByZ, 7);

    dispatch(dispatcher, (out) => {
      out.addU8(0x69);
      out.addU16(60); out.addU16(60); out.addU8(6); // the roof tile
      out.addU16(0xff00); // empty marker — tile deleted
    });

    // The revision fingerprint must move — that is what tells the
    // renderer to rerun the probe without anyone taking a step.
    expect(coveringRevisionKey(world.tileRevisionByZ, 7)).not.toBe(keyBefore);

    const firstVisible = calcFirstVisibleFloor(world, datIndex, 60, 60, 7);
    expect(firstVisible).toBe(0);
    expect(drawnFloorsAbove(firstVisible, 7)).toEqual([6, 5, 4, 3, 2, 1, 0]);
  });
});
