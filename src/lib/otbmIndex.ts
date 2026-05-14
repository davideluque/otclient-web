import { BinaryReader } from './BinaryReader';
import { NODE_START, NODE_END, readNodeData, skipNode } from './nodeTree';
import {
  OtbmAttr,
  OtbmNode,
  parseItemAttrs,
} from './otbm';
import type {
  OtbmHeader,
  OtbmItem,
  OtbmRegion,
  OtbmTile,
  OtbmTown,
  Position,
} from './otbm';

/**
 * Byte-range descriptor for a TileArea node within an OTBM buffer.
 * `childrenStart` is the first byte after the node's data bytes (where tile
 * children begin); `childrenEnd` is the offset just past the closing NODE_END.
 */
export interface OtbmTileAreaEntry {
  baseX: number;
  baseY: number;
  baseZ: number;
  childrenStart: number;
  childrenEnd: number;
}

export interface OtbmIndex {
  header: OtbmHeader;
  towns: OtbmTown[];
  tileAreas: OtbmTileAreaEntry[];
}

function makeReader(bytes: Uint8Array): BinaryReader {
  return new BinaryReader(bytes.buffer as ArrayBuffer);
}

const TILE_AREA_SIZE = 256;

function tileAreaIntersects(entry: OtbmTileAreaEntry, region: OtbmRegion): boolean {
  if (region.z !== undefined && entry.baseZ !== region.z) return false;
  const minX = region.centerX - region.radius;
  const maxX = region.centerX + region.radius;
  const minY = region.centerY - region.radius;
  const maxY = region.centerY + region.radius;
  return (
    entry.baseX <= maxX
    && entry.baseX + TILE_AREA_SIZE - 1 >= minX
    && entry.baseY <= maxY
    && entry.baseY + TILE_AREA_SIZE - 1 >= minY
  );
}

function tileInRegion(tile: OtbmTile, region: OtbmRegion): boolean {
  if (region.z !== undefined && tile.position.z !== region.z) return false;
  return (
    tile.position.x >= region.centerX - region.radius
    && tile.position.x <= region.centerX + region.radius
    && tile.position.y >= region.centerY - region.radius
    && tile.position.y <= region.centerY + region.radius
  );
}

/**
 * Walk the OTBM tree once, recording byte ranges of every TileArea node
 * (without descending into their tile children) plus the header and towns.
 * The returned index lets later passes parse one TileArea at a time on demand.
 */
export function buildOtbmIndex(buffer: ArrayBuffer): OtbmIndex {
  const data = new Uint8Array(buffer);
  let offset = 0;

  if (data.length < 5) throw new Error('Invalid OTBM file: buffer too small');
  offset += 4;

  if (data[offset] !== NODE_START) {
    throw new Error(`Expected NODE_START at offset ${offset}`);
  }
  offset++;

  const root = readNodeData(data, offset);
  offset = root.nextOffset;

  if (root.bytes.length === 0 || root.bytes[0] !== OtbmNode.RootV1) {
    throw new Error('Invalid OTBM file: expected RootV1 node');
  }

  const rootReader = makeReader(root.bytes);
  rootReader.skip(1);
  const header: OtbmHeader = {
    version: rootReader.getU32(),
    width: rootReader.getU16(),
    height: rootReader.getU16(),
    majorVersionItems: rootReader.getU32(),
    minorVersionItems: rootReader.getU32(),
  };

  const tileAreas: OtbmTileAreaEntry[] = [];
  const towns: OtbmTown[] = [];
  const MAX_DEPTH = 16;

  function walk(depth = 0): void {
    if (depth > MAX_DEPTH) return;
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

      offset++;
      const node = readNodeData(data, offset);
      const childrenStart = node.nextOffset;

      if (node.bytes.length === 0) {
        offset = skipNode(data, childrenStart);
        continue;
      }

      const nodeType = node.bytes[0];

      switch (nodeType) {
        case OtbmNode.MapData:
          offset = childrenStart;
          walk(depth + 1);
          break;

        case OtbmNode.TileArea: {
          const r = makeReader(node.bytes);
          r.skip(1);
          const baseX = r.getU16();
          const baseY = r.getU16();
          const baseZ = r.getU8();
          const childrenEnd = skipNode(data, childrenStart);
          tileAreas.push({ baseX, baseY, baseZ, childrenStart, childrenEnd });
          offset = childrenEnd;
          break;
        }

        case OtbmNode.Towns:
          offset = childrenStart;
          walk(depth + 1);
          break;

        case OtbmNode.Town: {
          const r = makeReader(node.bytes);
          r.skip(1);
          const id = r.getU32();
          const name = r.getString();
          const templePosition: Position = { x: r.getU16(), y: r.getU16(), z: r.getU8() };
          towns.push({ id, name, templePosition });
          offset = skipNode(data, childrenStart);
          break;
        }

        default:
          offset = skipNode(data, childrenStart);
          break;
      }
    }
  }

  walk();

  return { header, towns, tileAreas };
}

