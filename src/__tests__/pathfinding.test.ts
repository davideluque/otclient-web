import { describe, it, expect } from 'vitest';
import { findPath, isTileWalkable } from '../lib/pathfinding';
import { TileMap } from '../lib/tileMap';
import { DatAttr } from '../lib/dat';
import type { OtbmFile, OtbmTile } from '../lib/otbm';
import type { OtbFile } from '../lib/otb';
import type { ThingType } from '../lib/dat';
import { ThingCategory } from '../lib/dat';

function makeOtb(mappings: [number, number][]): OtbFile {
  return {
    version: { version: 0, majorVersion: 3, minorVersion: 760, buildNumber: 0, csdVersion: '' },
    items: [],
    serverToClient: new Map(mappings),
    serverIdToFlags: new Map(),
  };
}

function makeTile(x: number, y: number, z: number, serverIds: number[]): OtbmTile {
  return { position: { x, y, z }, flags: 0, items: serverIds.map(id => ({ id })) };
}

function makeOtbm(tiles: OtbmTile[]): OtbmFile {
  return {
    header: { version: 2, width: 1024, height: 1024, majorVersionItems: 3, minorVersionItems: 760 },
    tiles,
    towns: [],
  };
}

function makeDatItem(clientId: number, walkable = true): ThingType {
  const attrs = new Map<number, boolean | number>();
  if (!walkable) attrs.set(DatAttr.NotWalkable, true);
  return {
    id: clientId,
    category: ThingCategory.Item,
    attrs,
    frameGroup: { width: 1, height: 1, exactSize: 32, layers: 1, numPatternX: 1, numPatternY: 1, numPatternZ: 1, animationPhases: 1, spriteIds: [1] },
  };
}

function buildDatIndex(items: ThingType[]): Map<number, ThingType> {
  return new Map(items.map(i => [i.id, i]));
}

describe('isTileWalkable', () => {
  const otb = makeOtb([[1, 100], [2, 200]]);
  const ground = makeDatItem(100);
  const wall = makeDatItem(200, false);
  const datIndex = buildDatIndex([ground, wall]);

  it('returns true for walkable tiles', () => {
    const tileMap = new TileMap(makeOtbm([makeTile(0, 0, 7, [1])]), otb);
    expect(isTileWalkable(0, 0, 7, tileMap, datIndex)).toBe(true);
  });

  it('returns false for tiles with NotWalkable items', () => {
    const tileMap = new TileMap(makeOtbm([makeTile(0, 0, 7, [1, 2])]), otb);
    expect(isTileWalkable(0, 0, 7, tileMap, datIndex)).toBe(false);
  });

  it('returns false for non-existent tiles', () => {
    const tileMap = new TileMap(makeOtbm([]), otb);
    expect(isTileWalkable(0, 0, 7, tileMap, datIndex)).toBe(false);
  });
});

describe('findPath', () => {
  // Create a 5x5 grid of walkable tiles
  const otb = makeOtb([[1, 100]]);
  const ground = makeDatItem(100);
  const datIndex = buildDatIndex([ground]);

  function makeGrid(width: number, height: number, z = 7, blocked: Set<string> = new Set()): TileMap {
    const tiles: OtbmTile[] = [];
    const wallOtb = makeOtb([[1, 100], [2, 200]]);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (blocked.has(`${x}:${y}`)) {
          tiles.push(makeTile(x, y, z, [1, 2])); // ground + wall
        } else {
          tiles.push(makeTile(x, y, z, [1])); // ground only
        }
      }
    }

    return new TileMap(makeOtbm(tiles), blocked.size > 0 ? wallOtb : otb);
  }

  it('returns empty path when start equals goal', () => {
    const tileMap = makeGrid(5, 5);
    const path = findPath(2, 2, 2, 2, 7, tileMap, datIndex);
    expect(path).toEqual([]);
  });

  it('finds straight path', () => {
    const tileMap = makeGrid(5, 5);
    const path = findPath(0, 0, 3, 0, 7, tileMap, datIndex);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3);
    expect(path![0]).toEqual({ x: 1, y: 0 });
    expect(path![2]).toEqual({ x: 3, y: 0 });
  });

  it('finds path around obstacle', () => {
    const blocked = new Set(['2:0', '2:1']);
    const tileMap = makeGrid(5, 5, 7, blocked);
    const wallDatIndex = buildDatIndex([ground, makeDatItem(200, false)]);

    const path = findPath(0, 0, 4, 0, 7, tileMap, wallDatIndex);
    expect(path).not.toBeNull();
    // Path should go around the blocked tiles
    expect(path!.some(n => n.x === 2 && n.y === 0)).toBe(false);
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 0 });
  });

  it('returns null when goal is not walkable', () => {
    const blocked = new Set(['3:3']);
    const tileMap = makeGrid(5, 5, 7, blocked);
    const wallDatIndex = buildDatIndex([ground, makeDatItem(200, false)]);

    const path = findPath(0, 0, 3, 3, 7, tileMap, wallDatIndex);
    expect(path).toBeNull();
  });

  it('returns null when no path exists (surrounded)', () => {
    // Block all neighbors of (2,2)
    const blocked = new Set(['1:2', '3:2', '2:1', '2:3']);
    const tileMap = makeGrid(5, 5, 7, blocked);
    const wallDatIndex = buildDatIndex([ground, makeDatItem(200, false)]);

    const path = findPath(2, 2, 0, 0, 7, tileMap, wallDatIndex);
    expect(path).toBeNull();
  });

  it('returns adjacent step for neighbor tile', () => {
    const tileMap = makeGrid(5, 5);
    const path = findPath(2, 2, 3, 2, 7, tileMap, datIndex);
    expect(path).toEqual([{ x: 3, y: 2 }]);
  });
});
