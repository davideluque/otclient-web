import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { GameWorld } from '../lib/GameWorld';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { resetItemWireFlags, setItemWireFlags } from '../lib/net/common/itemFlags';
import type { DatFile } from '../lib/dat';

// Plain items only — an empty dat is the honest setup.
beforeAll(() => setItemWireFlags({
  signature: 0, itemCount: 0, creatureCount: 0, effectCount: 0, missileCount: 0,
  items: [], creatures: [], effects: [], missiles: [],
} as unknown as DatFile));
afterAll(() => resetItemWireFlags());

/**
 * KNOWN-form creatures (0x62) carry no name on the wire — the server
 * relies on the client remembering it from the original UNKNOWN add.
 * Floor changes re-describe the player as KNOWN (going down doesn't
 * even send a 0x6D), so dropping the remembered name on re-add is the
 * "my name disappears when I go down a floor" bug.
 */

function addKnownCreature(out: OutputPacket, id: number): void {
  out.addU16(0x0062); // KNOWN short form
  out.addU32(id);
  out.addU8(100);     // health
  out.addU8(2);       // direction
  out.addU8(128);     // lookType
  out.addU8(10); out.addU8(20); out.addU8(30); out.addU8(40);
  out.addU8(0); out.addU8(0); // light
  out.addU16(220);    // speed
  out.addU8(0); out.addU8(0); // skull + shield
}

function seedNamed(world: GameWorld, id: number, name: string): void {
  // @ts-expect-error private registry
  world.creatures.set(id, {
    id, name, x: 50, y: 50, z: 7,
    direction: 0, health: 100, speed: 220,
    outfit: { lookType: 128, head: 1, body: 2, legs: 3, feet: 4 },
  });
}

describe('KNOWN creature re-adds keep the remembered name', () => {
  it('via 0x6A TileAddThing', () => {
    const world = new GameWorld(new GameProtocol());
    const dispatcher = new PacketDispatcher();
    world.registerHandlers(dispatcher);
    seedNamed(world, 77, 'Flash Ivan');

    const out = new OutputPacket();
    out.addU8(0x6a);
    out.addU16(60); out.addU16(60); out.addU8(7); // position
    addKnownCreature(out, 77);
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(world.getCreature(77)?.name).toBe('Flash Ivan');
    expect(world.getCreature(77)?.x).toBe(60);
  });

  it('via 0x69 TileUpdate (the floor-change re-describe path)', () => {
    const world = new GameWorld(new GameProtocol());
    const dispatcher = new PacketDispatcher();
    world.registerHandlers(dispatcher);
    seedNamed(world, 77, 'Flash Ivan');

    const out = new OutputPacket();
    out.addU8(0x69);
    out.addU16(61); out.addU16(61); out.addU8(8); // position
    out.addU16(100); // ground item
    addKnownCreature(out, 77);
    out.addU8(0); out.addU8(0xff); // slot terminator
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(world.getCreature(77)?.name).toBe('Flash Ivan');
    expect(world.getCreature(77)?.z).toBe(8);
  });
});
