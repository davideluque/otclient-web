import { debugConsole } from './debugConsole';
import { OtbmAttr, OtbmNode, parseOtbmRegion, type OtbmFile, type OtbmRegion, type Position } from './otbm';
import { NODE_END, NODE_START, readNodeData, skipNode } from './nodeTree';

export function findMapSpawn(buffer: ArrayBuffer): Position {
  // Pass 1: parse only the towns list. A radius-0 region skips every
  // TileArea, so the parser emits header + towns metadata — enough to
  // pick a spawn before we pay for tile data.
  const metadataRegion: OtbmRegion = { centerX: 0, centerY: 0, radius: 0, z: 7 };
  const metadata: OtbmFile = parseOtbmRegion(buffer, metadataRegion);

  // Pick the spawn: caller override (future server hook) → Rookgaard town
  // (the canonical Tibia 7.6 starting point) → first town the map declares
  // → first tile we can find by scanning.
  const pickedSpawn = pickSpawn(metadata) ?? findFirstTile(buffer);
  if (!pickedSpawn) {
    debugConsole?.warn('OTBM declares no towns and findFirstTile found nothing — spawning at (0, 0, 7). Map is probably empty or has an unusual structure.');
  }
  return pickedSpawn ?? { x: 0, y: 0, z: 7 };
}

/**
 * Decide where the player should appear when the map loads.
 *
 * Layered fallbacks, in order of authority:
 *   1. `override` — the future hook for server-driven login positions
 *      ("you logged out at X, log back in there"). Unused today but
 *      makes the seam explicit.
 *   2. A town named "Rookgaard" — the canonical Tibia 7.6 starting
 *      point. Every real-Tibia 7.6 OTBM declares it.
 *   3. Any town the map declares — better than a hardcoded coordinate
 *      because it's guaranteed to be inside the populated area of
 *      *this* particular map.
 *   4. `null` — caller falls back to a tile-scan probe.
 */
function pickSpawn(otbm: OtbmFile, override?: Position): Position | null {
  if (override) return override;

  // Exact case-insensitive match wins over partial — otherwise "Rookgaard East"
  // would shadow the canonical "Rookgaard" town when both exist.
  const exact = otbm.towns.find(t => t.name.toLowerCase() === 'rookgaard');
  if (exact) return exact.templePosition;

  const partial = otbm.towns.find(t => /rookgaard/i.test(t.name));
  if (partial) return partial.templePosition;

  if (otbm.towns.length > 0) return otbm.towns[0].templePosition;
  return null;
}

function findFirstTile(buffer: ArrayBuffer): { x: number; y: number; z: number } | null {
  const data = new Uint8Array(buffer);
  let offset = 4;
  const scanEnd = Math.min(data.length, 1024 * 1024);
  let areaBaseX = 0;
  let areaBaseY = 0;
  let areaBaseZ = 0;

  if (data[offset] !== NODE_START) return null;
  offset++;

  const root = readNodeData(data, offset);
  offset = root.nextOffset;

  function walk(depth = 0): { x: number; y: number; z: number } | null {
    if (depth > 8) return null;

    while (offset < scanEnd && offset < data.length) {
      const marker = data[offset];

      if (marker === NODE_END) {
        offset++;
        return null;
      }

      if (marker !== NODE_START) {
        offset++;
        continue;
      }

      offset++;
      const node = readNodeData(data, offset);
      offset = node.nextOffset;
      if (node.bytes.length === 0) {
        const found = walk(depth + 1);
        if (found) return found;
        continue;
      }

      const nodeType = node.bytes[0];
      if (nodeType === OtbmNode.TileArea) {
        areaBaseX = node.bytes[1] | (node.bytes[2] << 8);
        areaBaseY = node.bytes[3] | (node.bytes[4] << 8);
        areaBaseZ = node.bytes[5];
        if (areaBaseZ !== 7) {
          offset = skipNode(data, offset);
          continue;
        }
        const found = walk(depth + 1);
        if (found) return found;
      } else if (nodeType === OtbmNode.Tile || nodeType === OtbmNode.HouseTile) {
        if (tileNodeHasItems(node.bytes) || data[offset] === NODE_START) {
          return {
            x: areaBaseX + node.bytes[1],
            y: areaBaseY + node.bytes[2],
            z: areaBaseZ,
          };
        }
        offset = skipNode(data, offset);
      } else if (nodeType === OtbmNode.MapData || nodeType === OtbmNode.Towns) {
        const found = walk(depth + 1);
        if (found) return found;
      } else {
        offset = skipNode(data, offset);
      }
    }

    return null;
  }

  return walk();
}

function tileNodeHasItems(bytes: Uint8Array): boolean {
  let offset = bytes[0] === OtbmNode.HouseTile ? 7 : 3;

  while (offset < bytes.length) {
    const attrType = bytes[offset];
    offset++;

    if (attrType === OtbmAttr.Item) return true;
    if (attrType === OtbmAttr.TileFlags) {
      offset += 4;
    } else if (attrType === OtbmAttr.Description) {
      const len = bytes[offset] | (bytes[offset + 1] << 8);
      offset += 2 + len;
    } else {
      break;
    }
  }

  return false;
}
