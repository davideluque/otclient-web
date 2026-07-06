import { describe, it, expect } from 'vitest';
import {
  drawRange, calcFirstVisibleFloor, firstVisibleFloorForGlide,
} from '../lib/render/floorVisibility';
import type { FloorTileSource } from '../lib/render/floorVisibility';
import { DatAttr, ThingCategory } from '../lib/dat';
import type { ThingType } from '../lib/dat';
import type { MapTile, MapCreature } from '../lib/net/common/types';

function makeDatItem(clientId: number, attrIds: number[]): ThingType {
  return {
    id: clientId,
    category: ThingCategory.Item,
    attrs: new Map(attrIds.map((a) => [a, true])),
    frameGroup: {
      width: 1, height: 1, exactSize: 32, layers: 1,
      numPatternX: 1, numPatternY: 1, numPatternZ: 1,
      animationPhases: 1, spriteIds: [1],
    },
  };
}

const GROUND = 100;          // plain walkable ground
const ROOF = 200;            // Ground — always covers
const DECOR = 300;           // no flags — never covers
const ARCH = 400;            // OnBottom only — covers only under freeView
const SOLID_ARCH = 500;      // OnBottom + BlockProjectile — always covers
const SHY_ROOF = 600;        // Ground + DontHide — never covers
const WALL = 700;            // BlockProjectile — blocks sight, doesn't roof

const datIndex = new Map<number, ThingType>([
  [GROUND, makeDatItem(GROUND, [DatAttr.Ground])],
  [ROOF, makeDatItem(ROOF, [DatAttr.Ground])],
  [DECOR, makeDatItem(DECOR, [])],
  [ARCH, makeDatItem(ARCH, [DatAttr.OnBottom])],
  [SOLID_ARCH, makeDatItem(SOLID_ARCH, [DatAttr.OnBottom, DatAttr.BlockProjectile])],
  [SHY_ROOF, makeDatItem(SHY_ROOF, [DatAttr.Ground, DatAttr.DontHide])],
  [WALL, makeDatItem(WALL, [DatAttr.BlockProjectile])],
]);

function tile(x: number, y: number, z: number, itemIds: number[]): MapTile {
  const items = itemIds.map((id) => ({ id }));
  return {
    x, y, z,
    things: items.map((item) => ({ kind: 'item' as const, item })),
    items,
    creatures: [],
  };
}

function makeSource(tiles: MapTile[]): FloorTileSource {
  const map = new Map(tiles.map((t) => [`${t.x}:${t.y}:${t.z}`, t]));
  return { getTile: (x, y, z) => map.get(`${x}:${y}:${z}`) };
}

describe('drawRange', () => {
  it('above ground spans the whole surface stack 0..7', () => {
    expect(drawRange(7)).toEqual({ base: 0, last: 7 });
    expect(drawRange(3)).toEqual({ base: 0, last: 7 });
    expect(drawRange(0)).toEqual({ base: 0, last: 7 });
  });

  it('underground spans z−2..z+2', () => {
    expect(drawRange(12)).toEqual({ base: 10, last: 14 });
  });

  it('clamps the base to 8 just below the surface (z=8, z=9)', () => {
    expect(drawRange(8)).toEqual({ base: 8, last: 10 });
    expect(drawRange(9)).toEqual({ base: 8, last: 11 });
  });

  it('clamps the last floor to 15 at the bottom of the map', () => {
    expect(drawRange(14)).toEqual({ base: 12, last: 15 });
    expect(drawRange(15)).toEqual({ base: 13, last: 15 });
  });
});

