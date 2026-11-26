import { describe, expect, it } from 'vitest';
import { buildLookAtPacket, buildLogoutPacket, buildMoveThingPacket, buildUseItemPacket, buildUseItemWithPacket } from '../../lib/net/7.6/actionsProtocol';
import { containerSlotPosition, inventorySlotPosition, PLAYER_BACKPACK_SLOT } from '../../lib/net/common/virtualPosition';

describe('actions packets', () => {
  it('LookAt is pos + spriteId + stackpos', () => {
    const b = buildLookAtPacket({ x: 0x1234, y: 0x5678, z: 7 }, 1987, 2).toUint8Array();
    expect([...b]).toEqual([0x8c, 0x34, 0x12, 0x78, 0x56, 7, 0xc3, 0x07, 2]);
  });

  it('UseItem is pos + spriteId + stackpos + index', () => {
    const b = buildUseItemPacket({ x: 1, y: 2, z: 7 }, 100, 0).toUint8Array();
    expect([...b]).toEqual([0x82, 1, 0, 2, 0, 7, 100, 0, 0, 0]);
  });

  it('Logout is the bare opcode', () => {
    expect([...buildLogoutPacket().toUint8Array()]).toEqual([0x14]);
  });
});

describe('buildUseItemWithPacket', () => {
  it('is opcode + from triple + to triple, virtual positions included', () => {
    const b = buildUseItemWithPacket(
      containerSlotPosition(2, 1), 3031, 1,
      { x: 100, y: 200, z: 7 }, 1987, 0,
    ).toUint8Array();
    expect([...b]).toEqual([
      0x83,
      0xff, 0xff, 0x42, 0x00, 0x01, // from: container 2, slot 1
      0xd7, 0x0b, // fromSpriteId 3031
      0x01, // fromStackpos = slot
      0x64, 0x00, 0xc8, 0x00, 0x07, // to: map tile
      0xc3, 0x07, // toSpriteId 1987
      0x00, // toStackpos
    ]);
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
