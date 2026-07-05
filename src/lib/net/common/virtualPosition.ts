import type { WirePosition } from './types';

/**
 * Virtual wire positions — how OT protocols address things the player
 * carries rather than things on the map. `x = 0xFFFF` marks a carried
 * thing; bit 0x40 in `y` selects container addressing, otherwise `y`
 * is an inventory slot. This scheme (and the slot numbering below) is
 * shared across OT protocol versions, hence common/; the numeric wire
 * layout mirrors the server's Game::internalGetPosition /
 * internalGetThing (game.cpp:430-580).
 */

/**
 * Equipment slot wire values (server creature.h slots_t: 1 head,
 * 2 necklace, 3 backpack, 4 armor, 5 right, 6 left, 7 legs, 8 feet,
 * 9 ring, 10 ammo). Moving an item *onto* the backpack slot while a
 * backpack is equipped puts it inside that backpack (the server's
 * queryDestination forwards to the container) — which is exactly what
 * tap-to-loot wants.
 */
export const PLAYER_BACKPACK_SLOT = 3;

/**
 * Address a slot of an open container window. The matching
 * `fromStackpos` byte is the same `slot` value (the server's own
 * encode mirror sets `stackpos = pos.z`).
 */
export function containerSlotPosition(containerId: number, slot: number): WirePosition {
  return { x: 0xffff, y: 0x40 | containerId, z: slot };
}

/**
 * Address an equipment slot (1 head … 10 ammo). The matching
 * `fromStackpos` byte is the `slot` value itself — the server's encode
 * mirror sets `stackpos = pos.y` for inventory things, not 0.
 */
export function inventorySlotPosition(slot: number): WirePosition {
  return { x: 0xffff, y: slot, z: 0 };
}
