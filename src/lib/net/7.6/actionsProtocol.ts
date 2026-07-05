import { OutputPacket } from '../common/OutputPacket';
import type { WirePosition } from '../common/types';
import { ClientOp } from './opcodes';

/**
 * 7.6 world-interaction packets, layouts verified against the server's
 * parseLookAt / parseUseItem / parseThrow (protocol76.cpp):
 *   LookAt    0x8C: pos(5) + U16 spriteId + U8 stackpos
 *   UseItem   0x82: pos(5) + U16 spriteId + U8 stackpos + U8 index
 *   ThrowItem 0x78: pos(5) + U16 spriteId + U8 stackpos + pos(5) + U8 count
 */
export function buildLookAtPacket(pos: WirePosition, spriteId: number, stackPos: number): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.LookAt);
  out.addPosition(pos.x, pos.y, pos.z);
  out.addU16(spriteId);
  out.addU8(stackPos);
  return out;
}

export function buildUseItemPacket(pos: WirePosition, spriteId: number, stackPos: number, index = 0): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.UseItem);
  out.addPosition(pos.x, pos.y, pos.z);
  out.addU16(spriteId);
  out.addU8(stackPos);
  out.addU8(index);
  return out;
}

/**
 * 0x78 — move a thing. From/to may be map tiles or the virtual
 * container/inventory positions (virtualPosition.ts). The server's
 * parseThrow drops the packet outright when `to` equals `from`.
 */
export function buildMoveThingPacket(
  from: WirePosition,
  spriteId: number,
  fromStackPos: number,
  to: WirePosition,
  count: number,
): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.ThrowItem);
  out.addPosition(from.x, from.y, from.z);
  out.addU16(spriteId);
  out.addU8(fromStackPos);
  out.addPosition(to.x, to.y, to.z);
  out.addU8(count);
  return out;
}

/**
 * 0x83 — use `from` on `to` (rope on a rope spot, shovel on a stone
 * pile, rune on a creature's tile). Layout per the server's
 * parseUseItemEx (protocol76.cpp:1182): both ends carry the full
 * pos + spriteId + stackpos triple, and either may be a virtual
 * container/inventory position (virtualPosition.ts).
 */
export function buildUseItemWithPacket(
  from: WirePosition,
  fromSpriteId: number,
  fromStackPos: number,
  to: WirePosition,
  toSpriteId: number,
  toStackPos: number,
): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.UseItemWith);
  out.addPosition(from.x, from.y, from.z);
  out.addU16(fromSpriteId);
  out.addU8(fromStackPos);
  out.addPosition(to.x, to.y, to.z);
  out.addU16(toSpriteId);
  out.addU8(toStackPos);
  return out;
}

/** 0x14 — request a clean logout; the server saves and closes. */
export function buildLogoutPacket(): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.Logout);
  return out;
}

/** 0xA1 — set the attacked creature; id 0 stops attacking. */
export function buildAttackPacket(creatureId: number): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.Attack);
  out.addU32(creatureId);
  return out;
}

/**
 * 0xA0 — set fight/chase/secure modes. Wire bytes per the server's
 * parseFightModes: fight 1=offensive 2=balanced 3=defensive; chase
 * 0=stand 1=follow; secure 1=on (no attacking players).
 */
export function buildFightModesPacket(
  fightMode: 1 | 2 | 3,
  chase: boolean,
  secure: boolean,
): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.SetFightModes);
  out.addU8(fightMode);
  out.addU8(chase ? 1 : 0);
  out.addU8(secure ? 1 : 0);
  return out;
}

/** 0xDC — add a player to the VIP list by name. */
export function buildAddVipPacket(name: string): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.AddVip);
  out.addString(name);
  return out;
}

/** 0xDD — remove a VIP by guid. */
export function buildRemoveVipPacket(guid: number): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.RemoveVip);
  out.addU32(guid);
  return out;
}
