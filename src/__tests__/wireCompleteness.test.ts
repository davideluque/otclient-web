import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { registerWireSkips } from '../lib/net/7.6/wireSkips';
import { setItemWireFlags, resetItemWireFlags, itemHasCountByte } from '../lib/net/common/itemFlags';
import { parseItem } from '../lib/net/7.6/mapParser';
import { GameWorld } from '../lib/GameWorld';
import type { DatFile } from '../lib/dat';
import { DatAttr, ThingCategory } from '../lib/dat';

const STACKABLE_ID = 3031; // "gold coin" stand-in
const PLAIN_ID = 100;

function makeDat(): DatFile {
  const frameGroup = {
    width: 1, height: 1, exactSize: 32, layers: 1,
    numPatternX: 1, numPatternY: 1, numPatternZ: 1,
    animationPhases: 1, spriteIds: [1],
  };
  return {
    signature: 0,
    itemCount: STACKABLE_ID,
    creatureCount: 0,
    effectCount: 0,
    missileCount: 0,
    items: [
      { id: PLAIN_ID, category: ThingCategory.Item, attrs: new Map(), frameGroup },
      { id: STACKABLE_ID, category: ThingCategory.Item, attrs: new Map([[DatAttr.Stackable, true]]), frameGroup },
    ],
    creatures: [],
    effects: [],
    missiles: [],
  } as unknown as DatFile;
}

beforeEach(() => setItemWireFlags(makeDat()));
afterEach(() => resetItemWireFlags());

describe('itemFlags / parseItem', () => {
  it('flags stackable ids and reads their count byte', () => {
    expect(itemHasCountByte(STACKABLE_ID)).toBe(true);
    expect(itemHasCountByte(PLAIN_ID)).toBe(false);

    const out = new OutputPacket();
    out.addU16(STACKABLE_ID);
    out.addU8(42);
    out.addU16(PLAIN_ID);
    const p = new InputPacket(out.toArrayBuffer());

    expect(parseItem(p)).toEqual({ id: STACKABLE_ID, count: 42 });
    expect(parseItem(p)).toEqual({ id: PLAIN_ID });
    expect(p.bytesLeft).toBe(0);
  });
});

