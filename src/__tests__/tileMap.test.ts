import { describe, it, expect } from 'vitest';
import { TileMap } from '../lib/tileMap';
import type { OtbmFile, OtbmTile } from '../lib/otbm';
import type { OtbFile } from '../lib/otb';

function makeOtb(mappings: [number, number][]): OtbFile {
  const serverToClient = new Map<number, number>();
  for (const [server, client] of mappings) {
    serverToClient.set(server, client);
  }
  return {
    version: { version: 0, majorVersion: 3, minorVersion: 760, buildNumber: 0, csdVersion: '' },
    items: [],
    serverToClient,
  };
}

function makeTile(x: number, y: number, z: number, serverItemIds: number[]): OtbmTile {
  return {
    position: { x, y, z },
    flags: 0,
    items: serverItemIds.map(id => ({ id })),
  };
}

function makeOtbm(tiles: OtbmTile[]): OtbmFile {
  return {
    header: { version: 2, width: 1024, height: 1024, majorVersionItems: 3, minorVersionItems: 760 },
    tiles,
    towns: [],
  };
}

describe('TileMap', () => {
  const otb = makeOtb([[100, 200], [101, 201], [102, 202]]);

  it('resolves server IDs to client IDs', () => {
    const tileMap = new TileMap(makeOtbm([makeTile(10, 20, 7, [100, 101])]), otb);
    const tile = tileMap.getTile(10, 20, 7);
    expect(tile).toBeDefined();
    expect(tile!.items).toEqual([
      { clientId: 200, count: undefined },
      { clientId: 201, count: undefined },
    ]);
  });

  it('skips items with unknown server IDs', () => {
    const tileMap = new TileMap(makeOtbm([makeTile(0, 0, 0, [100, 999])]), otb);
    const tile = tileMap.getTile(0, 0, 0);
    expect(tile!.items).toHaveLength(1);
    expect(tile!.items[0].clientId).toBe(200);
  });

  it('skips tiles with no resolvable items', () => {
    const tileMap = new TileMap(makeOtbm([makeTile(0, 0, 0, [999])]), otb);
    expect(tileMap.getTile(0, 0, 0)).toBeUndefined();
    expect(tileMap.size).toBe(0);
  });

  it('returns undefined for non-existent tiles', () => {
    const tileMap = new TileMap(makeOtbm([makeTile(5, 5, 7, [100])]), otb);
    expect(tileMap.getTile(0, 0, 0)).toBeUndefined();
    expect(tileMap.getTile(5, 5, 0)).toBeUndefined(); // wrong z
  });

  it('tracks bounding box', () => {
    const tileMap = new TileMap(
      makeOtbm([
        makeTile(10, 20, 7, [100]),
        makeTile(50, 80, 7, [101]),
      ]),
      otb,
    );
    const b = tileMap.getBounds(7)!;
    expect(b.minX).toBe(10);
    expect(b.minY).toBe(20);
    expect(b.maxX).toBe(50);
    expect(b.maxY).toBe(80);
  });

  it('iterates tiles in region', () => {
    const tileMap = new TileMap(
      makeOtbm([
        makeTile(0, 0, 7, [100]),
        makeTile(1, 0, 7, [101]),
        makeTile(2, 0, 7, [102]),
        makeTile(5, 5, 7, [100]), // outside region
      ]),
      otb,
    );
    const tiles = [...tileMap.tilesInRegion(0, 0, 2, 0, 7)];
    expect(tiles).toHaveLength(3);
    expect(tiles.map(t => t.x)).toEqual([0, 1, 2]);
  });

  it('reports correct size', () => {
    const tileMap = new TileMap(
      makeOtbm([
        makeTile(0, 0, 7, [100]),
        makeTile(1, 1, 7, [101]),
      ]),
      otb,
    );
    expect(tileMap.size).toBe(2);
  });

  describe('getBounds', () => {
    it('returns bounds for a populated z-level', () => {
      const tileMap = new TileMap(
        makeOtbm([makeTile(10, 20, 7, [100]), makeTile(50, 80, 7, [101])]),
        otb,
      );
      const b = tileMap.getBounds(7);
      expect(b).toEqual({ minX: 10, maxX: 50, minY: 20, maxY: 80 });
    });

    it('returns null for an empty z-level', () => {
      const tileMap = new TileMap(makeOtbm([makeTile(10, 20, 7, [100])]), otb);
      expect(tileMap.getBounds(6)).toBeNull();
    });
  });

  describe('merge', () => {
    it('adds new tiles from a second OTBM', () => {
      const tileMap = new TileMap(makeOtbm([makeTile(0, 0, 7, [100])]), otb);
      expect(tileMap.size).toBe(1);

      tileMap.merge(makeOtbm([makeTile(10, 10, 7, [101])]));
      expect(tileMap.size).toBe(2);
      expect(tileMap.getTile(10, 10, 7)).toBeDefined();
    });

    it('replaces existing tile on collision (new wins)', () => {
      const tileMap = new TileMap(makeOtbm([makeTile(5, 5, 7, [100])]), otb);
      expect(tileMap.getTile(5, 5, 7)!.items[0].clientId).toBe(200);

      tileMap.merge(makeOtbm([makeTile(5, 5, 7, [101])]));
      expect(tileMap.size).toBe(1);
      expect(tileMap.getTile(5, 5, 7)!.items[0].clientId).toBe(201);
    });

    it('is idempotent for identical content', () => {
      const tileMap = new TileMap(makeOtbm([makeTile(5, 5, 7, [100])]), otb);
      tileMap.merge(makeOtbm([makeTile(5, 5, 7, [100])]));
      expect(tileMap.size).toBe(1);
    });

    it('expands bounds after merge', () => {
      const tileMap = new TileMap(makeOtbm([makeTile(10, 10, 7, [100])]), otb);
      expect(tileMap.getBounds(7)!.maxX).toBe(10);

      tileMap.merge(makeOtbm([makeTile(50, 50, 7, [101])]));
      expect(tileMap.getBounds(7)!.maxX).toBe(50);
      expect(tileMap.getBounds(7)!.maxY).toBe(50);
    });
  });
});
