import { describe, it, expect } from 'vitest';
import { parseOtbm, parseOtbmRegion, OtbmNode, OtbmAttr } from '../lib/otbm';

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
  raw.push(OtbmNode.RootV1); // node type
  pushU32(raw, 2);    // version
  pushU16(raw, 1024); // width
  pushU16(raw, 1024); // height
  pushU32(raw, 3);    // majorVersionItems
  pushU32(raw, 760);  // minorVersionItems
  return escapeBytes(raw);
}

function buildTileAreaNode(
  baseX: number,
  baseY: number,
  baseZ: number,
  children: number[],
): number[] {
  const raw: number[] = [];
  raw.push(OtbmNode.TileArea);
  pushU16(raw, baseX);
  pushU16(raw, baseY);
  raw.push(baseZ);
  return [NODE_START, ...escapeBytes(raw), ...children, NODE_END];
}

function buildTileNode(
  xOff: number,
  yOff: number,
  opts?: { flags?: number; groundItemId?: number; childItems?: number[][] },
): number[] {
  const raw: number[] = [];
  raw.push(OtbmNode.Tile);
  raw.push(xOff);
  raw.push(yOff);

  if (opts?.flags !== undefined) {
    raw.push(OtbmAttr.TileFlags);
    pushU32(raw, opts.flags);
  }

  if (opts?.groundItemId !== undefined) {
    raw.push(OtbmAttr.Item);
    pushU16(raw, opts.groundItemId);
  }

  const children: number[] = [];
  if (opts?.childItems) {
    for (const itemBytes of opts.childItems) {
      children.push(NODE_START, ...escapeBytes(itemBytes), NODE_END);
    }
  }

  return [NODE_START, ...escapeBytes(raw), ...children, NODE_END];
}

function buildItemBytes(itemId: number, attrs?: { count?: number; actionId?: number }): number[] {
  const raw: number[] = [];
  raw.push(OtbmNode.Item);
  pushU16(raw, itemId);

  if (attrs?.count !== undefined) {
    raw.push(OtbmAttr.Count);
    raw.push(attrs.count);
  }
  if (attrs?.actionId !== undefined) {
    raw.push(OtbmAttr.ActionId);
    pushU16(raw, attrs.actionId);
  }
  return raw;
}

function buildMapDataNode(children: number[]): number[] {
  const raw: number[] = [];
  raw.push(OtbmNode.MapData);
  return [NODE_START, ...escapeBytes(raw), ...children, NODE_END];
}

function buildOtbm(opts: {
  tileAreas?: number[];
  towns?: number[];
}): ArrayBuffer {
  const bytes: number[] = [];

  // 4-byte file identifier
  pushU32(bytes, 0);

  // Root node
  bytes.push(NODE_START);
  bytes.push(...buildRootData());

  // Map data node with tile areas
  const mapChildren = [...(opts.tileAreas ?? []), ...(opts.towns ?? [])];
  bytes.push(...buildMapDataNode(mapChildren));

  bytes.push(NODE_END); // root end

  return new Uint8Array(bytes).buffer;
}

