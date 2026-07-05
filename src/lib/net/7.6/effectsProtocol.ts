import type { InputPacket } from '../common/InputPacket';
import type {
  MagicEffectEvent,
  AnimatedTextEvent,
  DistanceShotEvent,
  CreatureSquareEvent,
} from '../common/types';

/**
 * 7.6 combat/world effect packets, layouts verified against the server's
 * AddMagicEffect / AddAnimatedText / AddDistanceShoot / AddCreatureSquare
 * (protocol76.cpp).
 *
 * The server writes effect and missile types as `enum + 1` (AddByte(type
 * + 1)), so the wire byte is already the 1-based .dat id — pass it to
 * dat.effects/dat.missiles lookups as-is, don't re-add the offset.
 */

/** 0x83 — position (U16 x, U16 y, U8 z) + U8 effect id. */
export function parseMagicEffect(packet: InputPacket): MagicEffectEvent {
  const { x, y, z } = packet.getPosition();
  return { x, y, z, effectId: packet.getU8() };
}

/** 0x84 — position + U8 palette color + string text. */
export function parseAnimatedText(packet: InputPacket): AnimatedTextEvent {
  const { x, y, z } = packet.getPosition();
  return { x, y, z, color: packet.getU8(), text: packet.getString() };
}

/** 0x85 — from position + to position + U8 missile id. */
export function parseDistanceShot(packet: InputPacket): DistanceShotEvent {
  const from = packet.getPosition();
  const to = packet.getPosition();
  return {
    fromX: from.x,
    fromY: from.y,
    fromZ: from.z,
    toX: to.x,
    toY: to.y,
    toZ: to.z,
    missileId: packet.getU8(),
  };
}

/** 0x86 — U32 creature id + U8 palette color. */
export function parseCreatureSquare(packet: InputPacket): CreatureSquareEvent {
  return { creatureId: packet.getU32(), color: packet.getU8() };
}
