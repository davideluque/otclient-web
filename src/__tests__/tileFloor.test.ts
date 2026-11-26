// @vitest-environment happy-dom
import { Container, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { tilePositionKey } from '../constants';
import { ThingCategory, type ThingType } from '../lib/dat';
import { creatureDrawOrder, TileFloor } from '../lib/render/tileFloor';
import type { ResolvedTile } from '../lib/tileMap';
import type { AnimatedSprite } from '../lib/tileRenderer';

const torch: ThingType = {
  id: 100, category: ThingCategory.Item, attrs: new Map(),
  frameGroup: {
    width: 1, height: 1, exactSize: 32, layers: 1, numPatternX: 1,
    numPatternY: 1, numPatternZ: 1, animationPhases: 2, spriteIds: [1, 2],
  },
};
const types = new Map([[100, torch], [101, { ...torch, id: 101 }]]);
function tile(x: number, y: number, ids = [100]): ResolvedTile {
  return { x, y, z: 7, flags: 0, items: ids.map(clientId => ({ clientId })) };
}
function region(left: number): ResolvedTile[] {
  return Array.from({ length: 600 }, (_, n) => tile(left + n % 30, Math.floor(n / 30)));
}

describe('TileFloor', () => {
  it('reuses the overlapping sprites and animation frames when a 600-tile view pans', () => {
    const getTexture = vi.fn(() => Texture.WHITE);
    const animated = new Set<AnimatedSprite>();
    const floor = new TileFloor(types, getTexture, animated);
    floor.update(region(0));
    const [leaving, retained] = floor.container.children;
    const phases = [...animated][1];
    getTexture.mockClear();
    floor.update(region(1));
    expect(floor.container.children).toHaveLength(600);
    expect(leaving.destroyed).toBe(true);
    expect(floor.container.children).toContain(retained);
    // One phase-zero lookup + the two animation frames per new tile.
    expect(getTexture).toHaveBeenCalledTimes(20 * 3);
    expect(animated.size).toBe(600);
    expect(animated.has(phases)).toBe(true);
    floor.destroy();
    expect(animated.size).toBe(0);
  });

  it('seeds entering animations with the same phase as retained tiles', () => {
    const animated = new Set<AnimatedSprite>();
    const sparseTorch = { ...torch, frameGroup: { ...torch.frameGroup, animationPhases: 3, spriteIds: [1, 2, 0] } };
    const floor = new TileFloor(
      new Map([[100, sparseTorch]]), id => id === 1 ? Texture.WHITE : Texture.EMPTY, animated,
    );
    floor.update([tile(1, 1)], undefined, 1);
    const [retained] = animated;
    floor.update([tile(1, 1), tile(2, 1)], undefined, 2);
    expect(animated.has(retained)).toBe(true);
    expect([...animated].map(item => item.sprite.texture)).toEqual([Texture.EMPTY, Texture.EMPTY]);
    floor.destroy();
  });

  it('invalidates changed stacks, occluded tiles and tiles cleared by the server', () => {
    const animated = new Set<AnimatedSprite>();
    const floor = new TileFloor(types, () => Texture.WHITE, animated);
    floor.update([tile(1, 1, [100, 101]), tile(2, 1), tile(3, 1), tile(4, 1)]);
    const [changed, covered, cleared, retained] = floor.container.children;
    const view = [tile(1, 1, [101, 100]), tile(2, 1), tile(3, 1, []), tile(4, 1)];
    floor.update(view, new Set([tilePositionKey(2, 1)]));
    expect([changed, covered, cleared].every(c => c.destroyed)).toBe(true);
    expect(retained.destroyed).toBe(false);
    expect(animated.size).toBe(3);
    floor.update(view);
    expect(animated.size).toBe(4);
    floor.destroy();
  });

  it('inserts creatures after their row as the viewport changes and leaves them caller-owned', () => {
    const floor = new TileFloor(types, () => Texture.WHITE);
    floor.update([tile(2, 1), tile(3, 2)]);
    const [north, south] = floor.container.children;
    const creature = new Container();
    creature.zIndex = creatureDrawOrder(1, 1);
    floor.container.addChild(creature);
    floor.update([tile(1, 1), tile(2, 1), tile(3, 2)]);
    floor.container.sortChildren();
    expect(floor.container.children.slice(1)).toEqual([north, creature, south]);
    creature.zIndex = creatureDrawOrder(2, 1);
    floor.container.sortChildren();
    expect(floor.container.children.at(-1)).toBe(creature);
    floor.destroy();
    expect(creature.destroyed).toBe(false);
    expect(creature.parent).toBeNull();
    creature.destroy();
  });
});
