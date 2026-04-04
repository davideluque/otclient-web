import { BinaryReader } from './BinaryReader';
import { NODE_START, NODE_END, readNodeData } from './nodeTree';

// --- Node types ---

export const OtbmNode = {
  RootV1: 0x01,
  MapData: 0x02,
  TileArea: 0x04,
  Tile: 0x05,
  Item: 0x06,
  Towns: 0x0c,
  Town: 0x0d,
  HouseTile: 0x0e,
} as const;

// --- Tile/Item attributes ---

export const OtbmAttr = {
  Description: 0x01,
  TileFlags: 0x03,
  ActionId: 0x04,
  UniqueId: 0x05,
  Text: 0x06,
  TeleDest: 0x08,
  Item: 0x09,
  Count: 0x0f,
  Charges: 0x16,
} as const;

// --- Data types ---

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface OtbmItem {
  id: number;
  count?: number;
  actionId?: number;
  uniqueId?: number;
  text?: string;
  teleDest?: Position;
}

export interface OtbmTile {
  position: Position;
  flags: number;
  items: OtbmItem[];
}

export interface OtbmTown {
  id: number;
  name: string;
  templePosition: Position;
}

export interface OtbmHeader {
  version: number;
  width: number;
  height: number;
  majorVersionItems: number;
  minorVersionItems: number;
}

export interface OtbmFile {
  header: OtbmHeader;
  tiles: OtbmTile[];
  towns: OtbmTown[];
}

// --- Internal helpers ---

function makeReader(bytes: Uint8Array): BinaryReader {
  // readNodeData already returns a fresh Uint8Array with byteOffset=0, no need to slice
  return new BinaryReader(bytes.buffer as ArrayBuffer);
}

/**
 * Parse item attributes from a BinaryReader at the current position.
 * Reads attributes until the reader is exhausted.
 */
function parseItemAttrs(reader: BinaryReader, item: OtbmItem): void {
  while (reader.position < reader.length) {
    const attrType = reader.getU8();

    switch (attrType) {
      case OtbmAttr.Count:
        item.count = reader.getU8();
        break;
      case OtbmAttr.Charges:
        item.count = reader.getU16();
        break;
      case OtbmAttr.ActionId:
        item.actionId = reader.getU16();
        break;
      case OtbmAttr.UniqueId:
        item.uniqueId = reader.getU16();
        break;
      case OtbmAttr.Text: {
        item.text = reader.getString();
        break;
      }
      case OtbmAttr.TeleDest:
        item.teleDest = { x: reader.getU16(), y: reader.getU16(), z: reader.getU8() };
        break;
      default:
        // Unknown attribute — can't determine length, stop parsing
        return;
    }
  }
}

// --- Main parser ---

/**
 * Walk the raw OTBM byte stream, extracting tiles and items.
 * Uses a state-machine approach over the escape-encoded node tree.
 */
