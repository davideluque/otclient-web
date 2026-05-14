import { describe, it, expect } from 'vitest';
import { OtbmNode, OtbmAttr } from '../lib/otbm';
import { buildOtbmIndex, parseTilesInTileArea } from '../lib/otbmIndex';

const NODE_START = 0xfe;
const NODE_END = 0xff;
const ESCAPE_CHAR = 0xfd;

function pushU16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

function pushU32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

function escapeBytes(raw: number[]): number[] {
  const escaped: number[] = [];
  for (const b of raw) {
    if (b === NODE_START || b === NODE_END || b === ESCAPE_CHAR) {
      escaped.push(ESCAPE_CHAR, b);
    } else {
      escaped.push(b);
    }
  }
  return escaped;
}

function buildRootData(): number[] {
  const raw: number[] = [];
  raw.push(OtbmNode.RootV1);
  pushU32(raw, 2);
  pushU16(raw, 1024);
  pushU16(raw, 1024);
  pushU32(raw, 3);
  pushU32(raw, 760);
  return escapeBytes(raw);
}

function buildTileNode(xOff: number, yOff: number, opts?: { groundItemId?: number }): number[] {
  const raw: number[] = [];
  raw.push(OtbmNode.Tile);
  raw.push(xOff);
  raw.push(yOff);
  if (opts?.groundItemId !== undefined) {
    raw.push(OtbmAttr.Item);
    pushU16(raw, opts.groundItemId);
  }
  return [NODE_START, ...escapeBytes(raw), NODE_END];
}

function buildTileAreaNode(baseX: number, baseY: number, baseZ: number, children: number[]): number[] {
  const raw: number[] = [];
  raw.push(OtbmNode.TileArea);
  pushU16(raw, baseX);
  pushU16(raw, baseY);
  raw.push(baseZ);
  return [NODE_START, ...escapeBytes(raw), ...children, NODE_END];
}

function buildTownNode(id: number, name: string, x: number, y: number, z: number): number[] {
  const raw: number[] = [];
  raw.push(OtbmNode.Town);
  pushU32(raw, id);
  pushU16(raw, name.length);
  for (let i = 0; i < name.length; i++) raw.push(name.charCodeAt(i));
  pushU16(raw, x);
  pushU16(raw, y);
  raw.push(z);
  return [NODE_START, ...escapeBytes(raw), NODE_END];
}

function buildTownsNode(towns: number[]): number[] {
  const raw: number[] = [OtbmNode.Towns];
  return [NODE_START, ...escapeBytes(raw), ...towns, NODE_END];
}

function buildMapDataNode(children: number[]): number[] {
  const raw: number[] = [OtbmNode.MapData];
  return [NODE_START, ...escapeBytes(raw), ...children, NODE_END];
}

function buildOtbm(opts: { tileAreas?: number[]; towns?: number[] }): ArrayBuffer {
  const bytes: number[] = [];
  pushU32(bytes, 0);
  bytes.push(NODE_START);
  bytes.push(...buildRootData());
  const mapChildren: number[] = [...(opts.tileAreas ?? [])];
  if (opts.towns && opts.towns.length > 0) mapChildren.push(...buildTownsNode(opts.towns));
  bytes.push(...buildMapDataNode(mapChildren));
  bytes.push(NODE_END);
  return new Uint8Array(bytes).buffer;
}

