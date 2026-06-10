import { describe, it, expect } from 'vitest';
import { GameWorld } from '../lib/GameWorld';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import type { MapTile } from '../lib/net/common/types';

/**
 * Drive GameWorld's internal tile map directly so we exercise
 * `tilesInRegion` (the `TileSource` adapter feeding renderTileRegion)
 * without crafting wire packets. The mapping is the surface under
 * test: MapTile (wire shape) → ResolvedTile (renderer shape).
 */
function seed(world: GameWorld, tile: MapTile): void {
  // @ts-expect-error reaching into private state for the test
  world.tiles.set(`${tile.x}:${tile.y}:${tile.z}`, tile);
}

function mkTile(x: number, y: number, z: number, itemIds: number[]): MapTile {
  return {
    x, y, z,
    items: itemIds.map((id) => ({ id })),
    creatures: [],
  };
}

describe('GameWorld.tilesInRegion', () => {
  it('yields tiles whose positions fall inside the inclusive bounds', () => {
    const world = new GameWorld(new GameProtocol());
    seed(world, mkTile(10, 10, 7, [100]));
    seed(world, mkTile(11, 10, 7, [101]));
    seed(world, mkTile(15, 15, 7, [102])); // outside the queried region

    const tiles = [...world.tilesInRegion(10, 10, 12, 12, 7)];
    expect(tiles.map((t) => `${t.x}:${t.y}`).sort()).toEqual(['10:10', '11:10']);
  });

  it('yields row-major (y outer), matching TileMap painter order for 2.5D stacking', () => {
    const world = new GameWorld(new GameProtocol());
    seed(world, mkTile(2, 2, 7, [100]));
    seed(world, mkTile(1, 2, 7, [101]));
    seed(world, mkTile(2, 1, 7, [102]));
    seed(world, mkTile(1, 1, 7, [103]));

    const order = [...world.tilesInRegion(1, 1, 2, 2, 7)].map((t) => `${t.x}:${t.y}`);
    expect(order).toEqual(['1:1', '2:1', '1:2', '2:2']);
  });

  it('bumps tileRevision on tile ingestion but not on creature-only changes', () => {
    const world = new GameWorld(new GameProtocol());
    const before = world.tileRevision;

    // @ts-expect-error driving the private tile path for the test
    world.setTile(mkTile(1, 1, 7, [100]));
    expect(world.tileRevision).toBe(before + 1);

    // Creature registry mutations don't touch tiles.
    // @ts-expect-error driving private state
    world.creatures.set(42, { id: 42, name: 'rat', x: 1, y: 1, z: 7 });
    expect(world.tileRevision).toBe(before + 1);
  });

  it('skips tiles on a different floor', () => {
    const world = new GameWorld(new GameProtocol());
    seed(world, mkTile(5, 5, 7, [100]));
    seed(world, mkTile(5, 5, 6, [101]));

    const tiles = [...world.tilesInRegion(0, 0, 10, 10, 7)];
    expect(tiles).toHaveLength(1);
    expect(tiles[0].z).toBe(7);
  });

  it('maps MapTileItem.id → ResolvedItem.clientId and preserves count', () => {
    const world = new GameWorld(new GameProtocol());
    // @ts-expect-error driving private state
    world.tiles.set('1:1:7', {
      x: 1, y: 1, z: 7,
      items: [
        { id: 100 },
        { id: 200, count: 5 },
      ],
      creatures: [],
    });

    const [tile] = [...world.tilesInRegion(1, 1, 1, 1, 7)];
    expect(tile.items).toEqual([
      { clientId: 100, count: undefined },
      { clientId: 200, count: 5 },
    ]);
  });

  it('synthesises ResolvedTile.flags = 0 (wire format carries no tile flags)', () => {
    const world = new GameWorld(new GameProtocol());
    seed(world, mkTile(3, 3, 7, [100]));

    const [tile] = [...world.tilesInRegion(3, 3, 3, 3, 7)];
    expect(tile.flags).toBe(0);
  });

  it('yields nothing when the region contains no live tiles', () => {
    const world = new GameWorld(new GameProtocol());
    expect([...world.tilesInRegion(0, 0, 100, 100, 7)]).toEqual([]);
  });
});
