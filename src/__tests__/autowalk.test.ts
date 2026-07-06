import { describe, expect, it } from 'vitest';
import { findWalkRoute, isWorldTileWalkable } from '../lib/jamera/autowalk';
import { buildAutoWalkPacket } from '../lib/net/7.6/movementProtocol';
import { DatAttr, type ThingType } from '../lib/dat';
import type { GameWorld } from '../lib/GameWorld';
import type { MapTile } from '../lib/net/common/types';

/**
 * World fixture: a small grid of described tiles around the player.
 * Item id 1 = plain ground, id 9 = a wall (NotWalkable in the dat).
 */
function makeWorld(
  grid: string[], // rows of '.', '#' (wall), ' ' (undescribed), 'M' (monster), 'S' (stair)
  px: number, py: number,
): { world: GameWorld; datIndex: Map<number, ThingType> } {
  const tiles = new Map<string, MapTile>();
  const creatures: Array<{ id: number; x: number; y: number; z: number }> = [];
  let nextId = 100;
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === ' ') return;
      const item = { id: ch === '#' ? 9 : ch === 'S' ? 5 : 1 };
      const tile: MapTile = { x, y, z: 7, things: [{ kind: 'item', item }], items: [item], creatures: [] };
      if (ch === 'M') {
        const id = nextId++;
        const creature = { id } as MapTile['creatures'][number];
        tile.things.push({ kind: 'creature', creature });
        tile.creatures.push(creature);
        creatures.push({ id, x, y, z: 7 });
      }
      tiles.set(`${x}:${y}:7`, tile);
    });
  });
  const world = {
    playerX: px, playerY: py, playerZ: 7, playerCreatureId: 1,
    getTile: (x: number, y: number, z: number) => tiles.get(`${x}:${y}:${z}`),
  } as unknown as GameWorld;

  const wall: ThingType = { id: 9, attrs: new Map([[DatAttr.NotWalkable, true]]) } as unknown as ThingType;
  const ground: ThingType = { id: 1, attrs: new Map() } as unknown as ThingType;
  // Real stairs flag NotWalkable in the .dat too — walkability must
  // bypass it only via the OTB floor-change knowledge.
  const stair: ThingType = { id: 5, attrs: new Map([[DatAttr.NotWalkable, true]]) } as unknown as ThingType;
  const datIndex = new Map<number, ThingType>([[1, ground], [9, wall], [5, stair]]);
  return { world, datIndex };
}

describe('isWorldTileWalkable', () => {
  it('blocks undescribed tiles, walls, and empty tiles; allows ground', () => {
    const { world, datIndex } = makeWorld(['.#', '. '], 0, 0);
    expect(isWorldTileWalkable(world, datIndex, 0, 0, 7)).toBe(true);
    expect(isWorldTileWalkable(world, datIndex, 1, 0, 7)).toBe(false); // wall
    expect(isWorldTileWalkable(world, datIndex, 1, 1, 7)).toBe(false); // undescribed
    expect(isWorldTileWalkable(world, datIndex, 5, 5, 7)).toBe(false); // off-map
  });
});

describe('findWalkRoute', () => {
  it('routes straight east over open ground', () => {
    const { world, datIndex } = makeWorld(['....'], 0, 0);
    expect(findWalkRoute(world, datIndex, 3, 0)).toEqual([1, 1, 1]); // E E E
  });

  it('routes around a wall', () => {
    const { world, datIndex } = makeWorld([
      '.#.',
      '...',
    ], 0, 0);
    // 0,0 → blocked east by wall → south, east, east, north to reach 2,0.
    expect(findWalkRoute(world, datIndex, 2, 0)).toEqual([2, 1, 1, 0]);
  });

  it('returns null for unreachable or unknown goals, [] when already there', () => {
    const { world, datIndex } = makeWorld([
      '.#.',
      ' # ',
    ], 0, 0);
    expect(findWalkRoute(world, datIndex, 2, 0)).toBeNull(); // walled off
    expect(findWalkRoute(world, datIndex, 9, 9)).toBeNull(); // unknown tile
    expect(findWalkRoute(world, datIndex, 0, 0)).toEqual([]);
  });

  it('paths around creatures but allows a creature on the goal tile', () => {
    const { world, datIndex } = makeWorld([
      '.M.',
      '...',
    ], 0, 0);
    // The rat at 1,0 blocks the direct route; goal 2,0 detours south.
    expect(findWalkRoute(world, datIndex, 2, 0)).toEqual([2, 1, 1, 0]);
    // Walking TO the rat's tile is allowed (server stops adjacent).
    expect(findWalkRoute(world, datIndex, 1, 0)).toEqual([1]);
  });
});

describe('buildAutoWalkPacket', () => {
  it('encodes 0x64 + count + server wire dirs (N=3 E=1 S=7 W=5)', () => {
    const bytes = [...buildAutoWalkPacket([0, 1, 2, 3]).toUint8Array()];
    expect(bytes).toEqual([0x64, 4, 3, 1, 7, 5]);
  });

  it('caps the route at the U8 count limit', () => {
    const route = Array.from({ length: 300 }, () => 1 as const);
    const bytes = [...buildAutoWalkPacket(route).toUint8Array()];
    expect(bytes[1]).toBe(255);
    expect(bytes.length).toBe(2 + 255);
  });
});

describe('floor-change tiles (stairs, holes)', () => {
  const FLOOR_CHANGE_IDS = new Set([5]);

  it('a stair is a valid goal despite its NotWalkable .dat flag', () => {
    const { world, datIndex } = makeWorld(['..S'], 0, 0);
    expect(findWalkRoute(world, datIndex, 2, 0)).toBeNull(); // regression shape
    expect(findWalkRoute(world, datIndex, 2, 0, FLOOR_CHANGE_IDS)).toEqual([1, 1]);
  });

  it('never routes THROUGH a stair to reach ground behind it', () => {
    // Detour south exists; the direct path through S must be refused.
    const { world, datIndex } = makeWorld(['.S.', '...'], 0, 0);
    const route = findWalkRoute(world, datIndex, 2, 0, FLOOR_CHANGE_IDS);
    expect(route).toEqual([2, 1, 1, 0]); // S E E N — around, not across
  });

  it('a boxed-in stair behind walls stays unreachable', () => {
    const { world, datIndex } = makeWorld(['.#S'], 0, 0);
    expect(findWalkRoute(world, datIndex, 2, 0, FLOOR_CHANGE_IDS)).toBeNull();
  });
});
