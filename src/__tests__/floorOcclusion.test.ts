import { describe, it, expect } from 'vitest';
import { buildOcclusionSets } from '../lib/render/floorOcclusion';
import type { FloorTileSource } from '../lib/render/floorVisibility';
import { DatAttr, ThingCategory } from '../lib/dat';
import type { ThingType } from '../lib/dat';
import type { MapTile } from '../lib/net/common/types';
import { tilePositionKey } from '../constants';

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

const FULL_GROUND = 100; // solid dirt/rock — occludes
const GROUND = 200;      // walkable ground without FullGround — never occludes

const datIndex = new Map<number, ThingType>([
  [FULL_GROUND, makeDatItem(FULL_GROUND, [DatAttr.Ground, DatAttr.FullGround])],
  [GROUND, makeDatItem(GROUND, [DatAttr.Ground])],
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

describe('buildOcclusionSets', () => {
  it('a FullGround position cascades onto every deeper floor', () => {
    const source = makeSource([tile(5, 5, 7, [FULL_GROUND])]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8, 9]);

    expect(sets.get(7)).toEqual(new Set());
    expect(sets.get(8)).toEqual(new Set([tilePositionKey(5, 5)]));
    expect(sets.get(9)).toEqual(new Set([tilePositionKey(5, 5)]));
  });

  it('never occludes shallower floors — snapshot precedes own contributions', () => {
    // FullGround only at depth z=8: z=7 (shallower) and z=8 itself must
    // stay clear; only z=9 is covered (design-doc lesson e66e78c).
    const source = makeSource([tile(5, 5, 8, [FULL_GROUND])]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8, 9]);

    expect(sets.get(7)).toEqual(new Set());
    expect(sets.get(8)).toEqual(new Set());
    expect(sets.get(9)).toEqual(new Set([tilePositionKey(5, 5)]));
  });

  it('accumulates contributions from every shallower floor', () => {
    const source = makeSource([
      tile(1, 1, 7, [FULL_GROUND]),
      tile(2, 2, 8, [FULL_GROUND]),
    ]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8, 9]);

    expect(sets.get(8)).toEqual(new Set([tilePositionKey(1, 1)]));
    expect(sets.get(9)).toEqual(new Set([tilePositionKey(1, 1), tilePositionKey(2, 2)]));
  });

  it('ignores plain Ground — only FullGround occludes', () => {
    const source = makeSource([tile(5, 5, 7, [GROUND])]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8]);

    expect(sets.get(8)).toEqual(new Set());
  });

  it('finds FullGround anywhere in the item stack', () => {
    const source = makeSource([tile(5, 5, 7, [GROUND, FULL_GROUND])]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8]);

    expect(sets.get(8)).toEqual(new Set([tilePositionKey(5, 5)]));
  });

  it('ignores tiles outside the region bounds', () => {
    const source = makeSource([tile(20, 20, 7, [FULL_GROUND])]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8]);

    expect(sets.get(8)).toEqual(new Set());
  });

  it('uses tile position keys for renderTileRegion skipPositions', () => {
    const source = makeSource([tile(3, 9, 7, [FULL_GROUND])]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8]);

    expect([...sets.get(8)!]).toEqual([tilePositionKey(3, 9)]);
    expect([...sets.get(8)!]).toEqual([196617]);
  });
});