describe('calcFirstVisibleFloor', () => {
  it('returns 0 when nothing is overhead all the way up', () => {
    const source = makeSource([tile(10, 10, 7, [GROUND])]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(0);
  });

  it('returns 0 when the camera is already on z=0 (no floors above)', () => {
    const source = makeSource([tile(0, 0, 0, [GROUND])]);
    expect(calcFirstVisibleFloor(source, datIndex, 0, 0, 0)).toBe(0);
  });

  it('returns roofZ+1 when a roof sits directly above the camera', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(10, 10, 6, [ROOF]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(7);
  });

  it('picks the deepest roof when buildings stack — the lower roof wins', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(10, 10, 6, [ROOF]),
      tile(10, 10, 4, [ROOF]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(7);
  });

  it('returns the floor just under a higher-up roof when no closer cover exists', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(10, 10, 4, [ROOF]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(5);
  });

  it('detects cover above a look-possible orthogonal neighbor', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(11, 10, 7, [GROUND]),
      tile(11, 10, 6, [ROOF]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(7);
  });

  it('skips a neighbor whose tile blocks sight (wall next door)', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(11, 10, 7, [GROUND, WALL]),
      tile(11, 10, 6, [ROOF]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(0);
  });

  it('skips a neighbor with no tile at all (void next door)', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(11, 10, 6, [ROOF]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(0);
  });

  it('never probes diagonal neighbors', () => {
    // NW diagonal — the SE one is inherently reachable through the
    // camera's own perspective chain, so it can't distinguish anything.
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(10, 9, 7, [GROUND]),
      tile(11, 10, 7, [GROUND]),
      tile(10, 11, 7, [GROUND]),
      tile(9, 10, 7, [GROUND]),
      tile(9, 9, 7, [GROUND]),
      tile(9, 9, 6, [ROOF]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(0);
  });

  it('detects cover on the perspective diagonal chain (+1,+1,−1)', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(11, 11, 6, [ROOF]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(7);
  });

  it('ignores overhead items with no covering flags', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(10, 10, 6, [DECOR]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(0);
  });

  it('ignores DontHide roofs', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(10, 10, 6, [SHY_ROOF]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(0);
  });

  it('never lets a creature at the top of the stack cover', () => {
    const rat: MapCreature = {
      id: 1, name: 'rat', health: 100, direction: 0,
      outfit: { lookType: 21, head: 0, body: 0, legs: 0, feet: 0 },
      lightLevel: 0, lightColor: 0, speed: 200,
    };
    const overhead = tile(10, 10, 6, [ROOF]);
    overhead.things.unshift({ kind: 'creature', creature: rat });
    overhead.creatures = [rat];
    const source = makeSource([tile(10, 10, 7, [GROUND]), overhead]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(0);
  });

  it('OnBottom-only cover needs freeView — not granted above a look-possible tile', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(10, 10, 6, [ARCH]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(0);
  });

  it('OnBottom + BlockProjectile covers even without freeView', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(10, 10, 6, [SOLID_ARCH]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(7);
  });

  it('OnBottom-only covers above a sight-blocked camera tile (freeView flips)', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND, WALL]),
      tile(10, 10, 6, [ARCH]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 7)).toBe(7);
  });

  it('underground never probes above the aware base', () => {
    const source = makeSource([
      tile(10, 10, 10, [GROUND]),
      tile(10, 10, 7, [ROOF]), // above base=8 — out of the draw window
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 10)).toBe(8);
  });

  it('underground cover still raises the first floor within the window', () => {
    const source = makeSource([
      tile(10, 10, 10, [GROUND]),
      tile(10, 10, 9, [ROOF]),
    ]);
    expect(calcFirstVisibleFloor(source, datIndex, 10, 10, 10)).toBe(10);
  });
});

describe('firstVisibleFloorForGlide', () => {
  it('takes the more-covered endpoint while stepping through a doorway', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]), // outside — open sky
      tile(11, 10, 7, [GROUND]), // inside
      tile(11, 10, 6, [ROOF]),
    ]);
    // The indoor endpoint sees the roof; the glide must too, both ways.
    expect(firstVisibleFloorForGlide(source, datIndex, 10, 10, 11, 10, 7)).toBe(7);
    expect(firstVisibleFloorForGlide(source, datIndex, 11, 10, 10, 10, 7)).toBe(7);
  });

  it('stays open when both endpoints are under open sky', () => {
    const source = makeSource([
      tile(10, 10, 7, [GROUND]),
      tile(11, 10, 7, [GROUND]),
    ]);
    expect(firstVisibleFloorForGlide(source, datIndex, 10, 10, 11, 10, 7)).toBe(0);
  });
});
