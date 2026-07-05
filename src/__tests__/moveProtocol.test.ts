import { describe, expect, it } from 'vitest';
import { buildMoveThingPacket } from '../lib/net/7.6/actionsProtocol';
import {
  containerSlotPosition,
  inventorySlotPosition,
  PLAYER_BACKPACK_SLOT,
} from '../lib/net/common/virtualPosition';

describe('virtual position helpers', () => {
  it('addresses a container slot as x=0xFFFF, y=0x40|cid, z=slot', () => {
    expect(containerSlotPosition(0, 0)).toEqual({ x: 0xffff, y: 0x40, z: 0 });
    expect(containerSlotPosition(15, 8)).toEqual({ x: 0xffff, y: 0x4f, z: 8 });
  });

  it('addresses an inventory slot as x=0xFFFF, y=slot, z=0', () => {
    expect(inventorySlotPosition(1)).toEqual({ x: 0xffff, y: 1, z: 0 });
    expect(inventorySlotPosition(10)).toEqual({ x: 0xffff, y: 10, z: 0 });
  });

  it('the backpack is equipment slot 3 (creature.h slots_t)', () => {
    expect(PLAYER_BACKPACK_SLOT).toBe(3);
    expect(inventorySlotPosition(PLAYER_BACKPACK_SLOT)).toEqual({ x: 0xffff, y: 3, z: 0 });
  });
});

describe('buildMoveThingPacket', () => {
  it('builds a map tile → container slot move byte-for-byte', () => {
    const bytes = buildMoveThingPacket(
      { x: 0x1234, y: 0x5678, z: 7 }, // ground tile
      1987,
      2, // wire stackpos on the tile
      containerSlotPosition(3, 0),
      1,
    ).toUint8Array();
    expect(Array.from(bytes)).toEqual([
      0x78, // ThrowItem
      0x34, 0x12, 0x78, 0x56, 0x07, // from: U16 x, U16 y, U8 z (LE)
      0xc3, 0x07, // spriteId 1987
      0x02, // fromStackpos
      0xff, 0xff, 0x43, 0x00, 0x00, // to: container 3, slot 0
      0x01, // count — 1 for a plain item
    ]);
  });

  it('builds a container slot → backpack equipment slot move with the stack count', () => {
    const bytes = buildMoveThingPacket(
      containerSlotPosition(1, 4),
      3031,
      4, // container fromStackpos = the slot
      inventorySlotPosition(PLAYER_BACKPACK_SLOT),
      57,
    ).toUint8Array();
    expect(Array.from(bytes)).toEqual([
      0x78,
      0xff, 0xff, 0x41, 0x00, 0x04, // from: container 1, slot 4
      0xd7, 0x0b, // spriteId 3031
      0x04,
      0xff, 0xff, 0x03, 0x00, 0x00, // to: equipment slot 3 (backpack)
      0x39, // count 57
    ]);
  });
});