describe('buildOtbmIndex', () => {
  it('records one entry per TileArea without parsing tiles', () => {
    const t1 = buildTileAreaNode(0, 0, 7, [...buildTileNode(0, 0, { groundItemId: 100 })]);
    const t2 = buildTileAreaNode(256, 0, 7, [...buildTileNode(0, 0, { groundItemId: 101 })]);
    const t3 = buildTileAreaNode(0, 256, 7, [...buildTileNode(0, 0, { groundItemId: 102 })]);
    const buffer = buildOtbm({ tileAreas: [...t1, ...t2, ...t3] });

    const index = buildOtbmIndex(buffer);
    expect(index.tileAreas).toHaveLength(3);
    expect(index.tileAreas.map(e => ({ x: e.baseX, y: e.baseY, z: e.baseZ }))).toEqual([
      { x: 0, y: 0, z: 7 },
      { x: 256, y: 0, z: 7 },
      { x: 0, y: 256, z: 7 },
    ]);
  });

  it('parses the file header', () => {
    const index = buildOtbmIndex(buildOtbm({}));
    expect(index.header.version).toBe(2);
    expect(index.header.width).toBe(1024);
    expect(index.header.minorVersionItems).toBe(760);
  });

  it('collects towns even though it skips tile content', () => {
    const town = buildTownNode(1, 'Thais', 32100, 32100, 7);
    const index = buildOtbmIndex(buildOtbm({ towns: town }));
    expect(index.towns).toEqual([
      { id: 1, name: 'Thais', templePosition: { x: 32100, y: 32100, z: 7 } },
    ]);
  });

  it('returns byte ranges that contain the area\'s tile children', () => {
    const ta = buildTileAreaNode(100, 200, 7, [
      ...buildTileNode(5, 5, { groundItemId: 3050 }),
      ...buildTileNode(6, 5, { groundItemId: 3050 }),
    ]);
    const index = buildOtbmIndex(buildOtbm({ tileAreas: ta }));
    const entry = index.tileAreas[0];
    expect(entry.childrenStart).toBeLessThan(entry.childrenEnd);
    // Should not eagerly parse — but the byte range must be non-empty.
    expect(entry.childrenEnd - entry.childrenStart).toBeGreaterThan(0);
  });
});

describe('parseTilesInTileArea', () => {
  it('extracts tiles from a single area on demand', () => {
    const ta = buildTileAreaNode(100, 200, 7, [
      ...buildTileNode(5, 5, { groundItemId: 3050 }),
      ...buildTileNode(6, 5, { groundItemId: 3051 }),
    ]);
    const buffer = buildOtbm({ tileAreas: ta });
    const index = buildOtbmIndex(buffer);
    const tiles = parseTilesInTileArea(buffer, index.tileAreas[0]);

    expect(tiles).toHaveLength(2);
    expect(tiles[0].position).toEqual({ x: 105, y: 205, z: 7 });
    expect(tiles[0].items[0].id).toBe(3050);
    expect(tiles[1].position).toEqual({ x: 106, y: 205, z: 7 });
  });

  it('respects an optional region filter', () => {
    const ta = buildTileAreaNode(100, 100, 7, [
      ...buildTileNode(0, 0, { groundItemId: 1 }),
      ...buildTileNode(50, 50, { groundItemId: 2 }),
    ]);
    const buffer = buildOtbm({ tileAreas: ta });
    const index = buildOtbmIndex(buffer);
    const tiles = parseTilesInTileArea(buffer, index.tileAreas[0], {
      centerX: 150, centerY: 150, radius: 5, z: 7,
    });
    expect(tiles).toHaveLength(1);
    expect(tiles[0].position).toEqual({ x: 150, y: 150, z: 7 });
  });

  it('returns an empty array when the area does not intersect the region', () => {
    const ta = buildTileAreaNode(0, 0, 7, [...buildTileNode(0, 0, { groundItemId: 1 })]);
    const buffer = buildOtbm({ tileAreas: ta });
    const index = buildOtbmIndex(buffer);
    const tiles = parseTilesInTileArea(buffer, index.tileAreas[0], {
      centerX: 5000, centerY: 5000, radius: 50, z: 7,
    });
    expect(tiles).toEqual([]);
  });

  it('respects the optional z filter', () => {
    const ta = buildTileAreaNode(0, 0, 7, [...buildTileNode(10, 10, { groundItemId: 1 })]);
    const buffer = buildOtbm({ tileAreas: ta });
    const index = buildOtbmIndex(buffer);
    const tiles = parseTilesInTileArea(buffer, index.tileAreas[0], {
      centerX: 10, centerY: 10, radius: 50, z: 6,
    });
    expect(tiles).toEqual([]);
  });
});
