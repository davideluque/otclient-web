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
      // Container header is AddItemId (U16) only, even if that client id
      // would carry a count byte when it appears as a regular item.
      o.addU8(1); o.addU16(STACKABLE_ID); o.addString('Backpack'); o.addU8(20); o.addU8(0);
      o.addU8(2); o.addU16(PLAIN_ID); o.addU16(STACKABLE_ID); o.addU8(5);
    } },
    { name: 'ContainerClose', opcode: op.ContainerClose, write: (o) => o.addU8(1) },
    { name: 'ContainerAddItem', opcode: op.ContainerAddItem, write: (o) => { o.addU8(1); o.addU16(STACKABLE_ID); o.addU8(3); } },
    { name: 'ContainerUpdateItem', opcode: op.ContainerUpdateItem, write: (o) => { o.addU8(1); o.addU8(0); o.addU16(PLAIN_ID); } },
    { name: 'ContainerRemoveItem', opcode: op.ContainerRemoveItem, write: (o) => { o.addU8(1); o.addU8(0); } },
    { name: 'InventorySet', opcode: op.InventorySet, write: (o) => { o.addU8(1); o.addU16(STACKABLE_ID); o.addU8(100); } },
    { name: 'InventoryClear', opcode: op.InventoryClear, write: (o) => o.addU8(1) },
    { name: 'ShopOpen', opcode: op.ShopOpen, write: (o) => {
      o.addString('Bashira'); o.addU16(2);
      o.addU16(2120); o.addU16(3003); o.addU8(0); o.addString('rope'); o.addU32(50); o.addU32(8);
      o.addU16(2006); o.addU16(2874); o.addU8(11); o.addString('vial of oil'); o.addU32(100); o.addU32(0);
    } },
    { name: 'ShopGoods', opcode: op.ShopGoods, write: (o) => {
      o.addU32(1234); o.addU8(2); o.addU16(2120); o.addU16(3); o.addU16(2554); o.addU16(1);
    } },
    { name: 'ShopClose', opcode: op.ShopClose, write: () => {} },
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

  it('a real ReloginWindow handler overrides the skip and the frame still parses fully', () => {
    // The death-flow binding registers its own 0x28 handler after
    // registerWireSkips (last-write-wins). Opcode-only payload: the
    // trailing opcode in the same frame must still dispatch.
    const dispatcher = new PacketDispatcher();
    registerWireSkips(dispatcher, protocol);
    let deathSignaled = false;
    dispatcher.on(op.ReloginWindow, () => { deathSignaled = true; });
    let sentinelReached = false;
    dispatcher.on(SENTINEL, () => { sentinelReached = true; });

    const out = new OutputPacket();
    out.addU8(op.ReloginWindow);
    out.addU8(SENTINEL);

    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));
    expect(deathSignaled).toBe(true);
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
    const items = itemIds.map((id) => ({ id }));
    // @ts-expect-error driving private state for the test
    w.tiles.set(`${x}:${y}:${z}`, {
      x, y, z,
      things: items.map((item) => ({ kind: 'item' as const, item })),
      items,
      creatures: [],
    });
  }

  it('0x6A adds an item to an existing tile (down item, after the ground)', () => {
    const w = world();
    const d = dispatcherFor(w);
    seedTile(w, 100, 200, 7, [PLAIN_ID]);
    // Classify the seeded item as ground so the add (a regular down
    // item) inserts AFTER it — the server's downItems.insert(begin).
    w.setDatIndex(new Map([
      [PLAIN_ID, { id: PLAIN_ID, attrs: new Map([[DatAttr.Ground, true]]) } as never],
    ]));

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

  it('death sequence: splash add, creature remove, corpse add — creature actually disappears', () => {
    const w = world();
    const d = dispatcherFor(w);
    seedTile(w, 100, 200, 7, [PLAIN_ID]);
    w.setDatIndex(new Map([
      [PLAIN_ID, { id: PLAIN_ID, attrs: new Map([[DatAttr.Ground, true]]) } as never],
    ]));

    // The rat walks in: wire stack is [ground(0), rat(1)].
    const add = new OutputPacket();
    add.addU8(0x6a);
    add.addU16(100); add.addU16(200); add.addU8(7);
    add.addU16(0x61);
    add.addU32(0);
    add.addU32(777);
    add.addString('Rat');
    add.addU8(80);
    add.addU8(2);
    add.addU8(21);
    add.addU8(0); add.addU8(0); add.addU8(0); add.addU8(0);
    add.addU8(0); add.addU8(0);
    add.addU16(180);
    add.addU8(0); add.addU8(0);
    d.dispatch(new InputPacket(add.toArrayBuffer()));

    // It dies. otserv: blood splash (down item — lands AFTER the
    // creature in wire order), then the creature is removed at ITS
    // stack position, then the corpse appears.
    const splash = new OutputPacket();
    splash.addU8(0x6a);
    splash.addU16(100); splash.addU16(200); splash.addU8(7);
    splash.addU16(STACKABLE_ID); splash.addU8(5); // fluid-marked id, blood
    d.dispatch(new InputPacket(splash.toArrayBuffer()));

    // Wire stack now [ground(0), rat(1), splash(2)] — the old split
    // model resolved stackpos 1 to the splash and the rat lingered.
    const remove = new OutputPacket();
    remove.addU8(0x6c);
    remove.addU16(100); remove.addU16(200); remove.addU8(7);
    remove.addU8(1);
    d.dispatch(new InputPacket(remove.toArrayBuffer()));

    const corpse = new OutputPacket();
    corpse.addU8(0x6a);
    corpse.addU16(100); corpse.addU16(200); corpse.addU8(7);
    corpse.addU16(PLAIN_ID + 50);
    d.dispatch(new InputPacket(corpse.toArrayBuffer()));

    expect(w.getCreature(777)).toBeUndefined();
    const tile = w.getTile(100, 200, 7);
    expect(tile?.creatures).toHaveLength(0);
    expect(tile?.items.map((i) => i.id)).toEqual([PLAIN_ID, PLAIN_ID + 50, STACKABLE_ID]);
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

describe('GameWorld floor changes', () => {
  function world(): GameWorld {
    return new GameWorld(new GameProtocol());
  }

  function dispatcherFor(w: GameWorld): PacketDispatcher {
    const d = new PacketDispatcher();
    w.registerHandlers(d);
    return d;
  }

  function setPos(w: GameWorld, x: number, y: number, z: number): void {
    w.playerX = x; w.playerY = y; w.playerZ = z;
  }

  function seedSelf(w: GameWorld): void {
    w.playerCreatureId = 7;
    // @ts-expect-error driving private registry for the test
    w.creatures.set(7, {
      id: 7,
      name: 'me',
      x: w.playerX,
      y: w.playerY,
      z: w.playerZ,
      direction: 2,
      health: 100,
      speed: 220,
      outfit: { lookType: 128, head: 0, body: 0, legs: 0, feet: 0 },
      lightLevel: 0,
      lightColor: 0,
    });
  }

  /** Emit skip markers covering exactly `cells` empty tile slots. */
  function emptyCells(out: OutputPacket, cells: number): void {
    while (cells > 0) {
      const chunk = Math.min(cells, 256); // marker covers 1 + count cells
      out.addU8(chunk - 1);
      out.addU8(0xff);
      cells -= chunk;
    }
  }

  it('0xBE surfacing: parses 6 floor blocks, lands on the same x/y one floor up', () => {
    const w = world();
    const d = dispatcherFor(w);
    setPos(w, 100, 200, 8);

    const out = new OutputPacket();
    out.addU8(0xbe);
    // Floor z=5 (offset 3): first cell is a real tile, marker covers 255 more.
    out.addU16(PLAIN_ID);
    out.addU8(255); out.addU8(0xff);
    // Remaining cells of the 6-floor stream: 18*14*6 - 1 - 255.
    emptyCells(out, 18 * 14 * 6 - 1 - 255);
    // Embedded resync slices are multi-floor like every map slice:
    // 8 visible layers above ground → west column 14×8, north row 18×8.
    out.addU8(0x68);
    emptyCells(out, 14 * 8);
    out.addU8(0x65);
    emptyCells(out, 18 * 8);

    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect([w.playerX, w.playerY, w.playerZ]).toEqual([100, 200, 7]);
    // The tile landed at (startX + offset, startY + offset, 5).
    expect(w.getTile(92 + 3, 194 + 3, 5)?.items).toEqual([{ id: PLAIN_ID }]);
  });

  it('0xBF going underground: parses 3 floor blocks, lands on the same x/y one floor down', () => {
    const w = world();
    const d = dispatcherFor(w);
    setPos(w, 100, 200, 7);

    const out = new OutputPacket();
    out.addU8(0xbf);
    emptyCells(out, 18 * 14 * 3);
    // Underground (z=8): 5 visible layers → east column 14×5, south row 18×5.
    out.addU8(0x66);
    emptyCells(out, 14 * 5);
    out.addU8(0x67);
    emptyCells(out, 18 * 5);

    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect([w.playerX, w.playerY, w.playerZ]).toEqual([100, 200, 8]);
  });

  it('0xBE above ground carries no floor blocks, only the resync slices', () => {
    const w = world();
    const d = dispatcherFor(w);
    setPos(w, 100, 200, 6);

    const out = new OutputPacket();
    out.addU8(0xbe);
    out.addU8(0x68);
    emptyCells(out, 14 * 8);
    out.addU8(0x65);
    emptyCells(out, 18 * 8);

    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect([w.playerX, w.playerY, w.playerZ]).toEqual([100, 200, 5]);
  });

  it('counts the floor-change frame as one self-step, not two row-resync steps', () => {
    const w = world();
    const d = dispatcherFor(w);
    setPos(w, 100, 200, 8);
    seedSelf(w);

    const out = new OutputPacket();
    out.addU8(0xbe);
    emptyCells(out, 18 * 14 * 6);
    // Surfacing embeds west+north viewport resync slices. These move the
    // camera anchor back to the final x/y, but are not extra player steps.
    out.addU8(0x68);
    emptyCells(out, 14 * 8);
    out.addU8(0x65);
    emptyCells(out, 18 * 8);

    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect([w.playerX, w.playerY, w.playerZ]).toEqual([100, 200, 7]);
    expect(w.selfSteps).toBe(1);
  });

  it('publishes only the final landing after covered-offset and directional slices', async () => {
    const w = world();
    const d = dispatcherFor(w);
    setPos(w, 100, 200, 6);
    seedSelf(w);
    const published: Array<[number, number, number]> = [];
    w.onChange = () => published.push([w.playerX, w.playerY, w.playerZ]);

    const out = new OutputPacket();
    out.addU8(0xbe);
    out.addU8(0x68);
    emptyCells(out, 14 * 8);
    out.addU8(0x65);
    emptyCells(out, 18 * 8);
    out.addU8(0x66);
    emptyCells(out, 14 * 8);

    d.dispatch(new InputPacket(out.toArrayBuffer()));
    expect(published).toEqual([]);
    await Promise.resolve();
    expect(published).toEqual([[101, 200, 5]]);
    expect(w.getCreature(7)).toMatchObject({ x: 101, y: 200, z: 5 });
    expect(w.selfSteps).toBe(1);
  });
});

describe('GameWorld lighting packets', () => {
  function world(): GameWorld {
    return new GameWorld(new GameProtocol());
  }

  function dispatcherFor(w: GameWorld): PacketDispatcher {
    const d = new PacketDispatcher();
    w.registerHandlers(d);
    return d;
  }

  it('0x82 updates the world light', () => {
    const w = world();
    const d = dispatcherFor(w);
    expect(w.worldLight).toEqual({ level: 250, color: 0xd7 }); // daylight default

    const out = new OutputPacket();
    out.addU8(0x82);
    out.addU8(40);   // night level
    out.addU8(0xd7); // white
    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(w.worldLight).toEqual({ level: 40, color: 0xd7 });
  });

  it('0x8D updates a known creature light', () => {
    const w = world();
    const d = dispatcherFor(w);
    // @ts-expect-error driving private registry for the test
    w.creatures.set(777, {
      id: 777, name: 'Rat', x: 100, y: 200, z: 7, direction: 0, health: 80,
      speed: 180, outfit: { lookType: 21, head: 0, body: 0, legs: 0, feet: 0 },
      lightLevel: 0, lightColor: 0,
    });

    const out = new OutputPacket();
    out.addU8(0x8d);
    out.addU32(777);
    out.addU8(7);    // torch level
    out.addU8(0xd1); // orange-ish
    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(w.getCreature(777)?.lightLevel).toBe(7);
    expect(w.getCreature(777)?.lightColor).toBe(0xd1);
  });
});

describe('GameWorld CancelWalk (0xB5)', () => {
  const protocol = new GameProtocol();

  function seededWorld(): GameWorld {
    const w = new GameWorld(protocol);
    w.playerCreatureId = 7;
    w.playerX = 100; w.playerY = 200; w.playerZ = 7;
    // @ts-expect-error driving private registry for the test
    w.creatures.set(7, {
      id: 7, name: 'me', x: 100, y: 200, z: 7, direction: 2, health: 100,
      speed: 220, outfit: { lookType: 128, head: 0, body: 0, legs: 0, feet: 0 },
      lightLevel: 0, lightColor: 0,
    });
    return w;
  }

  it('overrides the wire skip: snaps the player facing and notifies onCancelWalk', () => {
    const w = seededWorld();
    const d = new PacketDispatcher();
    registerWireSkips(d, protocol); // production order — skips first
    w.registerHandlers(d);
    const cancels: number[] = [];
    w.onCancelWalk = (dir) => cancels.push(dir);
    const c0 = w.creatureRevision;

    const out = new OutputPacket();
    out.addU8(0xb5);
    out.addU8(3); // west
    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(w.getCreature(7)?.direction).toBe(3);
    expect(cancels).toEqual([3]);
    expect(w.creatureRevision).toBeGreaterThan(c0);
  });

  it('consumes exactly one byte — packets batched behind it still parse', () => {
    const w = seededWorld();
    const d = new PacketDispatcher();
    w.registerHandlers(d);
    // @ts-expect-error driving private registry for the test
    w.creatures.set(9, {
      id: 9, name: 'Rat', x: 1, y: 1, z: 7, direction: 0, health: 80,
      speed: 180, outfit: { lookType: 21, head: 0, body: 0, legs: 0, feet: 0 },
    });

    const out = new OutputPacket();
    out.addU8(0xb5); out.addU8(1); // face east
    out.addU8(0x8c); out.addU32(9); out.addU8(35); // health update in the same frame
    d.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(w.getCreature(7)?.direction).toBe(1);
    expect(w.getCreature(9)?.health).toBe(35);
  });
});
