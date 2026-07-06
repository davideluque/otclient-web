// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bindContainers } from '../lib/jamera/containerBinding';
import { bindInventory } from '../lib/jamera/inventoryBinding';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { setItemWireFlags, resetItemWireFlags } from '../lib/net/common/itemFlags';
import { ThingCategory, DatAttr } from '../lib/dat';
import type { DatFile } from '../lib/dat';
import type { GameClient } from '../lib/net/common/GameClient';

const STACKABLE_ID = 3031; // 0x0bd7
const BAG_ID = 2853; // 0x0b25

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
      { id: BAG_ID, category: ThingCategory.Item, attrs: new Map(), frameGroup },
      { id: STACKABLE_ID, category: ThingCategory.Item, attrs: new Map([[DatAttr.Stackable, true]]), frameGroup },
    ],
    creatures: [],
    effects: [],
    missiles: [],
  } as unknown as DatFile;
}

beforeEach(() => setItemWireFlags(makeDat()));
afterEach(() => {
  resetItemWireFlags();
  document.body.replaceChildren();
});

function makeClient() {
  const protocol = new GameProtocol();
  const dispatcher = new PacketDispatcher();
  const sent: number[][] = [];
  const client = {
    getProtocol: () => protocol,
    getDispatcher: () => dispatcher,
    send: (p: OutputPacket) => sent.push(Array.from(p.toUint8Array())),
  } as unknown as GameClient;
  return { client, dispatcher, sent };
}

function openFrame(cid: number, items: Array<{ id: number; count?: number }>): InputPacket {
  const out = new OutputPacket();
  out.addU8(0x6e);
  out.addU8(cid);
  out.addU16(BAG_ID);
  out.addString('Dead Rat');
  out.addU8(6);
  out.addU8(0);
  out.addU8(items.length);
  for (const item of items) {
    out.addU16(item.id);
    if (item.count !== undefined) out.addU8(item.count);
  }
  return new InputPacket(out.toArrayBuffer());
}

function containerCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.container-pane .cell.filled')];
}

function sheetButton(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('.action-sheet button')]
    .find((b) => b.textContent === label);
}

describe('container item tap → action sheet', () => {
  it('Loot sends the exact 0x78 (container slot → backpack equipment slot), count 1 for a plain item', () => {
    const { client, dispatcher, sent } = makeClient();
    bindContainers(client, document.body, { playerPosition: () => ({ x: 100, y: 200, z: 7 }) });
    dispatcher.dispatch(openFrame(3, [{ id: BAG_ID }]));

    containerCells()[0].click();
    sheetButton('Loot')!.click();

    expect(sent).toEqual([[
      0x78, // ThrowItem
      0xff, 0xff, 0x43, 0x00, 0x00, // from: container 3, slot 0
      0x25, 0x0b, // spriteId 2853
      0x00, // fromStackpos = slot
      0xff, 0xff, 0x03, 0x00, 0x00, // to: backpack equipment slot
      0x01, // plain item → count 1
    ]]);
    expect(document.querySelector('.action-sheet-backdrop')).toBeNull();
  });

  it('Loot moves a stackable with its full count; Drop targets the player tile', () => {
    const { client, dispatcher, sent } = makeClient();
    bindContainers(client, document.body, { playerPosition: () => ({ x: 100, y: 200, z: 7 }) });
    dispatcher.dispatch(openFrame(0, [{ id: STACKABLE_ID, count: 12 }, { id: BAG_ID }]));

    containerCells()[0].click();
    sheetButton('Loot')!.click();
    expect(sent[0]).toEqual([
      0x78,
      0xff, 0xff, 0x40, 0x00, 0x00,
      0xd7, 0x0b,
      0x00,
      0xff, 0xff, 0x03, 0x00, 0x00,
      12, // full stack, no split UI in v1
    ]);

    containerCells()[1].click();
    sheetButton('Drop')!.click();
    expect(sent[1]).toEqual([
      0x78,
      0xff, 0xff, 0x40, 0x00, 0x01, // from: container 0, slot 1
      0x25, 0x0b,
      0x01,
      0x64, 0x00, 0xc8, 0x00, 0x07, // to: the tile under the player
      0x01,
    ]);
  });

  it('Look sends the existing 0x8C; Drop is omitted without a player-position provider', () => {
    const { client, dispatcher, sent } = makeClient();
    bindContainers(client, document.body);
    dispatcher.dispatch(openFrame(1, [{ id: BAG_ID }]));

    containerCells()[0].click();
    expect(sheetButton('Drop')).toBeUndefined();
    sheetButton('Look')!.click();
    expect(sent).toEqual([[
      0x8c,
      0xff, 0xff, 0x41, 0x00, 0x00,
      0x25, 0x0b,
      0x00,
    ]]);
  });
});

describe('equipment tap → unequip sheet', () => {
  function equip(dispatcher: PacketDispatcher, wireSlot: number, id: number, count?: number): void {
    const set = new OutputPacket();
    set.addU8(0x78);
    set.addU8(wireSlot);
    set.addU16(id);
    if (count !== undefined) set.addU8(count);
    dispatcher.dispatch(new InputPacket(set.toArrayBuffer()));
  }

  function slotCell(label: string): HTMLElement {
    return [...document.querySelectorAll<HTMLElement>('.inventory-pane .slot.filled')]
      .find((c) => c.textContent?.includes(label))!;
  }

  it('sends 0x78 from the equipment slot to the backpack slot, stackables with their count', () => {
    const { client, dispatcher, sent } = makeClient();
    bindInventory(client);
    equip(dispatcher, 1, BAG_ID); // pretend hat
    equip(dispatcher, 10, STACKABLE_ID, 38);

    slotCell('#2853').click();
    sheetButton('Unequip → backpack')!.click();
    expect(sent[0]).toEqual([
      0x78,
      0xff, 0xff, 0x01, 0x00, 0x00, // from: head slot — stackpos = the slot (internalGetPosition)
      0x25, 0x0b,
      0x01,
      0xff, 0xff, 0x03, 0x00, 0x00,
      0x01,
    ]);

    slotCell('#3031').click();
    sheetButton('Unequip → backpack')!.click();
    expect(sent[1]).toEqual([
      0x78,
      0xff, 0xff, 0x0a, 0x00, 0x00,
      0xd7, 0x0b,
      0x0a,
      0xff, 0xff, 0x03, 0x00, 0x00,
      38,
    ]);
  });

  it('tapping the equipped backpack itself opens no sheet (from == to is server-dropped)', () => {
    const { client, dispatcher, sent } = makeClient();
    bindInventory(client);
    equip(dispatcher, 3, BAG_ID);

    slotCell('#2853').click();
    expect(document.querySelector('.action-sheet-backdrop')).toBeNull();
    expect(sent).toEqual([]);
  });
});
