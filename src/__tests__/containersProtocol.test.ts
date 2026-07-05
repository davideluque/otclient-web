import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseContainerOpen,
  parseContainerClose,
  parseContainerAddItem,
  parseContainerUpdateItem,
  parseContainerRemoveItem,
  buildCloseContainerPacket,
  buildUpContainerPacket,
} from '../lib/net/7.6/containersProtocol';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { setItemWireFlags, resetItemWireFlags } from '../lib/net/common/itemFlags';
import { ThingCategory, DatAttr } from '../lib/dat';
import type { DatFile } from '../lib/dat';

const STACKABLE_ID = 3031;
const PLAIN_ID = 2853; // bag

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

describe('parseContainerOpen', () => {
  it('parses the full 0x6E layout, count bytes only on stackables', () => {
    const out = new OutputPacket();
    out.addU8(2); // cid
    out.addU16(PLAIN_ID); // container item id — AddItemId, never a count byte
    out.addString('Backpack');
    out.addU8(20); // capacity
    out.addU8(1); // hasParent
    out.addU8(2); // item count
    out.addU16(STACKABLE_ID);
    out.addU8(57); // stackable → count byte
    out.addU16(PLAIN_ID); // plain → no count byte

    expect(parseContainerOpen(new InputPacket(out.toArrayBuffer()))).toEqual({
      containerId: 2,
      containerItemId: PLAIN_ID,
      name: 'Backpack',
      capacity: 20,
      hasParent: true,
      items: [{ id: STACKABLE_ID, count: 57 }, { id: PLAIN_ID }],
    });
  });

  it('parses an empty container without a parent', () => {
    const out = new OutputPacket();
    out.addU8(0);
    out.addU16(PLAIN_ID);
    out.addString('Dead Rat');
    out.addU8(6);
    out.addU8(0);
    out.addU8(0);

    const open = parseContainerOpen(new InputPacket(out.toArrayBuffer()));
    expect(open.hasParent).toBe(false);
    expect(open.items).toEqual([]);
  });
});

describe('container update packets', () => {
  it('parses 0x6F close', () => {
    const out = new OutputPacket();
    out.addU8(7);
    expect(parseContainerClose(new InputPacket(out.toArrayBuffer()))).toBe(7);
  });

  it('parses 0x70 add (no slot byte on the wire)', () => {
    const out = new OutputPacket();
    out.addU8(1);
    out.addU16(STACKABLE_ID);
    out.addU8(3);
    expect(parseContainerAddItem(new InputPacket(out.toArrayBuffer()))).toEqual({
      containerId: 1,
      item: { id: STACKABLE_ID, count: 3 },
    });
  });

  it('parses 0x71 update at a slot', () => {
    const out = new OutputPacket();
    out.addU8(1);
    out.addU8(4);
    out.addU16(PLAIN_ID);
    expect(parseContainerUpdateItem(new InputPacket(out.toArrayBuffer()))).toEqual({
      containerId: 1,
      slot: 4,
      item: { id: PLAIN_ID },
    });
  });

  it('parses 0x72 remove at a slot', () => {
    const out = new OutputPacket();
    out.addU8(1);
    out.addU8(9);
    expect(parseContainerRemoveItem(new InputPacket(out.toArrayBuffer()))).toEqual({
      containerId: 1,
      slot: 9,
    });
  });
});

describe('outgoing container packets', () => {
  it('builds 0x87 close', () => {
    const p = new InputPacket(buildCloseContainerPacket(5).toArrayBuffer());
    expect(p.getU8()).toBe(0x87);
    expect(p.getU8()).toBe(5);
  });

  it('builds 0x88 up-arrow', () => {
    const p = new InputPacket(buildUpContainerPacket(15).toArrayBuffer());
    expect(p.getU8()).toBe(0x88);
    expect(p.getU8()).toBe(15);
  });
});
