import { InputPacket } from '../common/InputPacket';

export interface MapTileItem {
  id: number;
  count?: number;
}

export interface MapCreature {
  id: number;
  name: string;
  health: number;
  direction: number;
  outfit: {
    lookType: number;
    head: number;
    body: number;
    legs: number;
    feet: number;
  };
  lightLevel: number;
  lightColor: number;
  speed: number;
}

export interface MapTile {
  x: number;
  y: number;
  z: number;
  items: MapTileItem[];
  creatures: MapCreature[];
}

/**
 * Special marker: 0xFF 0xFF means "skip tiles" in the map description.
 */
const SKIP_MARKER = 0xff;

/**
 * Known creature types in tile descriptions.
 */
const CREATURE_KNOWN = 0x0061;
const CREATURE_UNKNOWN = 0x0062;

/**
 * Parse a map description for a rectangular area.
 * The server sends tiles column by column, floor by floor.
 */
export function parseMapDescription(
  packet: InputPacket,
  startX: number, startY: number,
  endX: number, endY: number,
  z: number,
): MapTile[] {
  const tiles: MapTile[] = [];
  let skipCount = 0;

  for (let nx = startX; nx <= endX; nx++) {
    for (let ny = startY; ny <= endY; ny++) {
      if (skipCount > 0) {
        skipCount--;
        continue;
      }

      const tile: MapTile = { x: nx, y: ny, z, items: [], creatures: [] };

      // Parse tile things until skip marker
      const skip = parseTileThings(packet, tile);
      skipCount = skip;

      if (tile.items.length > 0 || tile.creatures.length > 0) {
        tiles.push(tile);
      }
    }
  }

  return tiles;
}

/**
 * Parse things (items/creatures) on a single tile.
 * Returns the number of tiles to skip after this one.
 */
function parseTileThings(packet: InputPacket, tile: MapTile): number {
  while (packet.bytesLeft >= 2) {
    const thingId = packet.peekU16();

    // Skip marker: 0xFF 0xFF followed by skip count
    if ((thingId & 0xff) === SKIP_MARKER && ((thingId >> 8) & 0xff) === SKIP_MARKER) {
      packet.getU16(); // consume the marker
      return packet.bytesLeft >= 2 ? packet.getU16() : 0;
    }

    // Known or unknown creature
    if (thingId === CREATURE_KNOWN || thingId === CREATURE_UNKNOWN) {
      packet.getU16(); // consume creature marker
      const creature = parseCreature(packet, thingId === CREATURE_UNKNOWN);
      tile.creatures.push(creature);
      continue;
    }

    // Regular item
    const itemId = packet.getU16();
    const item: MapTileItem = { id: itemId };

    // Items with count (stackable items have count after ID)
    // In 7.6, stackable items are identified by the server
    // For simplicity, we don't parse count here — would need .dat cross-reference

    tile.items.push(item);
  }

  return 0;
}

function parseCreature(packet: InputPacket, isNew: boolean): MapCreature {
  let id: number;
  let name = '';

  if (isNew) {
    packet.getU32(); // removeKnown (creature ID to forget)
    id = packet.getU32();
    name = packet.getString();
  } else {
    id = packet.getU32();
  }

  const health = packet.getU8(); // health percent

  const direction = packet.getU8();

  // Outfit
  const lookType = packet.getU16();
  let head = 0, body = 0, legs = 0, feet = 0;
  if (lookType !== 0) {
    head = packet.getU8();
    body = packet.getU8();
    legs = packet.getU8();
    feet = packet.getU8();
  }

  // Light
  const lightLevel = packet.getU8();
  const lightColor = packet.getU8();

  // Speed
  const speed = packet.getU16();

  // Skull + party shield (7.6+)
  packet.getU8(); // skull
  packet.getU8(); // shield

  return {
    id,
    name,
    health,
    direction,
    outfit: { lookType, head, body, legs, feet },
    lightLevel,
    lightColor,
    speed,
  };
}