/**
 * Parse all tiles inside a single TileArea by jumping to its byte range.
 * Optionally filters tiles by an `OtbmRegion`; entries that don't intersect
 * the region are rejected up-front so this is cheap to call from a chunk
 * loader.
 */
export function parseTilesInTileArea(
  buffer: ArrayBuffer,
  entry: OtbmTileAreaEntry,
  region?: OtbmRegion,
): OtbmTile[] {
  if (region && !tileAreaIntersects(entry, region)) return [];

  const data = new Uint8Array(buffer);
  const tiles: OtbmTile[] = [];
  let offset = entry.childrenStart;
  const end = Math.min(entry.childrenEnd, data.length);

  while (offset < end) {
    const marker = data[offset];

    if (marker === NODE_END) {
      break;
    }
    if (marker !== NODE_START) {
      offset++;
      continue;
    }

    offset++;
    const node = readNodeData(data, offset);
    offset = node.nextOffset;

    if (node.bytes.length === 0) {
      offset = skipNode(data, offset);
      continue;
    }

    const nodeType = node.bytes[0];
    if (nodeType !== OtbmNode.Tile && nodeType !== OtbmNode.HouseTile) {
      offset = skipNode(data, offset);
      continue;
    }

    const r = makeReader(node.bytes);
    r.skip(1);
    const xOff = r.getU8();
    const yOff = r.getU8();
    const tile: OtbmTile = {
      position: { x: entry.baseX + xOff, y: entry.baseY + yOff, z: entry.baseZ },
      flags: 0,
      items: [],
    };

    if (region && !tileInRegion(tile, region)) {
      offset = skipNode(data, offset);
      continue;
    }

    if (nodeType === OtbmNode.HouseTile) {
      r.skip(4);
    }

    while (r.position < r.length) {
      const attrType = r.getU8();
      if (attrType === OtbmAttr.TileFlags) {
        tile.flags = r.getU32();
      } else if (attrType === OtbmAttr.Item) {
        tile.items.push({ id: r.getU16() });
      } else if (attrType === OtbmAttr.Description) {
        r.getString();
      } else {
        break;
      }
    }

    while (offset < end) {
      const m = data[offset];
      if (m === NODE_END) { offset++; break; }
      if (m !== NODE_START) { offset++; continue; }

      offset++;
      const itemNode = readNodeData(data, offset);
      offset = itemNode.nextOffset;

      if (itemNode.bytes.length > 0 && itemNode.bytes[0] === OtbmNode.Item) {
        const ir = makeReader(itemNode.bytes);
        ir.skip(1);
        const item: OtbmItem = { id: ir.getU16() };
        parseItemAttrs(ir, item);
        tile.items.push(item);
      }

      offset = skipNode(data, offset);
    }

    tiles.push(tile);
  }

  return tiles;
}
