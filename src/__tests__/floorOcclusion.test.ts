import { describe, it, expect } from 'vitest';
import { buildOcclusionSets } from '../lib/render/floorOcclusion';
import type { FloorTileSource } from '../lib/render/floorVisibility';
import { DatAttr, ThingCategory } from '../lib/dat';
import type { ThingType } from '../lib/dat';
import type { MapTile } from '../lib/net/common/types';
import { tilePositionKey } from '../constants';

function makeDatItem(clientId: number, attrIds: number[], dims?: { w: number; h: number }): ThingType {
  return {
    id: clientId,
    category: ThingCategory.Item,
    attrs: new Map(attrIds.map((a) => [a, true])),
    frameGroup: {
      width: dims?.w ?? 1, height: dims?.h ?? 1, exactSize: 32, layers: 1,
      numPatternX: 1, numPatternY: 1, numPatternZ: 1,
      animationPhases: 1, spriteIds: [1],
    },
  };
}

const FULL_GROUND = 100; // solid dirt/rock — occludes
const GROUND = 200;      // walkable ground without FullGround — never occludes
const STAIRS_2X2 = 300;  // a 64×64 sprite leaning one tile up-left of its anchor

const datIndex = new Map<number, ThingType>([
  [FULL_GROUND, makeDatItem(FULL_GROUND, [DatAttr.Ground, DatAttr.FullGround])],
  [GROUND, makeDatItem(GROUND, [DatAttr.Ground])],
  [STAIRS_2X2, makeDatItem(STAIRS_2X2, [], { w: 2, h: 2 })],
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

// The region window (x1..y2) is in screen cells = camera-floor world
// coordinates. A tile on floor z occupies screen cell
// (x + (z − camZ), y + (z − camZ)) — the classic perspective shift.
const CAM_Z = 7;

describe('buildOcclusionSets', () => {
  it('covers the deeper tile one north-west per level — the same screen cell', () => {
    // FullGround at screen (5,5). Floor 8 world (4,4) and floor 9 world
    // (3,3) render at that same screen cell and are hidden behind it.
    const source = makeSource([
      tile(5, 5, 7, [FULL_GROUND]),
      tile(4, 4, 8, [GROUND]),
      tile(3, 3, 9, [GROUND]),
    ]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8, 9], CAM_Z);

    expect(sets.get(7)).toEqual(new Set());
    expect(sets.get(8)).toEqual(new Set([tilePositionKey(4, 4)]));
    expect(sets.get(9)).toEqual(new Set([tilePositionKey(3, 3)]));
  });

  it('does NOT cover the deeper tile at the same world (x, y)', () => {
    // The stairwell case: the up-stairs sit at the hole world position one
    // floor down. They render one screen cell south-east of the covering
    // floor's (5,5) — visible, never skipped.
    const source = makeSource([
      tile(5, 5, 7, [FULL_GROUND]),
      tile(5, 5, 8, [GROUND]),
    ]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8], CAM_Z);

    expect(sets.get(8)).toEqual(new Set());
  });

  it('never occludes shallower floors — snapshot precedes own contributions', () => {
    // FullGround only at depth z=8: z=7 (shallower) and z=8 itself must
    // stay clear; only z=9 is covered (design-doc lesson e66e78c).
    const source = makeSource([
      tile(5, 5, 7, [GROUND]),
      tile(5, 5, 8, [FULL_GROUND]),
      tile(4, 4, 9, [GROUND]),
    ]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8, 9], CAM_Z);

    expect(sets.get(7)).toEqual(new Set());
    expect(sets.get(8)).toEqual(new Set());
    // z=8's FullGround occupies screen (6,6); floor 9 world (4,4) sits at
    // screen (6,6) and is covered.
    expect(sets.get(9)).toEqual(new Set([tilePositionKey(4, 4)]));
  });

  it('accumulates contributions from every shallower floor', () => {
    // Screen cells covered: (5,5) by floor 7, (6,6) by floor 8.
    const source = makeSource([
      tile(5, 5, 7, [FULL_GROUND]),
      tile(5, 5, 8, [FULL_GROUND]), // screen (6,6)
      tile(4, 4, 8, [GROUND]),      // screen (5,5) — covered by floor 7
      tile(3, 3, 9, [GROUND]),      // screen (5,5)
      tile(4, 4, 9, [GROUND]),      // screen (6,6)
    ]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8, 9], CAM_Z);

    expect(sets.get(8)).toEqual(new Set([tilePositionKey(4, 4)]));
    expect(sets.get(9)).toEqual(new Set([tilePositionKey(3, 3), tilePositionKey(4, 4)]));
  });

  it('ignores plain Ground — only FullGround occludes', () => {
    const source = makeSource([
      tile(5, 5, 7, [GROUND]),
      tile(4, 4, 8, [GROUND]),
    ]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8], CAM_Z);

    expect(sets.get(8)).toEqual(new Set());
  });

  it('finds FullGround anywhere in the item stack', () => {
    const source = makeSource([
      tile(5, 5, 7, [GROUND, FULL_GROUND]),
      tile(4, 4, 8, [GROUND]),
    ]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8], CAM_Z);

    expect(sets.get(8)).toEqual(new Set([tilePositionKey(4, 4)]));
  });

  it('ignores tiles outside the region bounds', () => {
    const source = makeSource([
      tile(20, 20, 7, [FULL_GROUND]),
      tile(19, 19, 8, [GROUND]),
    ]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8], CAM_Z);

    expect(sets.get(8)).toEqual(new Set());
  });

  it('keeps a big sprite visible while any screen cell it touches peeks through', () => {
    // A 2×2 stairs sprite anchored at floor-8 world (4,4) paints screen
    // cells (5,5) (4,5) (5,4) (4,4). With a hole (no FullGround) at
    // screen (4,4), the sprite's up-left bulk shows through — the tile
    // must not be skip-listed even though its anchor cell is covered.
    const source = makeSource([
      tile(5, 5, 7, [FULL_GROUND]),
      tile(4, 5, 7, [FULL_GROUND]),
      tile(5, 4, 7, [FULL_GROUND]),
      tile(4, 4, 7, [GROUND]), // the hole
      tile(4, 4, 8, [GROUND, STAIRS_2X2]),
    ]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8], CAM_Z);

    expect(sets.get(8)).toEqual(new Set());
  });

  it('skips a big sprite only when every screen cell it touches is covered', () => {
    const source = makeSource([
      tile(5, 5, 7, [FULL_GROUND]),
      tile(4, 5, 7, [FULL_GROUND]),
      tile(5, 4, 7, [FULL_GROUND]),
      tile(4, 4, 7, [FULL_GROUND]),
      tile(4, 4, 8, [GROUND, STAIRS_2X2]),
    ]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8], CAM_Z);

    expect(sets.get(8)).toEqual(new Set([tilePositionKey(4, 4)]));
  });

  it('uses tile position keys for renderTileRegion skipPositions', () => {
    const source = makeSource([
      tile(3, 9, 7, [FULL_GROUND]),
      tile(2, 8, 8, [GROUND]),
    ]);

    const sets = buildOcclusionSets(source, datIndex, 0, 0, 10, 10, [7, 8], CAM_Z);

    expect([...sets.get(8)!]).toEqual([tilePositionKey(2, 8)]);
  });
});
