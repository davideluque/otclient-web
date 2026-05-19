import { DatAttr } from '../dat';
import type { ThingType } from '../dat';
import type { TileMap } from '../tileMap';

/**
 * Roof / "first visible floor" calculation, ported from upstream OTClient
 * (MapView::calcFirstVisibleFloor + Map::isCompletelyCovered): walk
 * upward from the player's z toward z=0, and at each floor scan a 3x3
 * window centered on the player for a tile carrying a roof flag. When
 * a roof is found at z=R, only z >= R+1 is visible — the roof itself
 * and everything above it gets hidden so the player sees the interior.
 *
 * Tibia 7.6 has no dedicated `LimitsFloorsView` DAT attribute (that was
 * added in later protocol versions). The equivalent is `DatAttr.FullGround`,
 * which roof tiles on the floor immediately above a building's interior
 * carry. So "is this overhead tile a roof" reduces to "does it contain a
 * FullGround item?".
 *
 * Returns the lowest-z (highest-in-world) floor that should still render.
 * - No cover all the way up → 0  (render everything from z=0 to playerZ).
 * - Player on z=0 → 0  (nothing above to render).
 * - Roof at z=R → R+1  (roof and all floors above R are hidden).
 *
 * Convention: in Tibia z=0 is the highest floor (sky); z=7 is ground;
 * z=15 is deepest underground. So "upward" means decreasing z.
 *
 * Pure: no DOM / Pixi state touched. Safe to call from anywhere and
 * trivial to unit-test.
 */

const SCAN_RADIUS = 1;

export function calcFirstVisibleFloor(
  playerX: number,
  playerY: number,
  playerZ: number,
  tileMap: Pick<TileMap, 'getTile'>,
  datIndex: Map<number, ThingType>,
): number {
  for (let z = playerZ - 1; z >= 0; z--) {
    if (hasRoofIn3x3(playerX, playerY, z, tileMap, datIndex)) {
      return z + 1;
    }
  }
  return 0;
}

function hasRoofIn3x3(
  cx: number,
  cy: number,
  z: number,
  tileMap: Pick<TileMap, 'getTile'>,
  datIndex: Map<number, ThingType>,
): boolean {
  for (let dy = -SCAN_RADIUS; dy <= SCAN_RADIUS; dy++) {
    for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
      const tile = tileMap.getTile(cx + dx, cy + dy, z);
      if (!tile) continue;
      for (const item of tile.items) {
        const tt = datIndex.get(item.clientId);
        if (tt?.attrs.has(DatAttr.FullGround)) return true;
      }
    }
  }
  return false;
}