export function parseOtbm(buffer: ArrayBuffer): OtbmFile {
  const data = new Uint8Array(buffer);
  let offset = 0;

  // Skip 4-byte file identifier
  if (data.length < 5) {
    throw new Error('Invalid OTBM file: buffer too small');
  }
  offset += 4;

  // Root NODE_START
  if (data[offset] !== NODE_START) {
    throw new Error(`Expected NODE_START at offset ${offset}`);
  }
  offset++;

  // Read root node data
  const root = readNodeData(data, offset);
  offset = root.nextOffset;

  if (root.bytes.length === 0 || root.bytes[0] !== OtbmNode.RootV1) {
    throw new Error('Invalid OTBM file: expected RootV1 node');
  }

  const rootReader = makeReader(root.bytes);
  rootReader.skip(1); // node type byte

  const header: OtbmHeader = {
    version: rootReader.getU32(),
    width: rootReader.getU16(),
    height: rootReader.getU16(),
    majorVersionItems: rootReader.getU32(),
    minorVersionItems: rootReader.getU32(),
  };

  const tiles: OtbmTile[] = [];
  const towns: OtbmTown[] = [];
  let areaBaseX = 0;
  let areaBaseY = 0;
  let areaBaseZ = 0;

  const MAX_DEPTH = 32;

  // Recursive node walker
  function walkNodes(end: number, depth = 0): void {
    if (depth > MAX_DEPTH) return;
    while (offset < end && offset < data.length) {
      const marker = data[offset];

      if (marker === NODE_END) {
        offset++;
        return;
      }

      if (marker !== NODE_START) {
        offset++;
        continue;
      }

      offset++; // consume NODE_START
      const node = readNodeData(data, offset);
      offset = node.nextOffset;

      if (node.bytes.length === 0) {
        // Empty node, skip children
        walkNodes(data.length, depth + 1);
        continue;
      }

      const nodeType = node.bytes[0];

      switch (nodeType) {
        case OtbmNode.MapData:
          // Container node — recurse into children
          walkNodes(data.length, depth + 1);
          break;

        case OtbmNode.TileArea: {
          const r = makeReader(node.bytes);
          r.skip(1); // node type
          areaBaseX = r.getU16();
          areaBaseY = r.getU16();
          areaBaseZ = r.getU8();
          // Recurse into tile children
          walkNodes(data.length, depth + 1);
          break;
        }

        case OtbmNode.Tile:
        case OtbmNode.HouseTile: {
          const r = makeReader(node.bytes);
          r.skip(1); // node type
          const xOff = r.getU8();
          const yOff = r.getU8();

          const tile: OtbmTile = {
            position: { x: areaBaseX + xOff, y: areaBaseY + yOff, z: areaBaseZ },
            flags: 0,
            items: [],
          };

          if (nodeType === OtbmNode.HouseTile) {
            r.skip(4); // house_id
          }

          // Read tile attributes
          while (r.position < r.length) {
            const attrType = r.getU8();
            if (attrType === OtbmAttr.TileFlags) {
              tile.flags = r.getU32();
            } else if (attrType === OtbmAttr.Item) {
              tile.items.push({ id: r.getU16() });
            } else if (attrType === OtbmAttr.Description) {
              r.getString(); // skip description string
            } else {
              break; // Unknown attr, stop
            }
          }

          // Parse child item nodes
          walkTileItems(tile, depth);
          tiles.push(tile);
          break;
        }

        case OtbmNode.Towns:
          walkNodes(data.length, depth + 1);
          break;

        case OtbmNode.Town: {
          const r = makeReader(node.bytes);
          r.skip(1); // node type
          const id = r.getU32();
          const name = r.getString();
          const templePosition: Position = { x: r.getU16(), y: r.getU16(), z: r.getU8() };
          towns.push({ id, name, templePosition });
          // Skip any children
          walkNodes(data.length, depth + 1);
          break;
        }

        default:
          // Skip unknown node types and their children
          walkNodes(data.length, depth + 1);
          break;
      }
    }
  }

  function walkTileItems(tile: OtbmTile, depth: number): void {
    while (offset < data.length) {
      const marker = data[offset];

      if (marker === NODE_END) {
        offset++;
        return;
      }

      if (marker !== NODE_START) {
        offset++;
        continue;
      }

      offset++; // consume NODE_START
      const node = readNodeData(data, offset);
      offset = node.nextOffset;

      if (node.bytes.length > 0 && node.bytes[0] === OtbmNode.Item) {
        const r = makeReader(node.bytes);
        r.skip(1); // node type
        const item: OtbmItem = { id: r.getU16() };
        parseItemAttrs(r, item);
        tile.items.push(item);
      }

      // Skip any nested children (container items)
      walkNodes(data.length, depth + 1);
    }
  }

  // Walk root's children
  walkNodes(data.length, 0);

  return { header, tiles, towns };
}
