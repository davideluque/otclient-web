import { describe, it, expect } from 'vitest';
import { calcFirstVisibleFloor } from '../lib/render/floorVisibility';
import { TileMap } from '../lib/tileMap';
import { DatAttr, ThingCategory } from '../lib/dat';
import type { ThingType } from '../lib/dat';
import type { OtbmFile, OtbmTile } from '../lib/otbm';
import type { OtbFile } from '../lib/otb';

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

function makeDatItem(clientId: number, isFullGround = false): ThingType {
  const attrs = new Map<number, boolean | number>();
  if (isFullGround) attrs.set(DatAttr.FullGround, true);
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

// server id 1 → client 100 (plain ground), server id 2 → client 200 (roof)
const otb = makeOtb([[1, 100], [2, 200]]);
const ground = makeDatItem(100, false);
const roof = makeDatItem(200, true);
const datIndex = buildDatIndex([ground, roof]);

describe('calcFirstVisibleFloor', () => {
  it('returns 0 when nothing is overhead all the way up', () => {
    const tileMap = new TileMap(makeOtbm([
      makeTile(10, 10, 7, [1]), // player tile only — no roofs above
    ]), otb);
    expect(calcFirstVisibleFloor(10, 10, 7, tileMap, datIndex)).toBe(0);
  });

  it('returns 0 when the player is already on z=0 (no floors above)', () => {
    const tileMap = new TileMap(makeOtbm([makeTile(0, 0, 0, [1])]), otb);
    expect(calcFirstVisibleFloor(0, 0, 0, tileMap, datIndex)).toBe(0);
  });

  it('returns roofZ+1 when a roof tile sits directly above the player', () => {
    // Player on z=7, roof tile on z=6 at the player's x/y.
    const tileMap = new TileMap(makeOtbm([
      makeTile(10, 10, 7, [1]),
      makeTile(10, 10, 6, [2]),
    ]), otb);
    expect(calcFirstVisibleFloor(10, 10, 7, tileMap, datIndex)).toBe(7);
  });

  it('picks the deepest roof when buildings stack — the lower roof wins', () => {
    // Two roofs above: one at z=6, one at z=4. Player on z=7. The z=6
    // roof should cut off visibility first since the scan stops at the
    // closest cover.
    const tileMap = new TileMap(makeOtbm([
      makeTile(10, 10, 7, [1]),
      makeTile(10, 10, 6, [2]),
      makeTile(10, 10, 4, [2]),
    ]), otb);
    expect(calcFirstVisibleFloor(10, 10, 7, tileMap, datIndex)).toBe(7);
  });

  it('detects a roof in the 3x3 window even when not directly overhead', () => {
    // Roof at (11, 10, 6) — one step east of the player. Player is at
    // (10, 10, 7). The 3x3 scan should still register cover.
    const tileMap = new TileMap(makeOtbm([
      makeTile(10, 10, 7, [1]),
      makeTile(11, 10, 6, [2]),
    ]), otb);
    expect(calcFirstVisibleFloor(10, 10, 7, tileMap, datIndex)).toBe(7);
  });

  it('does not register cover for roofs more than 1 tile away in the same floor', () => {
    // Roof at (13, 10, 6) — 3 tiles east of player, outside the 3x3 window.
    const tileMap = new TileMap(makeOtbm([
      makeTile(10, 10, 7, [1]),
      makeTile(13, 10, 6, [2]),
    ]), otb);
    expect(calcFirstVisibleFloor(10, 10, 7, tileMap, datIndex)).toBe(0);
  });

  it('returns the floor just under a higher-up roof when no closer cover exists', () => {
    // No roof at z=6, but roof at z=4. Floors 5 and 6 are still visible.
    const tileMap = new TileMap(makeOtbm([
      makeTile(10, 10, 7, [1]),
      makeTile(10, 10, 4, [2]),
    ]), otb);
    expect(calcFirstVisibleFloor(10, 10, 7, tileMap, datIndex)).toBe(5);
  });

  it('ignores non-FullGround items overhead', () => {
    // A plain (non-FullGround) item directly above shouldn't count as a roof.
    const tileMap = new TileMap(makeOtbm([
      makeTile(10, 10, 7, [1]),
      makeTile(10, 10, 6, [1]), // ground tile, not roof
    ]), otb);
    expect(calcFirstVisibleFloor(10, 10, 7, tileMap, datIndex)).toBe(0);
  });
});
