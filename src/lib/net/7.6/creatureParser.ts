import { InputPacket } from '../common/InputPacket';

export interface CreatureMoveEvent {
  type: 'move';
  creatureId: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  fromStack: number;
  toX: number;
  toY: number;
  toZ: number;
}

export interface CreatureTurnEvent {
  type: 'turn';
  creatureId: number;
  direction: number;
}

export interface CreatureHealthEvent {
  type: 'health';
  creatureId: number;
  healthPercent: number;
}

export interface CreatureLightEvent {
  type: 'light';
  creatureId: number;
  lightLevel: number;
  lightColor: number;
}

export interface CreatureSpeedEvent {
  type: 'speed';
  creatureId: number;
  speed: number;
}

export interface CreatureOutfitEvent {
  type: 'outfit';
  creatureId: number;
  lookType: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
}

export type CreatureEvent =
  | CreatureMoveEvent
  | CreatureTurnEvent
  | CreatureHealthEvent
  | CreatureLightEvent
  | CreatureSpeedEvent
  | CreatureOutfitEvent;

/**
 * Parse a creature move packet (opcode 0x6d).
 * The server sends the old position + stack index, then the new position.
 */
export function parseCreatureMove(packet: InputPacket): CreatureMoveEvent {
  const fromPos = packet.getPosition();
  const fromStack = packet.getU8();
  const toPos = packet.getPosition();

  return {
    type: 'move',
    creatureId: 0, // Not sent in move packet — must be looked up from tile
    fromX: fromPos.x,
    fromY: fromPos.y,
    fromZ: fromPos.z,
    fromStack,
    toX: toPos.x,
    toY: toPos.y,
    toZ: toPos.z,
  };
}

/**
 * Parse creature turn (direction change).
 * Sent as part of a tile transform packet with creature data.
 */
export function parseCreatureTurn(packet: InputPacket): CreatureTurnEvent {
  const creatureId = packet.getU32();
  const direction = packet.getU8();
  return { type: 'turn', creatureId, direction };
}

/**
 * Parse creature health update.
 */
export function parseCreatureHealth(packet: InputPacket): CreatureHealthEvent {
  const creatureId = packet.getU32();
  const healthPercent = packet.getU8();
  return { type: 'health', creatureId, healthPercent };
}

/**
 * Parse creature light update.
 */
export function parseCreatureLight(packet: InputPacket): CreatureLightEvent {
  const creatureId = packet.getU32();
  const lightLevel = packet.getU8();
  const lightColor = packet.getU8();
  return { type: 'light', creatureId, lightLevel, lightColor };
}

/**
 * Parse creature speed update.
 */
export function parseCreatureSpeed(packet: InputPacket): CreatureSpeedEvent {
  const creatureId = packet.getU32();
  const speed = packet.getU16();
  return { type: 'speed', creatureId, speed };
}

/**
 * Parse creature outfit change.
 */
export function parseCreatureOutfit(packet: InputPacket): CreatureOutfitEvent {
  const creatureId = packet.getU32();
  const lookType = packet.getU16();
  let head = 0, body = 0, legs = 0, feet = 0;
  if (lookType !== 0) {
    head = packet.getU8();
    body = packet.getU8();
    legs = packet.getU8();
    feet = packet.getU8();
  }
  return { type: 'outfit', creatureId, lookType, head, body, legs, feet };
}
