import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { GameWorld } from '../lib/GameWorld';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { resetItemWireFlags, setItemWireFlags } from '../lib/net/common/itemFlags';
import type { MapTile } from '../lib/net/common/types';
import type { DatFile } from '../lib/dat';

// Plain items only — an empty dat is the honest setup.
beforeAll(() => setItemWireFlags({
  signature: 0, itemCount: 0, creatureCount: 0, effectCount: 0, missileCount: 0,
  items: [], creatures: [], effects: [], missiles: [],
} as unknown as DatFile));
afterAll(() => resetItemWireFlags());

function makeWorld(): { world: GameWorld; dispatcher: PacketDispatcher } {
  const world = new GameWorld(new GameProtocol());
  const dispatcher = new PacketDispatcher();
  world.registerHandlers(dispatcher);
  return { world, dispatcher };
}

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

describe('per-floor tile revisions', () => {
  it('setTile bumps the tile floor alongside the global counter', () => {
    const { world } = makeWorld();
    const before = world.tileRevision;

    // @ts-expect-error driving the private tile path for the test
    world.setTile(mkTile(1, 1, 7, [100]));

    expect(world.tileRevision).toBe(before + 1);
    expect(world.tileRevisionByZ.get(7)).toBe(1);
    expect(world.tileRevisionByZ.get(6)).toBeUndefined();
  });

  it('0x6A TileAddThing moves only the target floor', () => {
    const { world, dispatcher } = makeWorld();

    dispatch(dispatcher, (out) => {
      out.addU8(0x6a);
      out.addU16(60); out.addU16(60); out.addU8(5); // position
      out.addU16(100); // plain item
    });

    expect(world.tileRevisionByZ.get(5)).toBe(1);
    expect(world.tileRevisionByZ.get(7)).toBeUndefined();
  });

  it('0x6C TileRemoveThing moves only the target floor', () => {
    const { world, dispatcher } = makeWorld();
    seed(world, mkTile(60, 60, 9, [100]));

    dispatch(dispatcher, (out) => {
      out.addU8(0x6c);
      out.addU16(60); out.addU16(60); out.addU8(9); // position
      out.addU8(0); // stack position
    });

    expect(world.tileRevisionByZ.get(9)).toBe(1);
    expect(world.tileRevisionByZ.get(7)).toBeUndefined();
  });

  it('0x69 empty-marker tile delete moves only the target floor', () => {
    const { world, dispatcher } = makeWorld();
    seed(world, mkTile(60, 60, 6, [100]));

    dispatch(dispatcher, (out) => {
      out.addU8(0x69);
      out.addU16(60); out.addU16(60); out.addU8(6); // position
      out.addU16(0xff00); // empty marker
    });

    expect(world.tileRevisionByZ.get(6)).toBe(1);
    expect(world.tileRevisionByZ.get(7)).toBeUndefined();
  });

  it('a floor change bumps every floor (whole stack shifts relevance)', () => {
    const { world, dispatcher } = makeWorld();
    // 7 → 6: an above-ground up move carries no floor stream — every
    // floor is already known — so a bare opcode is the honest frame.
    world.playerZ = 7;

    dispatch(dispatcher, (out) => out.addU8(0xbe));

    expect(world.playerZ).toBe(6);
    for (let z = 0; z <= 15; z++) {
      expect(world.tileRevisionByZ.get(z)).toBe(1);
    }
  });

  it('creature-only changes leave per-floor revisions untouched', () => {
    const { world, dispatcher } = makeWorld();
    const rat = mkTile(60, 60, 7, []);
    seed(world, rat);

    dispatch(dispatcher, (out) => {
      out.addU8(0x6a);
      out.addU16(60); out.addU16(60); out.addU8(7); // position
      out.addU16(0x0062); // KNOWN creature short form
      out.addU32(42);
      out.addU8(100);     // health
      out.addU8(2);       // direction
      out.addU8(128);     // lookType
      out.addU8(10); out.addU8(20); out.addU8(30); out.addU8(40);
      out.addU8(0); out.addU8(0); // light
      out.addU16(220);    // speed
      out.addU8(0); out.addU8(0); // skull + shield
    });

    // A creature ADD still lands on the tile stack, so the tile floor
    // bumps once — but a pure creature-state change afterwards must not.
    expect(world.tileRevisionByZ.get(7)).toBe(1);

    dispatch(dispatcher, (out) => {
      out.addU8(0x8c); // CreatureHealth
      out.addU32(42);
      out.addU8(50);
    });

    expect(world.tileRevisionByZ.get(7)).toBe(1);
  });
});
