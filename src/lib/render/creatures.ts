import { Container } from 'pixi.js';
import { renderPlayer, type TintedTextureCache } from '../tileRenderer';
import { partitionByFloor } from './floorStack';
import { createNameplate, type NameplateHandle } from './nameplate';
import type { GameWorld, WorldCreature } from '../GameWorld';
import type { Direction } from '../player';
import type { SpriteAtlas } from '../spriteAtlas';
import { TILE_SIZE } from '../../constants';
import { HALF_W_LEFT, HALF_W_RIGHT, HALF_H_TOP, HALF_H_BOTTOM } from './region';
import { walkPhase } from './effects';

/**
 * Extra painted tiles beyond the server window on every side: the
 * pursuing camera trails the confirmed position by up to a tile, and
 * the trailing edge must show the (already-known, lingering) tiles
 * there instead of black.
 */
export const GLIDE_PAD = 3;

/**
 * Draw every creature in the visible region (the player included) into
 * its floor's container — one per drawn z, pre-seated by the caller in
 * draw-order position, so a creature on z paints between tiles(z) and
 * tiles(z−1) and roofs occlude the people under them. North-to-south
 * within each floor so southern creatures overlap the ones behind them,
 * matching the tile painter order. Nameplates go into the SAME per-floor
 * container as their creature — a roof that hides a creature must hide
 * its nameplate too. The one exception is the PLAYER's own plate, which
 * goes into `selfPlateLayer` (above both tile parents): standing under a
 * stairwell opening, the floor-above ground paints exactly where the
 * plate hangs, and the player's own name must never vanish while the
 * player is visible. Exported for tests.
 */
export function drawCreatures(
  world: GameWorld,
  atlas: SpriteAtlas,
  layersByZ: ReadonlyMap<number, Container>,
  tintedCache: TintedTextureCache,
  nameplates: Map<number, NameplateHandle>,
  isMoving: (creature: WorldCreature) => boolean,
  now: number,
  selfPlateLayer: Container | null,
): Array<{ node: Container; baseX: number; baseY: number; c: WorldCreature }> {
  const movables: Array<{ node: Container; baseX: number; baseY: number; c: WorldCreature }> = [];
  const x1 = world.playerX - HALF_W_LEFT - GLIDE_PAD;
  const x2 = world.playerX + HALF_W_RIGHT + GLIDE_PAD;
  const y1 = world.playerY - HALF_H_TOP - GLIDE_PAD;
  const y2 = world.playerY + HALF_H_BOTTOM + GLIDE_PAD;

  const byFloor = partitionByFloor(world.getAllCreatures(), [...layersByZ.keys()]);

  const seen = new Set<number>();
  for (const [z, container] of layersByZ) {
    const visible = (byFloor.get(z) ?? []).filter((c) =>
      c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2,
    );
    visible.sort((a, b) => (a.y - b.y) || (a.x - b.x));

    for (const c of visible) {
      const sprite = renderCreature(c, atlas, tintedCache, walkPhase(isMoving(c), now));
      if (sprite) {
        container.addChild(sprite);
        movables.push({ node: sprite, baseX: sprite.x, baseY: sprite.y, c });
      }

      // Nameplate (name + six-band health bar) above the creature's tile.
      // Reparented into the fresh container each rebuild; updated in place.
      seen.add(c.id);
      let plate = nameplates.get(c.id);
      if (!plate) {
        plate = createNameplate(c.name, c.health);
        nameplates.set(c.id, plate);
      } else {
        plate.update(c.name, c.health);
      }
      plate.container.x = (c.x + 0.5) * TILE_SIZE;
      plate.container.y = c.y * TILE_SIZE - 14;
      const plateParent = c.id === world.playerCreatureId && selfPlateLayer
        ? selfPlateLayer
        : container;
      plateParent.addChild(plate.container);
      movables.push({
        node: plate.container, baseX: plate.container.x, baseY: plate.container.y, c,
      });
    }
  }
  for (const [id, plate] of nameplates) {
    if (!seen.has(id)) {
      plate.destroy();
      nameplates.delete(id);
    }
  }
  return movables;
}

function renderCreature(
  c: WorldCreature,
  atlas: SpriteAtlas,
  tintedCache: TintedTextureCache,
  animationPhase: number,
): Container | null {
  if (!c.outfit || c.outfit.lookType === 0) return null; // invisible / item-look: not drawn yet
  return renderPlayer(
    {
      x: c.x,
      y: c.y,
      z: c.z,
      // The wire direction byte is value-compatible with Direction
      // (0 north, 1 east, 2 south, 3 west); renderPlayer additionally
      // clamps to the outfit's pattern count.
      direction: (c.direction & 3) as Direction,
      animationPhase,
      outfit: {
        lookType: c.outfit.lookType,
        headColor: c.outfit.head,
        bodyColor: c.outfit.body,
        legsColor: c.outfit.legs,
        feetColor: c.outfit.feet,
      },
    },
    atlas.creatureIndex,
    atlas.atlasTextures,
    atlas.atlasPages,
    atlas.layout,
    tintedCache,
  );
}
