import { OutputPacket } from '../common/OutputPacket';
import type { WirePosition } from '../common/types';
import { ClientOp } from './opcodes';

/**
 * 7.6 world-interaction packets, layouts verified against the server's
 * parseLookAt / parseUseItem (protocol76.cpp):
 *   LookAt  0x8C: pos(5) + U16 spriteId + U8 stackpos
 *   UseItem 0x82: pos(5) + U16 spriteId + U8 stackpos + U8 index
 */
function writePos(out: OutputPacket, pos: WirePosition): void {
  out.addU16(pos.x);
  out.addU16(pos.y);
  out.addU8(pos.z);
}

export function buildLookAtPacket(pos: WirePosition, spriteId: number, stackPos: number): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.LookAt);
  writePos(out, pos);
  out.addU16(spriteId);
  out.addU8(stackPos);
  return out;
}

export function buildUseItemPacket(pos: WirePosition, spriteId: number, stackPos: number, index = 0): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.UseItem);
  writePos(out, pos);
  out.addU16(spriteId);
  out.addU8(stackPos);
  out.addU8(index);
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