describe('parseOtbm', () => {
  it('parses header', () => {
    const otbm = parseOtbm(buildOtbm({}));
    expect(otbm.header.version).toBe(2);
    expect(otbm.header.width).toBe(1024);
    expect(otbm.header.height).toBe(1024);
    expect(otbm.header.minorVersionItems).toBe(760);
  });

  it('parses a tile with ground item', () => {
    const tileArea = buildTileAreaNode(
      100, 200, 7,
      [...buildTileNode(5, 10, { groundItemId: 3050 })],
    );
    const otbm = parseOtbm(buildOtbm({ tileAreas: tileArea }));

    expect(otbm.tiles).toHaveLength(1);
    expect(otbm.tiles[0].position).toEqual({ x: 105, y: 210, z: 7 });
    expect(otbm.tiles[0].items).toHaveLength(1);
    expect(otbm.tiles[0].items[0].id).toBe(3050);
  });

  it('parses tile flags', () => {
    const tileArea = buildTileAreaNode(
      0, 0, 0,
      [...buildTileNode(0, 0, { flags: 0x04, groundItemId: 100 })],
    );
    const otbm = parseOtbm(buildOtbm({ tileAreas: tileArea }));
    expect(otbm.tiles[0].flags).toBe(0x04);
  });

  it('parses child item nodes on a tile', () => {
    const tileArea = buildTileAreaNode(
      50, 50, 7,
      [
        ...buildTileNode(0, 0, {
          groundItemId: 100,
          childItems: [
            buildItemBytes(200),
            buildItemBytes(300, { count: 5 }),
          ],
        }),
      ],
    );
    const otbm = parseOtbm(buildOtbm({ tileAreas: tileArea }));

    expect(otbm.tiles[0].items).toHaveLength(3); // ground + 2 child items
    expect(otbm.tiles[0].items[0].id).toBe(100); // ground
    expect(otbm.tiles[0].items[1].id).toBe(200);
    expect(otbm.tiles[0].items[2].id).toBe(300);
    expect(otbm.tiles[0].items[2].count).toBe(5);
  });

  it('parses multiple tiles in one area', () => {
    const tileArea = buildTileAreaNode(
      0, 0, 0,
      [
        ...buildTileNode(0, 0, { groundItemId: 100 }),
        ...buildTileNode(1, 0, { groundItemId: 101 }),
        ...buildTileNode(0, 1, { groundItemId: 102 }),
      ],
    );
    const otbm = parseOtbm(buildOtbm({ tileAreas: tileArea }));

    expect(otbm.tiles).toHaveLength(3);
    expect(otbm.tiles[0].position).toEqual({ x: 0, y: 0, z: 0 });
    expect(otbm.tiles[1].position).toEqual({ x: 1, y: 0, z: 0 });
    expect(otbm.tiles[2].position).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('parses multiple tile areas', () => {
    const area1 = buildTileAreaNode(0, 0, 0, [...buildTileNode(0, 0, { groundItemId: 100 })]);
    const area2 = buildTileAreaNode(256, 0, 0, [...buildTileNode(0, 0, { groundItemId: 200 })]);

    const otbm = parseOtbm(buildOtbm({ tileAreas: [...area1, ...area2] }));

    expect(otbm.tiles).toHaveLength(2);
    expect(otbm.tiles[0].position.x).toBe(0);
    expect(otbm.tiles[1].position.x).toBe(256);
  });

  it('handles empty map', () => {
    const otbm = parseOtbm(buildOtbm({}));
    expect(otbm.tiles).toHaveLength(0);
    expect(otbm.towns).toHaveLength(0);
  });

  it('parses item with action ID', () => {
    const tileArea = buildTileAreaNode(
      0, 0, 7,
      [
        ...buildTileNode(0, 0, {
          childItems: [buildItemBytes(500, { actionId: 1234 })],
        }),
      ],
    );
    const otbm = parseOtbm(buildOtbm({ tileAreas: tileArea }));
    expect(otbm.tiles[0].items[0].id).toBe(500);
    expect(otbm.tiles[0].items[0].actionId).toBe(1234);
  });
});

describe('parseOtbmRegion', () => {
  it('keeps tiles inside the radius', () => {
    const tileArea = buildTileAreaNode(
      100, 200, 7,
      [
        ...buildTileNode(5, 5, { groundItemId: 100 }),
        ...buildTileNode(10, 10, { groundItemId: 101 }),
      ],
    );

    const otbm = parseOtbmRegion(buildOtbm({ tileAreas: tileArea }), {
      centerX: 105,
      centerY: 205,
      radius: 5,
    });

    expect(otbm.tiles.map(tile => tile.position)).toEqual([
      { x: 105, y: 205, z: 7 },
      { x: 110, y: 210, z: 7 },
    ]);
  });

  it('drops tiles outside the radius', () => {
    const tileArea = buildTileAreaNode(
      100, 200, 7,
      [
        ...buildTileNode(5, 5, { groundItemId: 100 }),
        ...buildTileNode(50, 5, { groundItemId: 101 }),
      ],
    );

    const otbm = parseOtbmRegion(buildOtbm({ tileAreas: tileArea }), {
      centerX: 105,
      centerY: 205,
      radius: 10,
    });

    expect(otbm.tiles).toHaveLength(1);
    expect(otbm.tiles[0].position).toEqual({ x: 105, y: 205, z: 7 });
  });

  it('skips TileArea nodes outside the region bounds', () => {
    const nearbyArea = buildTileAreaNode(100, 200, 7, [...buildTileNode(0, 0, { groundItemId: 100 })]);
    const farArea = buildTileAreaNode(600, 200, 7, [...buildTileNode(0, 0, { groundItemId: 101 })]);

    const otbm = parseOtbmRegion(buildOtbm({ tileAreas: [...nearbyArea, ...farArea] }), {
      centerX: 110,
      centerY: 210,
      radius: 20,
    });

    expect(otbm.tiles).toHaveLength(1);
    expect(otbm.tiles[0].items[0].id).toBe(100);
  });

  it('filters by z when provided', () => {
    const z7Area = buildTileAreaNode(100, 200, 7, [...buildTileNode(5, 5, { groundItemId: 100 })]);
    const z8Area = buildTileAreaNode(100, 200, 8, [...buildTileNode(5, 5, { groundItemId: 101 })]);

    const otbm = parseOtbmRegion(buildOtbm({ tileAreas: [...z7Area, ...z8Area] }), {
      centerX: 105,
      centerY: 205,
      radius: 10,
      z: 8,
    });

    expect(otbm.tiles).toHaveLength(1);
    expect(otbm.tiles[0].position).toEqual({ x: 105, y: 205, z: 8 });
    expect(otbm.tiles[0].items[0].id).toBe(101);
  });
});
