import { Container, Sprite } from 'pixi.js';
import type { WorldCreature } from './GameWorld';
import type { DatFile, ThingType } from './dat';
import { getCreatureSpriteId, buildCreatureIndex } from './player';
import type { SpriteLocation } from './atlas';
import { getSpriteTexture } from './tileRenderer';
import type { AtlasTextures } from './tileRenderer';

const TILE_SIZE = 32;

export interface CreatureRenderState {
  container: Container;
  creatureIndex: Map<number, ThingType>;
  sprites: Map<number, Sprite>;
}

/**
 * Initialize creature rendering state. Call once during setup.
 */
export function initCreatureRenderer(
  dat: DatFile,
): CreatureRenderState {
  return {
    container: new Container(),
    creatureIndex: buildCreatureIndex(dat),
    sprites: new Map(),
  };
}

/**
 * Update creature sprites to match current world state.
 * Call each frame or when creatures change.
 */
export function updateCreatures(
  state: CreatureRenderState,
  creatures: WorldCreature[],
  atlasTextures: AtlasTextures,
  layout: Map<number, SpriteLocation>,
  originX: number,
  originY: number,
  zoom: number,
): void {
  const activeIds = new Set<number>();

  for (const creature of creatures) {
    activeIds.add(creature.id);

    const thingType = state.creatureIndex.get(creature.outfit.lookType);
    if (!thingType) continue;

    const spriteId = getCreatureSpriteId(thingType.frameGroup, creature.direction as 0 | 1 | 2 | 3, 0);
    if (!spriteId) continue;

    let sprite = state.sprites.get(creature.id);

    if (!sprite) {
      const texture = getSpriteTexture(spriteId, atlasTextures, layout);
      if (!texture) continue;
      sprite = new Sprite(texture);
      state.container.addChild(sprite);
      state.sprites.set(creature.id, sprite);
    } else {
      // Update texture if creature changed direction/outfit
      const texture = getSpriteTexture(spriteId, atlasTextures, layout);
      if (texture) sprite.texture = texture;
    }

    sprite.x = (creature.x - originX) * TILE_SIZE * zoom;
    sprite.y = (creature.y - originY) * TILE_SIZE * zoom;
    sprite.scale.set(zoom);
    sprite.visible = true;
  }

  // Hide sprites for creatures no longer visible
  for (const [id, sprite] of state.sprites) {
    if (!activeIds.has(id)) {
      sprite.visible = false;
    }
  }
}

/**
 * Clean up sprites for creatures that no longer exist.
 */
export function cleanupCreatures(state: CreatureRenderState, activeIds: Set<number>): void {
  for (const [id, sprite] of state.sprites) {
    if (!activeIds.has(id)) {
      state.container.removeChild(sprite);
      sprite.destroy();
      state.sprites.delete(id);
    }
  }
}