describe('registerWireSkips frame integrity', () => {
  // Every payload below mirrors what protocol76.cpp writes for that
  // opcode. The test appends a sentinel opcode after the payload and
  // asserts it still dispatches — i.e. the skip consumed exactly the
  // payload, no more, no less.
  const protocol = new GameProtocol();
  const op = protocol.serverOpcodes;
  const SENTINEL = 0x05; // unused opcode, registered manually below

  function pos(out: OutputPacket): void {
    out.addU16(100); out.addU16(200); out.addU8(7);
  }

  const cases: Array<{ name: string; opcode: number; write: (out: OutputPacket) => void }> = [
    { name: 'GMActions', opcode: op.GMActions, write: (o) => { for (let i = 0; i < 32; i++) o.addU8(0xff); } },
    { name: 'LoginQueue', opcode: op.LoginQueue, write: (o) => { o.addString('Queue position 3'); o.addU8(10); } },
    { name: 'ReloginWindow', opcode: op.ReloginWindow, write: () => {} },
    { name: 'ContainerOpen', opcode: op.ContainerOpen, write: (o) => {
      o.addU8(1); o.addU16(PLAIN_ID); o.addString('Backpack'); o.addU8(20); o.addU8(0);
      o.addU8(2); o.addU16(PLAIN_ID); o.addU16(STACKABLE_ID); o.addU8(5);
    } },
    { name: 'ContainerClose', opcode: op.ContainerClose, write: (o) => o.addU8(1) },
    { name: 'ContainerAddItem', opcode: op.ContainerAddItem, write: (o) => { o.addU8(1); o.addU16(STACKABLE_ID); o.addU8(3); } },
    { name: 'ContainerUpdateItem', opcode: op.ContainerUpdateItem, write: (o) => { o.addU8(1); o.addU8(0); o.addU16(PLAIN_ID); } },
    { name: 'ContainerRemoveItem', opcode: op.ContainerRemoveItem, write: (o) => { o.addU8(1); o.addU8(0); } },
    { name: 'InventorySet', opcode: op.InventorySet, write: (o) => { o.addU8(1); o.addU16(STACKABLE_ID); o.addU8(100); } },
    { name: 'InventoryClear', opcode: op.InventoryClear, write: (o) => o.addU8(1) },
    { name: 'TradeRequest', opcode: op.TradeRequest, write: (o) => { o.addString('Trinity'); o.addU8(1); o.addU16(PLAIN_ID); } },
    { name: 'TradeClose', opcode: op.TradeClose, write: () => {} },
    { name: 'WorldLight', opcode: op.WorldLight, write: (o) => { o.addU8(250); o.addU8(0xd7); } },
    { name: 'MagicEffect', opcode: op.MagicEffect, write: (o) => { pos(o); o.addU8(12); } },
    { name: 'AnimatedText', opcode: op.AnimatedText, write: (o) => { pos(o); o.addU8(5); o.addString('123'); } },
    { name: 'DistanceShot', opcode: op.DistanceShot, write: (o) => { pos(o); pos(o); o.addU8(3); } },
    { name: 'CreatureSquare', opcode: op.CreatureSquare, write: (o) => { o.addU32(9); o.addU8(0); } },
    { name: 'CreatureLight', opcode: op.CreatureLight, write: (o) => { o.addU32(9); o.addU8(7); o.addU8(0xd7); } },
    { name: 'CreatureSkull', opcode: op.CreatureSkull, write: (o) => { o.addU32(9); o.addU8(1); } },
    { name: 'CreatureShield', opcode: op.CreatureShield, write: (o) => { o.addU32(9); o.addU8(1); } },
    { name: 'PlayerStats', opcode: op.PlayerStats, write: (o) => {
      o.addU16(150); o.addU16(185); o.addU16(400); o.addU32(4200); o.addU16(8);
      o.addU8(50); o.addU16(35); o.addU16(90); o.addU8(2); o.addU8(20); o.addU8(100);
    } },
    { name: 'PlayerSkills', opcode: op.PlayerSkills, write: (o) => { for (let i = 0; i < 14; i++) o.addU8(10); } },
    { name: 'Icons', opcode: op.Icons, write: (o) => o.addU8(0) },
    { name: 'CancelTarget', opcode: op.CancelTarget, write: () => {} },
    { name: 'TextMessage', opcode: op.TextMessage, write: (o) => { o.addU8(0x11); o.addString('Welcome to Jamera!'); } },
    { name: 'CancelWalk', opcode: op.CancelWalk, write: (o) => o.addU8(2) },
    { name: 'CreatureSpeak (say)', opcode: op.CreatureSpeak, write: (o) => {
      o.addString('Trinity'); o.addU8(1); pos(o); o.addString('hello');
    } },
    { name: 'CreatureSpeak (channel)', opcode: op.CreatureSpeak, write: (o) => {
      o.addString('Trinity'); o.addU8(5); o.addU16(4); o.addString('hi chan');
    } },
    { name: 'ChannelsDialog', opcode: op.ChannelsDialog, write: (o) => {
      o.addU8(2); o.addU16(4); o.addString('Game Chat'); o.addU16(5); o.addString('Trade');
    } },
    { name: 'ChannelOpen', opcode: op.ChannelOpen, write: (o) => { o.addU16(4); o.addString('Game Chat'); } },
    { name: 'PrivateChannelOpen', opcode: op.PrivateChannelOpen, write: (o) => o.addString('Trinity') },
    { name: 'ChannelClose', opcode: op.ChannelClose, write: (o) => o.addU16(4) },
  ];

  it.each(cases)('consumes $name exactly', ({ opcode, write }) => {
    const dispatcher = new PacketDispatcher();
    registerWireSkips(dispatcher, protocol);
    let sentinelReached = false;
    dispatcher.on(SENTINEL, () => { sentinelReached = true; });

    const out = new OutputPacket();
    out.addU8(opcode);
    write(out);
    out.addU8(SENTINEL);

    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));
    expect(sentinelReached).toBe(true);
  });
});

