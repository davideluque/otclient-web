import { describe, expect, it } from 'vitest';
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
