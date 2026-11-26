// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { drawCreatures } from '../lib/render/creatures';
import type { NameplateHandle } from '../lib/render/nameplate';
import { GameWorld, type WorldCreature } from '../lib/GameWorld';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import type { SpriteAtlas } from '../lib/spriteAtlas';

/**
 * The self nameplate must land in the dedicated top layer (drawn above
 * the above-floor tiles), not the per-floor container — standing under
 * a stairwell opening, the floor-above ground paints exactly where the
 * plate hangs, which hid the player's own name after descending.
 * Everyone else's plate stays per-floor so roofs keep hiding them.
 */

// lookType 0 skips sprite rendering before the atlas is touched, so the
// plate parenting logic runs without real .dat/.spr fixtures.
function creature(id: number, name: string, x: number, y: number, z: number): WorldCreature {
  return {
    id, name, x, y, z,
    direction: 2, health: 100, speed: 220,
    outfit: { lookType: 0, head: 0, body: 0, legs: 0, feet: 0 },
  } as WorldCreature;
}

function worldWith(creatures: WorldCreature[]): GameWorld {
  const world = new GameWorld(new GameProtocol());
  world.playerCreatureId = 1;
  world.playerX = 50;
  world.playerY = 60;
  world.playerZ = 8;
  for (const c of creatures) {
    // @ts-expect-error private registry, same access the smoothWalk test uses
    world.creatures.set(c.id, c);
  }
  return world;
}

describe('drawCreatures nameplate parenting', () => {
  const draw = (world: GameWorld, floorLayer: Container, selfPlateLayer: Container | null) => {
    const nameplates = new Map<number, NameplateHandle>();
    drawCreatures(
      world,
      {} as SpriteAtlas,
      new Map([[8, floorLayer]]),
      new Map(),
      nameplates,
      () => false,
      1000,
      selfPlateLayer,
    );
    return nameplates;
  };

  it('parents the SELF plate into the top layer, others per-floor', () => {
    const world = worldWith([
      creature(1, 'Player', 50, 60, 8),
      creature(2, 'An NPC', 52, 60, 8),
    ]);
    const floorLayer = new Container();
    const selfPlateLayer = new Container();
    const nameplates = draw(world, floorLayer, selfPlateLayer);

    expect(nameplates.get(1)?.container.parent).toBe(selfPlateLayer);
    expect(nameplates.get(2)?.container.parent).toBe(floorLayer);
  });

  it('falls back to per-floor parenting when no top layer exists', () => {
    const world = worldWith([creature(1, 'Player', 50, 60, 8)]);
    const floorLayer = new Container();
    const nameplates = draw(world, floorLayer, null);

    expect(nameplates.get(1)?.container.parent).toBe(floorLayer);
  });
});
