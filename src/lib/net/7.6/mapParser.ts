import { InputPacket } from '../common/InputPacket';
import type { MapTile, MapTileItem, MapCreature } from '../common/types';

/**
 * Skip marker: a single U16 written as `[count, 0xFF]` little-endian.
 * High byte 0xFF identifies it as a marker; low byte is the number of
 * empty tile slots to skip *after* the slot the marker is attached to.
 * Every tile slot — empty or non-empty — ends with one of these.
 */
const SKIP_MARKER_HIGH = 0xff00;
const SKIP_COUNT_MASK = 0x00ff;

/** Known/unknown creature thing markers (Tibia 7.6). */
const CREATURE_KNOWN = 0x0061;
const CREATURE_UNKNOWN = 0x0062;

/** OT 7.6 visible-floor range as a function of the player's z. */
function getVisibleFloors(playerZ: number): number[] {
  if (playerZ > 7) {
    // Underground: z-2 .. z+2 (clamped to [0, 15]), ascending top-of-screen
    // to bottom-of-screen.
    const startZ = Math.max(0, playerZ - 2);
    const endZ = Math.min(15, playerZ + 2);
    const floors: number[] = [];
    for (let z = startZ; z <= endZ; z++) floors.push(z);
    return floors;
  }
  // Above ground: 8 layers from sky down to ground, regardless of player's z.
  return [7, 6, 5, 4, 3, 2, 1, 0];
}

/**
 * Parse the 5-byte position prefix that introduces the initial map
 * description (opcode 0x64) — `U16 x, U16 y, U8 z`. Movement-update map
 * descriptions (opcodes 0x65–0x68) do not carry this prefix.
 */
export function parsePosition(packet: InputPacket): { x: number; y: number; z: number } {
  return {
    x: packet.getU16(),
    y: packet.getU16(),
    z: packet.getU8(),
  };
}

/**
 * Parse a map description region for the visible floors around the player.
 *
 * `playerZ` determines which floor stack the server has sent:
 * - z ≤ 7: 8 above-ground layers (z=7 down to z=0)
 * - z >  7: 5 underground layers (z-2 .. z+2)
 *
 * The same single skip counter carries across tiles AND floor boundaries —
 * a long run of empties past the end of one floor continues into the next.
 */
export function parseMapDescription(
  packet: InputPacket,
  startX: number, startY: number,
  endX: number, endY: number,
  playerZ: number,
): MapTile[] {
  const tiles: MapTile[] = [];
  const floors = getVisibleFloors(playerZ);
  let skipTiles = 0;

  for (const z of floors) {
    // Each visible floor is sent at a screen-position offset to preserve
    // perspective: above-ground (z < playerZ) shifts NW (dz negative),
    // underground (z > playerZ) shifts SE (dz positive). Translate to
    // world coordinates as we emit each tile so callers can index by
    // world position uniformly.
    const dz = z - playerZ;
    for (let nx = startX; nx <= endX; nx++) {
      for (let ny = startY; ny <= endY; ny++) {
        if (skipTiles > 0) {
          skipTiles--;
          continue;
        }
        if (packet.bytesLeft < 2) return tiles;

        // Peek the next U16. If the high byte is 0xFF it's a skip marker
        // for an empty tile slot — consume it and carry the count.
        const peek = packet.peekU16();
        if ((peek & SKIP_MARKER_HIGH) === SKIP_MARKER_HIGH) {
          skipTiles = packet.getU16() & SKIP_COUNT_MASK;
          continue;
        }

        // Non-empty tile slot: parse its things, then the trailing skip
        // marker that closes the slot.
        const tile: MapTile = { x: nx + dz, y: ny + dz, z, items: [], creatures: [] };
        skipTiles = parseTileSlot(packet, tile);
        tiles.push(tile);
      }
    }
  }

  return tiles;
}

/**
 * Parse the contents (items + creatures) of one non-empty tile slot,
 * stopping at and consuming the trailing skip marker. Returns the skip
 * count that the marker carries.
 */
function parseTileSlot(packet: InputPacket, tile: MapTile): number {
  while (packet.bytesLeft >= 2) {
    const peek = packet.peekU16();
    if ((peek & SKIP_MARKER_HIGH) === SKIP_MARKER_HIGH) {
      return packet.getU16() & SKIP_COUNT_MASK;
    }

    if (peek === CREATURE_KNOWN || peek === CREATURE_UNKNOWN) {
      packet.getU16(); // consume marker
      tile.creatures.push(parseCreature(packet, peek === CREATURE_UNKNOWN));
      continue;
    }

    const itemId = packet.getU16();
    const item: MapTileItem = { id: itemId };

    // TODO: stackable / fluid / splash items carry a trailing count byte
    // after the item ID. Detecting which IDs need that read requires a
    // .dat cross-reference — deferred to a follow-up PR. Until then, the
    // parser will misalign on tiles containing stackables (gold piles,
    // arrows, etc).

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
