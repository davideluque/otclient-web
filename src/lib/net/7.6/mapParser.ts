import { InputPacket } from '../common/InputPacket';
import type { MapTile, MapTileItem, MapCreature } from '../common/types';
import { itemHasCountByte } from '../common/itemFlags';

/**
 * Skip marker: a single U16 written as `[count, 0xFF]` little-endian.
 * High byte 0xFF identifies it as a marker; low byte is the number of
 * empty tile slots to skip *after* the slot the marker is attached to.
 * Every tile slot — empty or non-empty — ends with one of these.
 */
const SKIP_MARKER_HIGH = 0xff00;
const SKIP_COUNT_MASK = 0x00ff;

/**
 * Known/unknown creature thing markers (Tibia 7.6). Verified against the
 * server's Protocol76::AddCreature: 0x62 is the KNOWN short form (id
 * only), 0x61 is the UNKNOWN long form (removeKnown id + id + name) —
 * the reverse of what later protocol docs suggest, so don't "fix" this
 * from memory.
 */
const CREATURE_KNOWN = 0x0062;
const CREATURE_UNKNOWN = 0x0061;

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
  return packet.getPosition();
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
    // Each visible floor is sent at a perspective offset: the server
    // reads floor `z` at world (x + n + offset) with offset = playerZ - z
    // (GetMapDescription → GetFloorDescription, offset = z_camera - nz).
    // Reconstructing world coordinates therefore ADDS that same offset —
    // floors above the camera (z < playerZ) sit further SE in world
    // space for the same screen cell. Getting this sign wrong displaces
    // every off-camera floor by 2×(playerZ−z) tiles, which is invisible
    // until a floor change makes one of those floors current ("the stair
    // is 2 right and 2 down of where I appear").
    const dz = playerZ - z;
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
        const tile: MapTile = { x: nx + dz, y: ny + dz, z, things: [], items: [], creatures: [] };
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
export function parseTileSlot(packet: InputPacket, tile: MapTile): number {
  while (packet.bytesLeft >= 2) {
    const peek = packet.peekU16();
    if ((peek & SKIP_MARKER_HIGH) === SKIP_MARKER_HIGH) {
      return packet.getU16() & SKIP_COUNT_MASK;
    }

    // Appending to things AND the matching view keeps both in wire
    // order — during a parse nothing is removed, so no resync needed.
    if (peek === CREATURE_KNOWN || peek === CREATURE_UNKNOWN) {
      packet.getU16(); // consume marker
      const creature = parseCreature(packet, peek === CREATURE_UNKNOWN);
      tile.things.push({ kind: 'creature', creature });
      tile.creatures.push(creature);
      continue;
    }

    const item = parseItem(packet);
    tile.things.push({ kind: 'item', item });
    tile.items.push(item);
  }

  return 0;
}

/**
 * Parse one item off the wire: `U16 clientId` plus a count/subtype byte
 * when the .dat flags this ID as stackable / splash / fluid container —
 * mirroring the server's NetworkMessage::AddItem. Requires
 * setItemWireFlags to have run (jamera does it when the asset bundle's
 * .dat parses); without it, stackables misalign the stream and the
 * resulting overread surfaces as a controlled ParseError.
 */
export function parseItem(packet: InputPacket): MapTileItem {
  const id = packet.getU16();
  if (itemHasCountByte(id)) {
    return { id, count: packet.getU8() };
  }
  return { id };
}

/**
 * Parse one creature block (the payload after a 0x61/0x62 thing marker).
 * `isNew` corresponds to the 0x61 "unknown creature" form, which carries
 * a removeKnown ID and the creature's name.
 */
export function parseCreature(packet: InputPacket, isNew: boolean): MapCreature {
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

  // Outfit. 7.6 sends lookType as a single byte (U16 came in later
  // protocol versions); lookType 0 means "looks like an item" and is
  // followed by the item's U16 client ID instead of the four colors.
  const lookType = packet.getU8();
  let head = 0, body = 0, legs = 0, feet = 0;
  if (lookType !== 0) {
    head = packet.getU8();
    body = packet.getU8();
    legs = packet.getU8();
    feet = packet.getU8();
  } else {
    packet.getU16(); // lookTypeEx item id — not rendered yet
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

/**
 * Parse a floor-change stream: one or more single-floor descriptions
 * written back-to-back with a SHARED skip counter (the server threads
 * one `skip` int through consecutive GetFloorDescription calls and
 * flushes the final marker once). Each floor's window is shifted by its
 * perspective `offset` — tiles land at (startX + offset + col,
 * startY + offset + row, z).
 *
 * Unlike parseMapDescription this cannot rely on running out of bytes:
 * floor-change frames continue with more opcodes (the 0x65/0x66/0x67/
 * 0x68 resync slices), so exactly width×height cells are consumed per
 * floor and not a byte more.
 */
export function parseFloorStream(
  packet: InputPacket,
  startX: number, startY: number,
  floors: ReadonlyArray<{ z: number; offset: number }>,
  width: number, height: number,
): MapTile[] {
  const tiles: MapTile[] = [];
  let skipTiles = 0;

  for (const { z, offset } of floors) {
    for (let col = 0; col < width; col++) {
      for (let row = 0; row < height; row++) {
        if (skipTiles > 0) {
          skipTiles--;
          continue;
        }
        const peek = packet.peekU16();
        if ((peek & SKIP_MARKER_HIGH) === SKIP_MARKER_HIGH) {
          skipTiles = packet.getU16() & SKIP_COUNT_MASK;
          continue;
        }
        const tile: MapTile = {
          x: startX + offset + col,
          y: startY + offset + row,
          z,
          things: [],
          items: [],
          creatures: [],
        };
        skipTiles = parseTileSlot(packet, tile);
        tiles.push(tile);
      }
    }
  }
  return tiles;
}