describe('GameWorld tile operations', () => {
  function world(): GameWorld {
    return new GameWorld(new GameProtocol());
  }

  function dispatcherFor(w: GameWorld): PacketDispatcher {
    const d = new PacketDispatcher();
    w.registerHandlers(d);
    return d;
  }

  function seedTile(w: GameWorld, x: number, y: number, z: number, itemIds: number[]): void {
    // @ts-expect-error driving private state for the test
    w.tiles.set(`${x}:${y}:${z}`, {
      x, y, z, items: itemIds.map((id) => ({ id })), creatures: [],
    });
  }

  it('0x6A adds an item to an existing tile', () => {
    const w = world();
    const d = dispatcherFor(w);
    seedTile(w, 100, 200, 7, [PLAIN_ID]);

    const out = new OutputPacket();
    out.addU8(0x6a);
    out.addU16(100); out.addU16(200); out.addU8(7);
    out.addU16(STACKABLE_ID); out.addU8(12);
    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(w.getTile(100, 200, 7)?.items).toEqual([
      { id: PLAIN_ID }, { id: STACKABLE_ID, count: 12 },
    ]);
  });

  it('0x6A adds a creature to the registry and tile', () => {
    const w = world();
    const d = dispatcherFor(w);
    seedTile(w, 100, 200, 7, [PLAIN_ID]);

    const out = new OutputPacket();
    out.addU8(0x6a);
    out.addU16(100); out.addU16(200); out.addU8(7);
    out.addU16(0x61); // unknown creature (7.6 long form)
    out.addU32(0);    // removeKnown
    out.addU32(777);  // creature id
    out.addString('Rat');
    out.addU8(80);    // health %
    out.addU8(2);     // direction
    out.addU8(21);    // lookType (U8 in 7.6)
    out.addU8(0); out.addU8(0); out.addU8(0); out.addU8(0); // colors
    out.addU8(0); out.addU8(0); // light
    out.addU16(180);  // speed
    out.addU8(0); out.addU8(0); // skull, shield
    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(w.getCreature(777)?.name).toBe('Rat');
    expect(w.getCreature(777)?.x).toBe(100);
    expect(w.getTile(100, 200, 7)?.creatures).toHaveLength(1);
  });

  it('0x6B with the 0x63 marker turns a creature', () => {
    const w = world();
    const d = dispatcherFor(w);
    // @ts-expect-error driving private state for the test
    w.creatures.set(777, { id: 777, name: 'Rat', x: 100, y: 200, z: 7, direction: 0, health: 80, speed: 180, outfit: { lookType: 21, head: 0, body: 0, legs: 0, feet: 0 } });

    const out = new OutputPacket();
    out.addU8(0x6b);
    out.addU16(100); out.addU16(200); out.addU8(7);
    out.addU8(1);     // stackpos
    out.addU16(0x63); // creature-turn marker
    out.addU32(777);
    out.addU8(3);     // west
    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(w.getCreature(777)?.direction).toBe(3);
  });

  it('0x6B transforms an item in place', () => {
    const w = world();
    const d = dispatcherFor(w);
    seedTile(w, 100, 200, 7, [PLAIN_ID, PLAIN_ID + 1]);

    const out = new OutputPacket();
    out.addU8(0x6b);
    out.addU16(100); out.addU16(200); out.addU8(7);
    out.addU8(1); // stackpos
    out.addU16(STACKABLE_ID); out.addU8(7);
    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(w.getTile(100, 200, 7)?.items[1]).toEqual({ id: STACKABLE_ID, count: 7 });
  });

  it('0x6C removes the item at the stack position', () => {
    const w = world();
    const d = dispatcherFor(w);
    seedTile(w, 100, 200, 7, [PLAIN_ID, PLAIN_ID + 1]);

    const out = new OutputPacket();
    out.addU8(0x6c);
    out.addU16(100); out.addU16(200); out.addU8(7);
    out.addU8(0);
    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(w.getTile(100, 200, 7)?.items).toEqual([{ id: PLAIN_ID + 1 }]);
  });

  it('0x69 replaces a tile, and clears it on the empty marker', () => {
    const w = world();
    const d = dispatcherFor(w);
    seedTile(w, 100, 200, 7, [PLAIN_ID]);

    const replace = new OutputPacket();
    replace.addU8(0x69);
    replace.addU16(100); replace.addU16(200); replace.addU8(7);
    replace.addU16(PLAIN_ID + 5);
    replace.addU8(0x00); replace.addU8(0xff); // closing skip marker
    d.dispatch(new InputPacket(replace.toArrayBuffer()));
    expect(w.getTile(100, 200, 7)?.items).toEqual([{ id: PLAIN_ID + 5 }]);

    const clear = new OutputPacket();
    clear.addU8(0x69);
    clear.addU16(100); clear.addU16(200); clear.addU8(7);
    clear.addU8(0x01); clear.addU8(0xff); // empty marker
    d.dispatch(new InputPacket(clear.toArrayBuffer()));
    expect(w.getTile(100, 200, 7)).toBeUndefined();
  });

  it('bumps creatureRevision (not tileRevision) for creature-only updates, and vice versa', () => {
    const w = world();
    const d = dispatcherFor(w);
    // @ts-expect-error driving private state for the test
    w.creatures.set(9, { id: 9, name: 'Rat', x: 1, y: 1, z: 7, direction: 0, health: 80, speed: 180, outfit: { lookType: 21, head: 0, body: 0, legs: 0, feet: 0 } });
    seedTile(w, 100, 200, 7, [PLAIN_ID]);

    const t0 = w.tileRevision;
    const c0 = w.creatureRevision;

    // Creature-only: health update.
    const health = new OutputPacket();
    health.addU8(0x8c); health.addU32(9); health.addU8(50);
    d.dispatch(new InputPacket(health.toArrayBuffer()));
    expect(w.creatureRevision).toBeGreaterThan(c0);
    expect(w.tileRevision).toBe(t0);

    // Tile-only: an item appears.
    const c1 = w.creatureRevision;
    const add = new OutputPacket();
    add.addU8(0x6a);
    add.addU16(100); add.addU16(200); add.addU8(7);
    add.addU16(PLAIN_ID);
    d.dispatch(new InputPacket(add.toArrayBuffer()));
    expect(w.tileRevision).toBeGreaterThan(t0);
    expect(w.creatureRevision).toBe(c1);
  });

  it('0x8C updates creature health through the registry', () => {
    const w = world();
    const d = dispatcherFor(w);
    // @ts-expect-error driving private state for the test
    w.creatures.set(9, { id: 9, name: 'Rat', x: 1, y: 1, z: 7, direction: 0, health: 80, speed: 180, outfit: { lookType: 21, head: 0, body: 0, legs: 0, feet: 0 } });

    const out = new OutputPacket();
    out.addU8(0x8c);
    out.addU32(9);
    out.addU8(35);
    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(w.getCreature(9)?.health).toBe(35);
  });
});
